/**
 * Shared types and base registry for job executors. Extracted from
 * ./index.ts so executor-registry.ts can extend JobExecutorRegistry
 * without forming a circular import (index -> executor-registry -> index).
 */

import type { Job, Pipeline } from "@shared/schema/index.js";
import type { VariableContext } from "../../../../core/variable-resolver.js";
import type { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";

export type { Job, Pipeline, VariableContext, StepExecutionResult };
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { jobLogger } from "../../../../utils/logger.js";

export type ExecuteJobFn = (
    job: Job,
    pipeline: Pipeline,
    context: VariableContext & { data?: Record<string, any>; traceContext?: TraceContext },
    stepOrder: number,
    ...args: any[]
) => Promise<StepExecutionResult>;

export interface JobExecutor {
    canExecute(jobType: string): boolean;
    execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any>; traceContext?: TraceContext },
        ...args: any[]
    ): Promise<StepExecutionResult>;
}

export class JobExecutorRegistry {
    protected executors: JobExecutor[] = [];

    register(executor: JobExecutor) {
        this.executors.push(executor);
    }

    getExecutor(jobType: string): JobExecutor | undefined {
        jobLogger.info(`Searching for executor for type: ${jobType}. Total executors: ${this.executors.length}`);
        const found = this.executors.find(e => e.canExecute(jobType));
        if (!found) {
            jobLogger.warn(`❌ No executor found for type: ${jobType}. Registered types: ${this.executors.map(e => (e as any).constructor.name).join(", ")}`);
        }
        return found;
    }
}
