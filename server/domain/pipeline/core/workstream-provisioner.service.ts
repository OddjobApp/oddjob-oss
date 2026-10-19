import { db } from "@server/database_service.js";
import {
    pipelines,
    pipelineSteps,
    jobs,
    type Pipeline,
    type Job
} from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { pipelineEngine } from "./pipeline-engine.js";

const logger = createLogger("WorkstreamProvisioner");

/**
 * Service to automatically provision pipelines/workstreams based on templates or requirements
 */
export const workstreamProvisioner = {
    /**
     * Provision a standard data enrichment workstream
     */
    async provisionEnrichmentWorkstream(name: string, organizationId: number, userId: string): Promise<Pipeline> {
        logger.info("Provisioning enrichment workstream", { name, organizationId });

        // 1. Create the pipeline
        const [pipeline] = await db.insert(pipelines).values({
            name,
            description: "Automatically provisioned data enrichment workstream",
            organizationId,
            createdBy: userId,
            isActive: true,
            triggerType: "manual"
        }).returning();

        // 2. Find relevant jobs (this is simplified, usually we'd have template IDs)
        const availableJobs = await db.select()
            .from(jobs)
            .where(eq(jobs.organizationId, organizationId));

        const scrapingJob = availableJobs.find(j => j.tool === "smart_scraper");
        const analysisJob = availableJobs.find(j => j.tool === "ai_agent");

        const steps = [];

        if (scrapingJob) {
            steps.push({
                jobId: scrapingJob.id,
                order: 0,
                outputName: "scraped_data"
            });
        }

        if (analysisJob) {
            steps.push({
                jobId: analysisJob.id,
                order: 1,
                outputName: "analysis_results"
            });
        }

        // 3. Add steps to pipeline
        if (steps.length > 0) {
            await pipelineEngine.insertSteps(pipeline.id, steps as any);
        }

        return pipeline;
    },

    /**
     * Provision a non-linear workstream from a graph definition (nodes/edges)
     * Used by verify-dag-resolution script and potential future dynamic provisioning.
     */
    async provisionWorkstream(missionId: number, workflow: any, organizationId: number, userId: string): Promise<{ pipelineId: number }> {
        logger.info("Provisioning non-linear workstream from graph", { missionId, organizationId });

        // 1. Create the pipeline
        const [pipeline] = await db.insert(pipelines).values({
            name: `Workstream for Mission ${missionId}`,
            description: "Automatically provisioned non-linear workstream",
            organizationId,
            createdBy: userId,
            isActive: true,
            triggerType: "manual"
        }).returning();

        const pipelineId = pipeline.id;
        const nodes = workflow.nodes || [];
        const edges = workflow.edges || [];

        // 2. Identify and create jobs for nodes
        const availableJobs = await db.select()
            .from(jobs)
            .where(eq(jobs.organizationId, organizationId));

        const nodeToStep = new Map<string, any>();

        for (const node of nodes) {
            // Find a matching job (heuristic)
            const job = availableJobs.find(j => 
                j.tool === node.type || 
                j.name.toLowerCase().includes(node.role?.toLowerCase() || "")
            ) || availableJobs[0]; // Fallback

            const [step] = await db.insert(pipelineSteps).values({
                pipelineId,
                jobId: job.id,
                order: nodes.indexOf(node),
                outputName: node.id,
                moduleType: node.type,
                decisionNodeConfig: node.type === 'modifier' ? node.config : null
            }).returning();

            nodeToStep.set(node.id, step);
        }

        // 3. Link steps via edges
        for (const edge of edges) {
            const fromStep = nodeToStep.get(edge.from);
            const toStep = nodeToStep.get(edge.to);

            if (fromStep && toStep) {
                if (fromStep.moduleType === 'modifier' || fromStep.moduleType === 'decision') {
                    // Update decision rules
                    const config = (fromStep.decisionNodeConfig as any) || {};
                    const routes = config.routes || { onMatch: {}, onMismatch: {} };
                    
                    if (edge.condition === 'true') {
                        routes.onMatch = { destinationStepId: toStep.id };
                    } else if (edge.condition === 'false') {
                        routes.onMismatch = { destinationStepId: toStep.id };
                    }
                    
                    await db.update(pipelineSteps)
                        .set({ decisionNodeConfig: { ...config, routes } })
                        .where(eq(pipelineSteps.id, fromStep.id));
                } else {
                    // Standard routing
                    await db.update(pipelineSteps)
                        .set({ destinationStepId: toStep.id })
                        .where(eq(pipelineSteps.id, fromStep.id));
                }
            }
        }

        return { pipelineId };
    },

    /**
     * Clone an existing pipeline as a new workstream
     */
    async cloneWorkstream(sourcePipelineId: number, newName: string, organizationId: number, userId: string): Promise<Pipeline> {
        const source = await pipelineEngine.getById(sourcePipelineId, { organizationId } as any);
        
        const [newPipeline] = await db.insert(pipelines).values({
            name: newName,
            description: `Clone of ${source.name}`,
            organizationId,
            createdBy: userId,
            isActive: true,
            triggerType: source.triggerType,
            triggerCredentialId: source.triggerCredentialId
        }).returning();

        if (source.steps && source.steps.length > 0) {
            const newSteps = source.steps.map(s => ({
                jobId: s.jobId,
                order: s.order,
                outputName: s.outputName,
                runOnCondition: s.runOnCondition,
                waitDurationSeconds: s.waitDurationSeconds,
                onFailureAction: s.onFailureAction,
                parallelGroup: s.parallelGroup,
                conditionExpression: s.conditionExpression,
                moduleType: s.moduleType,
                destinationStepId: s.destinationStepId,
                decisionNodeConfig: s.decisionNodeConfig
            }));

            await pipelineEngine.insertSteps(newPipeline.id, newSteps as any);
        }

        return newPipeline;
    }
};


