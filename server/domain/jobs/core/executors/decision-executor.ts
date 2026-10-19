
import { Job, Pipeline, DecisionConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { AppError, ErrorCode } from "@server/utils/errors.js";

export class DecisionExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "decision";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as DecisionConfig;

        try {
            // Dynamic import to avoid circular dependencies if any (though unlikely here)
            // Using relative path to core/expression-evaluator
            const { evaluateCondition } = await import("../../../../core/expression-evaluator.js");

            const isTrue = evaluateCondition(config.condition, context);

            return {
                success: true,
                output: String(isTrue),
                status: "success",
            };
        } catch (e: any) {
            throw new AppError(
                `Decision condition failed to evaluate: ${e.message}`,
                400,
                ErrorCode.VALIDATION_FAILED,
                { details: { originalError: e.message } }
            );
        }
    }
}


