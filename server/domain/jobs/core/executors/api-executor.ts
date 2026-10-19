import { Job, Pipeline, ApiConfig, CurlConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { executeCurlJob } from "@domain/core/infrastructure/http-executor.service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { ExecutorMetadata } from "./executor-metadata.js";

export class ApiExecutor implements JobExecutor {
    static metadata: ExecutorMetadata = {
        name: 'API Executor',
        version: '1.0.0',
        jobTypes: ['api', 'curl'],
        description: 'Execute HTTP requests to external APIs',
        capabilities: ['http', 'https', 'auth', 'retry'],
        requiredConfig: ['url', 'method'],
        optionalConfig: ['headers', 'body', 'timeout'],
    };

    canExecute(jobType: string): boolean {
        return jobType === "api" || jobType === "curl";
    }

    async execute(
        job: Job,
        resolvedConfig: ApiConfig | CurlConfig,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any>; traceContext?: TraceContext }
    ): Promise<StepExecutionResult> {
        const output = await executeCurlJob(resolvedConfig as CurlConfig, context.traceContext);
        return {
            success: true,
            output,
            status: "success"
        };
    }
}


