import { Job, Pipeline, IteratorConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor, ExecuteJobFn } from "./index.js";
import { jobService } from "../../job.service.js";
import { pipelineService } from "../../../pipeline/core/pipeline.service.js";
import { JobNotFoundError, AppError, NotFoundError } from "@server/utils/errors.js";

/**
 * Extract array from inputArray. Handles:
 * - JSON array string: "[1,2,3]"
 * - JSON object with common array keys: {"items":[...]}, {"data":[...]}, {"results":[...]}
 * - Single value wrapped in array
 */
function parseInputArray(input: string): any[] {
    if (!input || typeof input !== "string") return [];

    const trimmed = input.trim();
    if (!trimmed) return [];

    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;

        // Object with common array property names
        if (parsed && typeof parsed === "object") {
            const arr = parsed.items ?? parsed.data ?? parsed.results ?? parsed.records ?? parsed.rows;
            if (Array.isArray(arr)) return arr;
        }

        return [parsed];
    } catch {
        return [input];
    }
}

function runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (concurrency <= 1) {
        return Promise.all(items.map((item, i) => fn(item, i)));
    }
    const results: R[] = new Array(items.length);
    let index = 0;

    async function worker(): Promise<void> {
        while (index < items.length) {
            const i = index++;
            if (i >= items.length) break;
            results[i] = await fn(items[i], i);
        }
    }

    const workers = Math.min(concurrency, items.length);
    return Promise.all(Array.from({ length: workers }, () => worker())).then(() => results);
}

export class IteratorExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "iterator";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
        executeJob?: ExecuteJobFn
    ): Promise<StepExecutionResult> {
        if (!executeJob) {
            throw new AppError("IteratorExecutor requires executeJob callback");
        }

        const config = resolvedConfig as IteratorConfig;
        const items = parseInputArray(config.inputArray);

        if (items.length === 0) {
            return {
                success: true,
                output: JSON.stringify([]),
                status: "success",
            };
        }

        let output = "";
        let status = "success";

        if (config.mode === "job") {
            let targetJob;
            try {
                targetJob = await jobService.getById(config.targetId, {
                    userId: "system",
                    organizationId: pipeline.organizationId,
                    isAdmin: false,
                    isSuperAdmin: true,
                    isOrgAdmin: false,
                });
            } catch (err) {
                if (err instanceof NotFoundError) throw new JobNotFoundError(config.targetId);
                throw err;
            }

            const results: any[] = [];
            const errors: string[] = [];
            const concurrency = Math.min(Math.max(1, config.concurrency ?? 1), 50);

            console.log(`[Iterator] Processing ${items.length} items. Target Job: ${config.targetId}, concurrency: ${concurrency}`);

            const runOne = async (item: any, i: number) => {
                const itemContext = structuredClone(context);
                itemContext.named[config.itemVarName] = item as any;
                itemContext.item = item;
                itemContext.itemIndex = i;
                itemContext.data = { ...itemContext.data, [config.itemVarName]: item };

                const res = await executeJob(targetJob, pipeline, itemContext, 0);

                if (config.aggregateOutputs && res.success) {
                    try {
                        return JSON.parse(res.output);
                    } catch {
                        return res.output;
                    }
                } else if (!res.success) {
                    errors.push(`Item ${i} failed: ${res.error}`);
                }
                return null;
            };

            const runResults = await runWithConcurrency(items, concurrency, runOne);

            for (const r of runResults) {
                if (r !== null) results.push(r);
            }

            if (errors.length > 0 && results.length === 0) {
                throw new Error(`All iterations failed. Errors: ${errors.join("; ")}`);
            }

            output = JSON.stringify(results);
            status = "success";
        } else if (config.mode === "pipeline") {
            const targetPipeline = await pipelineService.getSystem(config.targetId);
            if (!targetPipeline) {
                throw new AppError(`Pipeline ${config.targetId} not found`, 404);
            }

            const results: any[] = [];
            const errors: string[] = [];
            const concurrency = Math.min(Math.max(1, config.concurrency ?? 1), 50);

            console.log(`[Iterator] Processing ${items.length} items. Target Pipeline: ${config.targetId}, concurrency: ${concurrency}`);

            const { pipelineExecutor } = await import("../../../../core/pipeline-executor.js");

            const runOne = async (item: any, i: number) => {
                const itemContext = structuredClone(context);
                itemContext.named[config.itemVarName] = item as any;
                itemContext.item = item;
                itemContext.itemIndex = i;
                itemContext.data = { ...itemContext.data, [config.itemVarName]: item };

                const execResult = await pipelineExecutor.executePipeline(
                    config.targetId,
                    pipeline.createdBy || "system",
                    undefined,
                    undefined,
                    itemContext.named
                );

                if (config.aggregateOutputs && execResult.success) {
                    return { success: execResult.success, stepResults: execResult.stepResults };
                } else if (!execResult.success) {
                    errors.push(`Item ${i} failed: ${execResult.error}`);
                }
                return null;
            };

            const runResults = await runWithConcurrency(items, concurrency, runOne);

            for (const r of runResults) {
                if (r !== null) results.push(r);
            }

            if (errors.length > 0 && results.length === 0) {
                throw new Error(`All pipeline iterations failed. Errors: ${errors.join("; ")}`);
            }

            output = JSON.stringify(results);
            status = "success";
        } else {
            throw new AppError(`Iterator mode '${config.mode}' is not supported`);
        }

        return {
            success: true,
            output,
            status,
        };
    }
}


