
import { Job, Pipeline, TransformerConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";

export class TransformerExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "transformer";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> }
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as TransformerConfig;
        const { TransformationEngine } = await import("../../../../domain/pipeline/core/transformation-engine.service.js");
        const engine = new TransformationEngine();
        const inputData = context.data?.input || (context.currentStepOrder !== undefined ? context.positional[context.currentStepOrder - 1] : undefined);

        if (inputData === undefined || inputData === null) {
            return {
                success: true,
                output: JSON.stringify({ transformed: null, skipped: true, reason: "No input data from upstream step" }),
                status: "success"
            };
        }

        const res = await engine.executeTransformations(inputData, config, { inputData, previousStepOutput: inputData });

        return {
            success: true,
            output: JSON.stringify(res, null, 2),
            status: "success"
        };
    }
}


