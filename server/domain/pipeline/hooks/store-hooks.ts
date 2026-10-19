import { ExecutionHook, HookParams } from "./execution-hooks.js";
import { checkOrgFeatureEnabled } from "../core/utils.js";

import { executionManager } from "../core/execution-manager.js";

import { db } from "@server/database_service.js";
import { knowledgeDocumentExtractions } from "@shared/schema/index.js";

export class KnowledgeStoreHook implements ExecutionHook {
    name = "KnowledgeStoreHook";

    async onStepComplete(params: HookParams): Promise<void> {
        const { result, currentStep, pipeline, pipelineExecution, stepExecution, orgId, userId } = params;
        if (!result.output || !result.output.trim() || !currentStep.jobId) return;

        try {
            const { jobService } = await import("@domain/jobs/job.service.js");
            const job = await jobService.getById(currentStep.jobId, { 
                userId: userId || 'system', 
                organizationId: orgId,
                isAdmin: false,
                isSuperAdmin: false,
                isOrgAdmin: false
            });
            const orgEnabled = await checkOrgFeatureEnabled(orgId, 'knowledgeStore');

            if (job?.enableKnowledgeStore && (job.outputKnowledgeTopicId || job.outputDatasetId) && orgEnabled) {
                const { getJobOutputStorageConfig, storeJobOutputAsKnowledge } = await import("@domain/knowledge/core/knowledge-store.js");
                const settings = getJobOutputStorageConfig(job);
                const knowledgeResult = await storeJobOutputAsKnowledge({
                    output: result.output,
                    job,
                    stepExecution: {
                        id: stepExecution.id,
                        status: result.status,
                        executedAt: stepExecution.executedAt || new Date(),
                    },
                    topicId: job.outputKnowledgeTopicId ?? null,
                    datasetId: job.outputDatasetId ?? undefined,
                    tags: job.outputTags || [],
                    settings,
                });

                // Persistence: Update StepExecution with stats
                const kResult = knowledgeResult as any;
                if (kResult && typeof kResult === 'object' && (kResult.knowledgeDocumentId || kResult.stats)) {
                    params.goldenRecordWritten = true;
                    
                    if (kResult.stats) {
                        try {
                            await executionManager.updateStepExecution(stepExecution.id, {
                                executionStats: kResult.stats
                            } as any);
                        } catch (statsErr) {
                            console.warn(`[KnowledgeStoreHook] Failed to persist hygiene stats for step ${stepExecution.id}`, statsErr);
                        }
                    }
                }

                const knowledgeDocumentId = kResult?.knowledgeDocumentId;

                // ASYNC KNOWLEDGE EXTRACTION TRIGGER
                if (knowledgeDocumentId && pipeline.enableKnowledgeGraph) {
                    try {
                        const config = pipeline.knowledgeGraphConfig as any;
                        const defaultSchemaId = config?.defaultExtractionSchemaId || 1;

                        const [extractionRecord] = await db.insert(knowledgeDocumentExtractions).values({
                            documentId: knowledgeDocumentId,
                            schemaId: defaultSchemaId,
                            organizationId: orgId,
                            status: "queued",
                            priority: 0,
                            createdBy: userId || "system",
                            metadata: {
                                pipelineId: pipeline.id,
                                executionId: pipelineExecution.id,
                                source: 'pipeline_auto'
                            }
                        }).returning();

                        const { queueExtractionJob } = await import("@domain/knowledge/knowledge-queue.js");
                        await queueExtractionJob({
                            type: 'document',
                            extractionId: (extractionRecord as any).id,
                            documentId: knowledgeDocumentId,
                            schemaId: defaultSchemaId,
                            organizationId: orgId || null
                        });
                        console.log(`[KnowledgeStoreHook] Queued auto-extraction for document ${knowledgeDocumentId}`);
                    } catch (extractErr) {
                        console.error(`[KnowledgeStoreHook] Failed to queue auto-extraction:`, extractErr);
                    }
                }
            }
        } catch (error) {
            console.error(`[KnowledgeStoreHook] Error processing knowledge storage:`, error);
        }
    }
}
