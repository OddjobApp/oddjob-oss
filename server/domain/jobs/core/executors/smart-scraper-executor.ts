
import { Job, Pipeline } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { pythonBridge } from "@domain/integrations/core/gateway/python.gateway.js";
import { AppError, ErrorCode } from "@server/utils/errors.js";

interface SmartScrapeConfig {
    url: string;
    targetVariables?: string; // Where to store result
}

export class SmartScraperExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "smart_scrape";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as SmartScrapeConfig;

        if (!config.url) {
            throw new AppError("URL is required for Smart Scraper", 400, ErrorCode.VALIDATION_FAILED);
        }

        try {
            const isHealthy = await pythonBridge.isHealthy();
            if (!isHealthy) {
                throw new AppError("Python Sidecar is not running. Smart Scrape requires the Python service.", 503, ErrorCode.INTERNAL_ERROR);
            }

            const result = await pythonBridge.scrape(config.url);

            if (result.error) {
                throw new AppError(`Scraping failed: ${result.error}`, 500, ErrorCode.INTERNAL_ERROR);
            }

            return {
                success: true,
                output: JSON.stringify(result),
                status: "success",
                telemetry: {
                    url: config.url,
                    title: result.title,
                    text_length: result.text?.length
                }
            };
        } catch (error: any) {
            throw new AppError(`Smart Scrape execution failed: ${error.message}`, 500, ErrorCode.INTERNAL_ERROR);
        }
    }
}


