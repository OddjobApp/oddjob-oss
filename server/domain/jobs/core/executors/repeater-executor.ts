
import { Job, Pipeline, RepeaterConfig, CurlConfig } from "@shared/schema/index.js";
import { VariableContext, resolveJobConfig } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor, ExecuteJobFn } from "./index.js";
import { executeCurlJob } from "@domain/core/infrastructure/http-executor.service.js";
import { AppError } from "@server/utils/errors.js";

export class RepeaterExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "repeater";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { traceContext?: any },
        executeJob?: ExecuteJobFn
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as RepeaterConfig;

        let items: any[] = [];
        try {
            if (config.inputSource) {
                if (Array.isArray(config.inputSource)) {
                    items = config.inputSource;
                } else if (typeof config.inputSource === 'string') {
                    try {
                        items = JSON.parse(config.inputSource);
                    } catch {
                        items = [config.inputSource];
                    }
                } else {
                    items = [config.inputSource];
                }
            }
        } catch (e) {
            console.warn(`[RepeaterExecutor] Failed to parse input source:`, e);
            items = [];
        }

        if (!Array.isArray(items)) items = [items];

        const results: any[] = [];
        const limit = config.maxIterations || items.length;
        const processingItems = items.slice(0, limit);

        for (const [index, item] of processingItems.entries()) {
            const itemContext = { ...context };
            const varName = config.itemVariable || 'item';
            // @ts-ignore
            itemContext.named[varName] = item;

            const nested = config.nestedJobConfig;

            // Dummy Job for resolution
            const dummyJob: Job = {
                ...job,
                id: -1,
                type: 'curl',
                config: nested as any
            } as Job; // cast needed due to partial update?

            try {
                // Resolve nested config with item in context
                const resolvedNested = resolveJobConfig(dummyJob.type, dummyJob.config, itemContext as any);
                const executionResult = await executeCurlJob(resolvedNested as CurlConfig, context.traceContext);
                results.push({
                    status: 'success',
                    output: executionResult,
                    item: item
                });

            } catch (err: any) {
                console.error(`[RepeaterExecutor] Iteration ${index} failed:`, err);
                results.push({
                    status: 'failure',
                    error: err.message,
                    item: item
                });
            }

            if ((config as any).waitBetweenMs) {
                await new Promise(r => setTimeout(r, (config as any).waitBetweenMs));
            }
        }

        return {
            success: true,
            output: JSON.stringify(results),
            status: "success"
        };
    }
}


