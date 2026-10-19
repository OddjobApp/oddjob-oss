import { Job, Pipeline } from "@shared/schema/index.js";
import { type VariableContext } from "@server/core/variable-resolver.js";
import { type StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import { type JobExecutor } from "./index.js";
import { db } from "@server/database_service.js";
import { datasets, datasetItems } from "@shared/schema/datasets.js";
import { eq, and } from "drizzle-orm";
import { AppError, ErrorCode } from "@server/utils/errors.js";
import { type SaveToDatasetConfig } from "@shared/schema/jobs/config-data.js";

export class SaveToDatasetExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "save_to_dataset";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> }
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as SaveToDatasetConfig;

        if (!config.datasetId && !config.datasetName) {
            throw new AppError("Either datasetId or datasetName is required", 400, ErrorCode.VALIDATION_FAILED);
        }

        const orgId = job.organizationId || pipeline.organizationId;
        if (!orgId) {
            throw new AppError("Organization ID is required", 400, ErrorCode.VALIDATION_FAILED);
        }

        let datasetId = config.datasetId;

        // If only name is provided, find or create the dataset
        if (!datasetId && config.datasetName) {
            let [dataset] = await db.select()
                .from(datasets)
                .where(and(eq(datasets.name, config.datasetName), eq(datasets.organizationId, orgId)))
                .limit(1);
            
            if (!dataset) {
                // Create it
                const [newDataset] = await db.insert(datasets).values({
                    name: config.datasetName,
                    organizationId: orgId,
                    description: `Automatically created by job execution`,
                }).returning();
                dataset = newDataset;
            }
            datasetId = dataset.id;
        }

        if (!datasetId) {
            throw new AppError("Could not resolve dataset", 500, ErrorCode.INTERNAL_ERROR);
        }

        const dataToSave = config.data;
        if (dataToSave === undefined || dataToSave === null) {
            throw new AppError("Data to save is empty", 400, ErrorCode.VALIDATION_FAILED);
        }

        // Insert into dataset_items
        const itemsToInsert = Array.isArray(dataToSave) ? dataToSave : [dataToSave];

        if (itemsToInsert.length === 0) {
             return {
                success: true,
                output: `Saved 0 items to dataset (input was empty array)`,
                status: "success"
            };
        }

        for (const item of itemsToInsert) {
             await db.insert(datasetItems).values({
                datasetId,
                data: item,
                rawData: item,
                pipelineExecutionId: context.data?.pipelineExecutionId || undefined
             });
        }

        return {
            success: true,
            output: `Saved ${itemsToInsert.length} items to dataset ${config.datasetName || config.datasetId}`,
            status: "success"
        };
    }
}
