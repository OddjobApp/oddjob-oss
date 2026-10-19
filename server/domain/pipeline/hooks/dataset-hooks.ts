import { ExecutionHook, HookParams } from "./execution-hooks.js";
import { checkOrgFeatureEnabled, safeJsonParse } from "../core/utils.js";
import { datasetService } from "@domain/knowledge/index.js";
import { flattenForDataset, type SchemaMapping } from "@domain/knowledge/core/flattening-service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("DatasetHook");

/**
 * Dataset Hook
 * 
 * Handles population of Datasets from job output.
 * Links Dataset Items to Knowledge Nodes if available in HookParams.
 */
export class DatasetHook implements ExecutionHook {
    name = "DatasetHook";

    async onStepComplete(params: HookParams): Promise<void> {
        const { result, currentStep, pipelineExecution, orgId, userId, knowledgeNodeIds } = params;
        if (!result.success || !result.output || !currentStep.jobId) return;

        try {
            const { jobService } = await import("@domain/jobs/job.service.js");
            const job = await jobService.getById(currentStep.jobId, { 
                userId: userId || 'system', 
                organizationId: orgId,
                isAdmin: false,
                isSuperAdmin: false,
                isOrgAdmin: false
            });

            if (!job || !job.outputDatasetId) return;

            const isDatasetEnabled = await checkOrgFeatureEnabled(orgId, 'datasets');
            if (!isDatasetEnabled) return;

            let outputData: any;
            try {
                outputData = JSON.parse(result.output);
            } catch {
                outputData = { rawValue: result.output };
            }

            // Fetch dataset to get schema mapping configuration
            const dataset = await datasetService.getById(job.outputDatasetId, { organizationId: orgId } as any);

            // Hybrid Model: Job Schema Mapping > Dataset Schema Mapping
            const jobSchemaMapping = (job.outputStorageSettings as any)?.schemaMapping;
            const datasetSchemaMapping = (dataset?.schemaMapping as SchemaMapping);
            const schemaMapping = jobSchemaMapping || datasetSchemaMapping || null;

            // Handle array of items vs single item
            const itemsToInsert = Array.isArray(outputData) ? outputData : [outputData];

            for (const itemData of itemsToInsert) {
                // Ensure data is an object for JSONB column
                const rawItem = (typeof itemData === 'object' && itemData !== null) ? itemData : { value: itemData };

                // Flatten the data using the flattening service
                const { raw, flattened } = flattenForDataset(rawItem, schemaMapping);

                // Attempt to link to Knowledge Node
                let knowledgeNodeId: number | undefined;
                if (knowledgeNodeIds) {
                    // Try to match by ID in the item data
                    const externalId = String(rawItem.id || rawItem.externalId || "");
                    if (externalId && knowledgeNodeIds.has(externalId)) {
                        knowledgeNodeId = knowledgeNodeIds.get(externalId);
                    }
                }

                await datasetService.addItem(job.outputDatasetId, {
                    data: flattened,
                    rawData: raw,
                    pipelineExecutionId: pipelineExecution.id,
                    knowledgeNodeId
                }, { organizationId: orgId } as any);
            }

            logger.info(`[DatasetHook] Saved ${itemsToInsert.length} items to Dataset ${job.outputDatasetId}`);

        } catch (error) {
            logger.error(`[DatasetHook] Error processing dataset population:`, error);
        }
    }
}
