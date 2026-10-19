import { JobExecutor } from "./index.js";
import { GoogleDriveSyncConfig } from "@shared/schema/index.js"; // Import config schema
import { db } from "../../../../database_service.js";
import { credentials } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { GoogleDriveClient } from "../../../../domain/integrations/google-drive-service.js";
import { FileParser } from "@domain/core/infrastructure/file-parser.service.js";
import { ingestFileToKnowledgeStore } from "../../../../knowledge/knowledge-store.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { WorkerPool } from "../utils/worker-pool.js";
import { TokenBucketRateLimiter } from "../utils/rate-limiter.js";

interface StepLog {
    timestamp: Date;
    level: 'info' | 'warn' | 'error';
    message: string;
}

export class GoogleDriveSyncExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "google_drive_sync";
    }

    async execute(
        job: any,
        resolvedConfig: GoogleDriveSyncConfig,
        pipeline: any,
        context: any
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig;
        const logs: StepLog[] = [];
        let processedCount = 0;
        let errorCount = 0;

        try {
            // 0. Validate Config
            if (!config.knowledgeTopicId) {
                // If not provided, we might fail or default. Usually specific topic is best.
                // Or create a new one? For now assume required or handle gracefully.
                throw new Error("Target Knowledge Topic ID is required for ingestion.");
            }

            // 1. Get Credential
            const [credential] = await db.select().from(credentials).where(eq(credentials.id, config.credentialId)).limit(1);
            if (!credential) {
                throw new Error(`Credential ID ${config.credentialId} not found.`);
            }
            if (credential.type !== 'google_drive') {
                throw new Error(`Credential must be of type 'google_drive', found '${credential.type}'.`);
            }

            const metadata = credential.metadata as any; // Typed as GoogleDriveMetadata
            const client = new GoogleDriveClient(metadata.serviceAccountJson);

            // 2. Determine Scope
            // If folderIds in config, use those. Else use metadata folderId. Else fail or walk root.
            let foldersToSync: string[] = config.folderIds && config.folderIds.length > 0
                ? config.folderIds
                : (metadata.folderId ? [metadata.folderId] : []);

            if (foldersToSync.length === 0) {
                return {
                    success: false,
                    status: 'failed',
                    output: JSON.stringify({ message: "No folders specified to sync.", logs })
                };
            }

            logs.push({ timestamp: new Date(), level: 'info', message: `Starting sync for ${foldersToSync.length} folders...` });

            // 3. Process Folders
            const rateLimiter = new TokenBucketRateLimiter(5, 5); // 5 tokens per sec
            const processedFileIds = new Set<string>(context.data?.processedFileIds || []);
            const allFiles: any[] = [];

            for (const folderId of foldersToSync) {
                // Determine walker based on recursive flag
                const walker = config.recursive ? client.walkFolder(folderId) : (async function* () {
                    let pageToken: string | undefined = undefined;
                    do {
                        const res = await client.listFiles(folderId, pageToken);
                        pageToken = res.nextPageToken;
                        for (const f of res.files) yield f;
                    } while (pageToken);
                })();

                for await (const file of walker) {
                    if (file.mimeType === 'application/vnd.google-apps.folder') continue;
                    if (processedFileIds.has(file.id)) continue;
                    allFiles.push(file);
                }
            }

            logs.push({ timestamp: new Date(), level: 'info', message: `Found ${allFiles.length} files to process.` });

            const worker = async (file: any) => {
                if (context.isCancelled) {
                    throw new Error("Job cancelled");
                }

                try {
                    await rateLimiter.acquire(1);

                    const { buffer, mimeType } = await client.getFileContent(file.id, file.mimeType);
                    const parsed = await FileParser.parse(buffer, mimeType, file.name);

                    if (parsed.content) {
                        const stringContent = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content);

                        await ingestFileToKnowledgeStore({
                            title: file.name,
                            content: stringContent,
                            sourceType: 'text',
                            topicId: config.knowledgeTopicId,
                            organizationId: job.organizationId || null,
                            createdBy: job.createdBy || 'system',
                            metadata: {
                                fileId: file.id,
                                mimeType: mimeType,
                                originalMimeType: file.mimeType,
                                parents: file.parents,
                                source: `gdrive://${file.id}`,
                                size: buffer.length
                            }
                        });
                        return { success: true, fileId: file.id };
                    } else {
                        logs.push({ timestamp: new Date(), level: 'warn', message: `Empty content for ${file.name}` });
                        return { success: false, fileId: file.id };
                    }
                } catch (e: any) {
                    logs.push({ timestamp: new Date(), level: 'error', message: `Failed to process ${file.name}: ${e.message}` });
                    return { success: false, fileId: file.id };
                }
            };

            const pool = new WorkerPool<any, {success: boolean, fileId: string}>(5, worker);
            
            const poolResults = await pool.executeWithProgress(allFiles, (completed, total, file) => {
                 processedFileIds.add(file.id);
                 context.data = { ...context.data, processedFileIds: Array.from(processedFileIds) };
                 if (completed % 10 === 0 || completed === total) {
                     logs.push({ timestamp: new Date(), level: 'info', message: `Progress: ${completed}/${total} files processed` });
                 }
            });

            processedCount = poolResults.filter(r => r && r.success).length;
            errorCount = poolResults.filter(r => r && !r.success).length;

            const success = errorCount === 0 || processedCount > 0;
            return {
                success,
                status: success ? 'success' : 'failed',
                output: JSON.stringify({
                    processedCount,
                    errorCount,
                    message: `Sync complete. Processed ${processedCount} files with ${errorCount} errors.`,
                    logs
                })
            };

        } catch (error: any) {
            logs.push({ timestamp: new Date(), level: 'error', message: `Job Failed: ${error.message}` });
            return {
                success: false,
                status: 'failed',
                output: JSON.stringify({ error: error.message, logs })
            };
        }
    }
}


