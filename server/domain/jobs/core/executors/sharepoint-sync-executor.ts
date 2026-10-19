import { JobExecutor, ExecuteJobFn } from "./index.js";
import { Job, Pipeline, SharepointSyncConfig } from "@shared/schema/index.js";
import { VariableContext } from "@server/core/variable-resolver.js";
import { StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import { getMicrosoft365Client } from "@domain/integrations/microsoft365-service.js";
import { ingestFileToKnowledgeStore as ingestIntegrationDocument } from "@domain/knowledge/core/knowledge-store.js";

export class SharepointSyncExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "sharepoint_sync";
    }

    async execute(
        job: Job,
        resolvedConfig: SharepointSyncConfig,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
        executeJob?: ExecuteJobFn
    ): Promise<StepExecutionResult> {
        const { credentialId, siteId, driveId, folderPath, recursive, knowledgeTopicId, fileTypes } = resolvedConfig;
        const logs: string[] = [];
        let processedCount = 0;
        let errorCount = 0;

        try {
            const client = await getMicrosoft365Client(credentialId, job.organizationId);
            const items = await client.listDriveItems(siteId, driveId, folderPath || "/");
            logs.push(`Found ${items.length} items in ${folderPath || "/"}`);

            const processableItems = items.filter((item: any) => {
                if (item.folder) return false; // Skip folder traversal in single pass for now
                const name: string = item.name || "";
                return fileTypes.some((ext: string) => name.toLowerCase().endsWith(ext));
            });

            logs.push(`Processing ${processableItems.length} matching files`);

            for (const item of processableItems) {
                try {
                    const content = await client.downloadDriveItem(siteId, item.id, driveId);
                    await ingestIntegrationDocument({
                        content,
                        title: item.name,
                        platform: "SharePoint",
                        integrationId: 0,
                        organizationId: job.organizationId!,
                        createdBy: job.createdBy,
                        metadata: {
                            siteId,
                            itemId: item.id,
                            path: item.webUrl,
                            lastModified: item.lastModifiedDateTime,
                            size: item.size,
                            jobId: job.id,
                        },
                    });
                    processedCount++;
                } catch (e: any) {
                    errorCount++;
                    logs.push(`Error processing ${item.name}: ${e.message}`);
                }
            }

            return {
                success: errorCount === 0,
                status: errorCount === 0 ? "success" : "failed",
                output: JSON.stringify({
                    message: `SharePoint Sync completed. Processed ${processedCount} files. Errors: ${errorCount}`,
                    processedCount,
                    errorCount,
                    logs,
                }),
            };
        } catch (error: any) {
            logs.push(`Job failed: ${error.message}`);
            return { success: false, status: "failed", output: JSON.stringify({ error: error.message, logs }) };
        }
    }
}
