
import { Job, Pipeline, FileExportConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { fileStorageSuccess } from "@domain/knowledge/core/file-storage.js";
import path from 'path';
import { AppError, ErrorCode } from "@server/utils/errors.js";

export class FileExportExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "file_export";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as FileExportConfig;

        let contentToWrite: string | Buffer = config.content;

        // Handle CSV Format
        if (config.format === 'csv') {
            let input: any = config.content;
            if (typeof input === 'string') {
                try { input = JSON.parse(input); } catch { }
            }

            if (!Array.isArray(input)) {
                if (typeof input === 'object' && input !== null) {
                    input = [input];
                } else {
                    throw new AppError("Content must be an array or object for CSV export", 400, ErrorCode.VALIDATION_FAILED);
                }
            }

            const { stringify } = await import('csv-stringify/sync');
            contentToWrite = stringify(input, { header: true });
        }
        // Handle JSON Format
        else if (config.format === 'json') {
            if (typeof config.content === 'string') {
                try {
                    const parsed = JSON.parse(config.content);
                    contentToWrite = JSON.stringify(parsed, null, 2);
                } catch {
                    contentToWrite = config.content;
                }
            } else {
                contentToWrite = JSON.stringify(config.content, null, 2);
            }
        }

        // Handle Base64 Encoding
        if (config.encoding === 'base64') {
            if (typeof contentToWrite !== 'string') {
                contentToWrite = String(contentToWrite);
            }
            contentToWrite = Buffer.from(contentToWrite, 'base64');
        }

        // Determine Org
        let orgId: number | string | null = job.organizationId || null;
        if (!orgId && pipeline.organizationId) orgId = pipeline.organizationId;

        // Safety Fallback? Org ID is usually required for fileStorage
        if (!orgId) throw new AppError("Organization ID required for file export", 400, ErrorCode.VALIDATION_FAILED);

        const savedPath = await fileStorageSuccess.saveFileWithMode(
            orgId,
            config.destinationPath,
            contentToWrite,
            config.onConflict || 'overwrite'
        );

        return {
            success: true,
            output: `Saved file to ${path.relative(process.cwd(), savedPath)}`,
            status: "success"
        };
    }
}


