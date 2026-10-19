
import { Job, Pipeline } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { FileParser } from "@domain/core/infrastructure/file-parser.service.js";
import { AppError, ErrorCode } from "@server/utils/errors.js";
import fs from 'fs';
import { pythonBridge } from "@domain/integrations/core/gateway/python.gateway.js";

interface PdfParseConfig {
    filePath: string;
}

export class PdfParseExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "pdf_parse";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as PdfParseConfig;

        if (!config.filePath) {
            throw new AppError("File Path is required for PDF Parser", 400, ErrorCode.VALIDATION_FAILED);
        }

        try {
            const isHealthy = await pythonBridge.isHealthy();
            if (!isHealthy) {
                throw new AppError("Python Sidecar is not running. PDF Parse requires the Python service.", 503, ErrorCode.INTERNAL_ERROR);
            }

            // Read file from disk
            const buffer = await fs.promises.readFile(config.filePath);

            const result = await pythonBridge.parsePdf(buffer);

            if ((result as any).error) { // Python service might return { error: ... }
                throw new AppError(`PDF Parsing failed: ${(result as any).error}`, 500, ErrorCode.INTERNAL_ERROR);
            }

            return {
                success: true,
                output: JSON.stringify(result),
                status: "success",
                telemetry: {
                    file_path: config.filePath,
                    pages: result.metadata?.pages,
                    text_length: result.text?.length
                }
            };
        } catch (error: any) {
            throw new AppError(`PDF Parse execution failed: ${error.message}`, 500, ErrorCode.INTERNAL_ERROR);
        }
    }
}


