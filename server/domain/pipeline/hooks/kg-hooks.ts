import { ExecutionHook, HookParams, PipelineCompleteParams } from "./execution-hooks.js";
import { checkOrgFeatureEnabled, safeJsonParse } from "../core/utils.js";

import { KnowledgeGraphConfig, TransformerConfig } from "@shared/schema/index.js";

import { db } from "@server/database_service.js";
import { eq, and } from "drizzle-orm";

export class KnowledgeGraphHook implements ExecutionHook {
    name = "KnowledgeGraphHook";

    async onStepComplete(params: HookParams): Promise<void> {
        const { result, currentStep, pipeline, pipelineExecution, stepExecution, orgId, userId } = params;
        if (!result.success || !currentStep.jobId) return;

        const { processExplicitKnowledgeGraphRules } = await import("@domain/knowledge/core/extraction/knowledge-graph-integration.js");

        const isKgEnabled = await checkOrgFeatureEnabled(orgId, 'knowledgeGraph');
        if (!isKgEnabled) return;

        const jsonOutput = safeJsonParse(result.output);
        if (!jsonOutput) return;

        // Initialize node ID map
        if (!params.knowledgeNodeIds) params.knowledgeNodeIds = new Map();

        // 1. Explicit KG Mapping (can create nodes/edges - Golden Record signal)
        if (currentStep.knowledgeGraphConfig) {
            try {
                const config = currentStep.knowledgeGraphConfig as KnowledgeGraphConfig;
                const explicitMap = await processExplicitKnowledgeGraphRules(config, {
                    jobOutput: jsonOutput,
                    organizationId: orgId,
                    pipelineExecutionId: pipelineExecution.id,
                    creatorEmail: pipeline.createdBy || undefined
                });
                
                // Merge into params
                explicitMap.forEach((id, extId) => params.knowledgeNodeIds!.set(extId, id));

                if (config.entityRules?.length || config.relationshipRules?.length) {
                    params.goldenRecordWritten = true;
                }
            } catch (error) {
                console.error(`[KnowledgeGraphHook] Error processing explicit rules:`, error);
            }
        }

        const { processSemanticEnrichment } = await import("@domain/knowledge/core/extraction/knowledge-graph-integration.js");
        const { default: jobService } = await import("@domain/jobs/job.service.js");

        // 2. Semantic Enrichment (can create nodes)
        try {
            const enrichmentMap = await processSemanticEnrichment({
                jobOutput: jsonOutput,
                organizationId: orgId,
                pipelineExecutionId: pipelineExecution.id,
                creatorEmail: pipeline.createdBy || undefined
            });
            
            // Merge into params
            enrichmentMap.forEach((id, extId) => params.knowledgeNodeIds!.set(extId, id));
        } catch (error) {
            console.error(`[KnowledgeGraphHook] Error processing semantic enrichment:`, error);
        }

        // 3. Transformer Entity Extraction
        try {
            const job = await jobService.getById(currentStep.jobId, { 
                userId: userId || 'system', 
                organizationId: orgId,
                isAdmin: false,
                isSuperAdmin: false,
                isOrgAdmin: false
            });
            if (job && job.type === "transformer") {
                const config = job.config as TransformerConfig;
                const pipeKgConfig = pipeline.knowledgeGraphConfig as any;

                let entityRules = (config.entityExtraction?.enabled && config.entityExtraction?.autoCreate)
                    ? (config.entityExtraction.entityRules || [])
                    : [];
                let relationshipRules = (config.entityExtraction?.enabled && config.entityExtraction?.autoCreate)
                    ? (config.entityExtraction.relationshipRules || [])
                    : [];

                if (pipeline.enableKnowledgeGraph && pipeKgConfig) {
                    const targetSteps = pipeKgConfig.extractFromSteps;
                    const isTargeted = !Array.isArray(targetSteps) ||
                        targetSteps.length === 0 ||
                        targetSteps.includes(currentStep.id) ||
                        targetSteps.includes(currentStep.order) ||
                        (currentStep.jobId && targetSteps.includes(currentStep.jobId));

                    if (isTargeted) {
                        entityRules = [...entityRules, ...(pipeKgConfig.entityRules || [])];
                        relationshipRules = [...relationshipRules, ...(pipeKgConfig.relationshipRules || [])];
                    }
                }

                if (entityRules.length > 0 || relationshipRules.length > 0) {
                    const { extractAndCreateKnowledgeGraph } = await import("@domain/knowledge/core/extraction/knowledge-graph-extractor.js");

                    let knowledgeDocumentId: number | null = null;
                    if (job.enableKnowledgeStore) {
                        const { jobOutputKnowledge } = await import("@shared/schema/index.js");
                        const [jobOutput] = await db
                            .select()
                            .from(jobOutputKnowledge)
                            .where(eq(jobOutputKnowledge.pipelineStepExecutionId, stepExecution.id))
                            .limit(1);
                        knowledgeDocumentId = jobOutput?.knowledgeDocumentId || null;
                    }

                    const stats = await extractAndCreateKnowledgeGraph({
                        data: jsonOutput,
                        entityRules,
                        relationshipRules,
                        organizationId: orgId,
                        createdBy: userId || "system",
                        schema: job.outputSchema as any,
                        pipelineExecutionId: pipelineExecution.id,
                        knowledgeDocumentId,
                        extractionSource: 'transformer',
                        stepOrder: currentStep.order,
                        jobId: job.id,
                    });
                    params.goldenRecordWritten = true;

                    // [Semantic Enrichment] Immediate node enrichment
                    if (stats.nodes.length > 0) {
                        const { enrichmentService } = await import("@domain/knowledge/core/extraction/enrichment-service.js");
                        // Background enrichment to avoid blocking pipeline UI
                        stats.nodes.forEach(node => {
                            enrichmentService.enrichNode(node.id, orgId).catch(err => 
                                console.error(`[Enrichment] Failed to enrich transformer node ${node.id}:`, err)
                            );
                        });
                    }
                }
            }
        } catch (error) {
            console.error(`[KnowledgeGraphHook] Error processing transformer extraction:`, error);
        }
    }

    async onPipelineComplete({ pipeline, pipelineExecution, stepResults, orgId, userId }: PipelineCompleteParams): Promise<void> {
        if (!pipeline.enableKnowledgeGraph) return;

        const isKgEnabled = await checkOrgFeatureEnabled(orgId, 'knowledgeGraph');
        if (!isKgEnabled) return;

        try {
            const config = pipeline.knowledgeGraphConfig as any;
            const entityRules = config?.entityRules || [];
            const relationshipRules = config?.relationshipRules || [];

            if (entityRules.length > 0 || relationshipRules.length > 0) {
                const stepOutputs = stepResults
                    .filter(step => {
                        if (config?.extractFromSteps && config.extractFromSteps.length > 0) {
                            return config.extractFromSteps.includes(step.stepOrder);
                        }
                        return true;
                    })
                    .map(step => ({
                        stepOrder: step.stepOrder,
                        output: step.output,
                        jobId: step.jobId,
                        stepExecutionId: step.stepId,
                    }));

                const { extractAndCreateKnowledgeGraph } = await import("@domain/knowledge/core/extraction/knowledge-graph-extractor.js");
                const { jobOutputKnowledge } = await import("@shared/schema/index.js");

                for (const stepOutput of stepOutputs) {
                    const parsedOutput = safeJsonParse(stepOutput.output) || stepOutput.output;

                    let knowledgeDocumentId: number | null = null;
                    if (config?.linkToKnowledgeDocuments && stepOutput.jobId) {
                        const { default: jobService } = await import("@domain/jobs/job.service.js");
                        const job = await jobService.getById(stepOutput.jobId, { 
                            userId: userId || 'system', 
                            organizationId: orgId,
                            isAdmin: false,
                            isSuperAdmin: false,
                            isOrgAdmin: false
                        });
                        if (job?.enableKnowledgeStore) {
                            const [jobOutput] = await db
                                .select()
                                .from(jobOutputKnowledge)
                                .where(eq(jobOutputKnowledge.pipelineStepExecutionId, stepOutput.stepExecutionId))
                                .limit(1);
                            knowledgeDocumentId = jobOutput?.knowledgeDocumentId || null;
                        }
                    }

                    const stats = await extractAndCreateKnowledgeGraph({
                        data: parsedOutput,
                        entityRules,
                        relationshipRules,
                        organizationId: orgId,
                        createdBy: userId || "system",
                        pipelineExecutionId: pipelineExecution.id,
                        knowledgeDocumentId,
                        extractionSource: 'pipeline',
                        stepOrder: stepOutput.stepOrder,
                        jobId: stepOutput.jobId || undefined,
                    });

                    // [Semantic Enrichment] Trigger immediate enrichment for new nodes and documents
                    const { enrichmentService } = await import("@domain/knowledge/core/extraction/enrichment-service.js");
                    
                    if (knowledgeDocumentId) {
                        enrichmentService.enrichDocument(knowledgeDocumentId, orgId).catch(err => 
                            console.error(`[Enrichment] Failed to enrich document ${knowledgeDocumentId}:`, err)
                        );
                    }

                    if (stats.nodes.length > 0) {
                        stats.nodes.forEach(node => {
                            // Only enrich nodes created in this execution
                            enrichmentService.enrichNode(node.id, orgId).catch(err => 
                                console.error(`[Enrichment] Failed to enrich node ${node.id}:`, err)
                            );
                        });
                    }
                }
            }
        } catch (error) {
            console.error(`[KnowledgeGraphHook] Pipeline completion extraction failed:`, error);
        }
    }
}


