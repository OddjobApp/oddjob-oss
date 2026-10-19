
import { Job, Pipeline, FolderImportConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { fileStorageSuccess } from "@domain/knowledge/core/file-storage.js";
import { ingestFileToKnowledgeStore } from "../../../../knowledge/knowledge-store.js";
import { JobExecutionError } from "@server/utils/errors.js";
import path from 'path';

function matchesFilePattern(fileName: string, pattern: string): boolean {
    if (!pattern) return false;
    if (pattern === '*') return true;
    try {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
        return new RegExp('^' + escaped + '$').test(fileName);
    } catch {
        return fileName === pattern;
    }
}

export class FolderImportExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "folder_import";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as FolderImportConfig;
        const orgId = job.organizationId!; // Assumed present for jobs

        // Mission wake-up: When resumed with matched_file_path, process that file directly
        const matchedFilePath = (context as any).named?.matched_file_path ?? (context as any).data?.matched_file_path;
        let files: any[] = [];
        if (matchedFilePath && typeof matchedFilePath === "string") {
            const baseName = path.basename(matchedFilePath);
            files = [{ name: baseName, path: matchedFilePath, size: 0, createdAt: new Date() }];
        } else {
            // 1. List Files
            files = await fileStorageSuccess.listFiles(orgId, config.folderPath, config.pattern, config.recursive);

            // 2. Mission wake-up: Check mission runs waiting_on_file; if any file matches, resume
            try {
                const { missionRunService } = await import("../../../../domain/mission/core/mission-run.service.js");
                const waitingMissions = await missionRunService.listWaitingOnFile();
                for (const mission of waitingMissions) {
                    const rc = mission.resumeCondition as { type?: string; folderPath?: string; filePattern?: string } | null;
                    if (rc?.type !== "file" || !rc.folderPath || !rc.filePattern) continue;
                    if (rc.folderPath !== config.folderPath) continue;
                    for (const file of files) {
                        const filePath = path.join(config.folderPath, file.path || file.name);
                        const fileName = file.name ?? path.basename(filePath);
                        if (matchesFilePattern(fileName, rc.filePattern)) {
                            const fullPath = filePath.startsWith(config.folderPath) ? filePath : path.join(config.folderPath, file.path || file.name);
                            await missionRunService.resumeMissionRun(mission.id, fullPath);
                            break;
                        }
                    }
                }
            } catch (err) {
                console.warn("[FolderImportExecutor] Mission wake-up check failed:", err);
            }
        }

        // Sort by creation time (FIFO)
        files.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        // Apply Batch Limit
        files = files.slice(0, config.maxBatchSize || 100);

        const results: any[] = [];
        const validFilesProcessed: string[] = []; // Track applicable files for post-action

        for (const file of files) {
            const fullFilePath = path.join(config.folderPath, file.path);
            try {
                // Archive Extraction Logic
                if (config.extractArchives && file.name.endsWith('.zip')) {
                    // Extract to a temp subfolder
                    const tempId = Math.random().toString(36).substring(7);
                    const extractRoot = `temp/${tempId}`;
                    const extractedNames = await fileStorageSuccess.extractArchive(orgId, fullFilePath, extractRoot);

                    // If mode is LIST_ONLY, return the extracted file paths
                    if (config.mode === 'list_only') {
                        extractedNames.forEach(name => {
                            results.push({
                                name: name,
                                path: `${extractRoot}/${name}`,
                                size: 0, // Unknown without stat
                                sourceArchive: file.name
                            });
                        });
                    } else if (config.mode === 'read_content') {
                        // Read all extracted files
                        for (const subFile of extractedNames) {
                            const subPath = `${extractRoot}/${subFile}`;
                            const content = await fileStorageSuccess.readFile(orgId, subPath, config.encoding as any);
                            if (subFile.endsWith('.json')) {
                                try { results.push({ name: subFile, content: JSON.parse(content) }); } catch { results.push({ name: subFile, content }); }
                            } else {
                                results.push({ name: subFile, content });
                            }
                        }
                    }

                    // Add archive to processed list
                    validFilesProcessed.push(fullFilePath);

                } else {
                    // Normal File Handling
                    if (config.mode === 'list_only') {
                        results.push(file);
                    } else if (config.mode === 'read_content') {
                        let encoding: any = config.encoding || 'utf8';
                        if (config.encoding === 'data_uri') {
                            encoding = 'base64';
                        }

                        const content = await fileStorageSuccess.readFile(orgId, fullFilePath, encoding);

                        let finalContent: any = content;
                        if (config.encoding === 'data_uri') {
                            // Detect mime type roughly
                            const ext = file.name.split('.').pop()?.toLowerCase();
                            const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
                            finalContent = `data:${mime};base64,${content}`;
                        } else if (file.name.endsWith('.json')) {
                            try { finalContent = JSON.parse(content); } catch { }
                        } else if (file.name.endsWith('.csv')) {
                            // Dynamic import csv-parse
                            const { parse } = await import('csv-parse/sync');
                            finalContent = parse(content, { columns: true, skip_empty_lines: true });
                        }

                        results.push({ filename: file.name, content: finalContent });

                    } else if (config.mode === 'ingest_dataset') {
                        const content = await fileStorageSuccess.readFile(orgId, fullFilePath, 'utf8');

                        // Knowledge Store Integration
                        if (job.enableKnowledgeStore && job.outputKnowledgeTopicId) {
                            try {
                                const docId = await ingestFileToKnowledgeStore({
                                    content,
                                    title: file.name,
                                    sourceType: "upload",
                                    topicId: job.outputKnowledgeTopicId,
                                    organizationId: orgId,
                                    createdBy: job.createdBy,
                                    metadata: {
                                        jobId: job.id,
                                        jobName: job.name,
                                        originalPath: fullFilePath,
                                        importMode: "folder_import"
                                    }
                                });
                                console.log(`[FolderImportExecutor] Ingested ${file.name} to Knowledge Topic ${job.outputKnowledgeTopicId} (Doc ID: ${docId})`);
                            } catch (err: any) {
                                console.warn(`[FolderImportExecutor] Failed to ingest ${file.name} to Knowledge Store: ${err.message}`);
                            }
                        }

                        if (file.name.endsWith('.csv')) {
                            const { parse } = await import('csv-parse/sync');
                            const rows = parse(content, { columns: true });
                            results.push({ filename: file.name, insertedRows: rows.length, data: rows });
                        } else if (file.name.endsWith('.json')) {
                            const json = JSON.parse(content);
                            results.push({ filename: file.name, data: json });
                        }

                    }

                    validFilesProcessed.push(fullFilePath);
                }
            } catch (err: any) {
                console.error(`[FolderImportExecutor] Failed to process file ${fullFilePath}: ${err.message}`);
                // Handle onBadRecord? 
                if (config.onBadRecord === 'fail_fast') {
                    throw new JobExecutionError(
                        job.id,
                        `Import failed on file ${file.name}: ${err.message}`,
                        { fileName: file.name, filePath: fullFilePath, originalError: err.message }
                    );
                }
                // Skip
            }
        }

        // Mission wake-up: When no files found and mission context present, pause for file
        const missionId = (context as any).missionId;
        const pipelineExecutionId = (context as any).pipelineExecutionId;
        const currentStepId = (context as any).currentStepId;
        if (
            results.length === 0 &&
            missionId &&
            pipelineExecutionId &&
            currentStepId
        ) {
            return {
                success: true,
                output: JSON.stringify({ files: [], _waitForFile: true }),
                status: "waiting_external_input",
                suspensionMetadata: {
                    waitReason: "file",
                    folderPath: config.folderPath,
                    filePattern: config.pattern,
                    pipelineExecutionId,
                    stepId: currentStepId,
                },
            } as any;
        }

        // Post Process Action (Move/Delete)
        if (config.postProcessAction !== 'none' && validFilesProcessed.length > 0) {
            for (const processedPath of validFilesProcessed) {
                try {
                    if (config.postProcessAction === 'delete') {
                        await fileStorageSuccess.deleteFile(orgId, processedPath);
                    } else if (config.postProcessAction === 'move' && config.moveDestination) {
                        const destPath = `${config.moveDestination}/${path.basename(processedPath)}`;
                        await fileStorageSuccess.moveFile(orgId, processedPath, destPath);
                    }
                } catch (postErr: any) {
                    console.error(`[FolderImportExecutor] Post-process failed for ${processedPath}:`, postErr);
                }
            }
        }

        return {
            success: true,
            output: JSON.stringify(results),
            status: "success"
        };
    }
}


