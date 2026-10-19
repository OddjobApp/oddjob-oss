import { Job, Pipeline } from "@shared/schema/index.js";
import { computeKinematicForecast, isImplementedFramework } from "@shared/prediction-kinematics.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";

/**
 * PredictionInferenceExecutor
 *
 * Evaluates streaming prediction surrogates (ONNX, LightGBM, Kinematic)
 * inside an Oddjob pipeline DAG step. Computes p10, p50, and p90 confidence
 * envelopes and breach alarms for downstream CEL guards.
 */
export class PredictionInferenceExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "prediction_inference" || jobType.trim() === "prediction_inference";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig;
        const modelId = config.modelId || "surrogate-default-01";
        const framework = config.framework || "onnx";

        // A config naming a framework nothing implements used to be handed the
        // kinematic answer anyway, under its own label -- and "onnx" is the
        // schema default, so that was the usual case. Refused instead: a caller
        // who asked for ONNX should be told there is no ONNX, not quietly given
        // arithmetic wearing its name.
        if (!isImplementedFramework(framework)) {
            return {
                success: false,
                output: "",
                status: "failure",
                error:
                    `Framework "${framework}" is not implemented. This platform computes a kinematic ` +
                    `surrogate only — set framework to "kinematic_surrogate", or build the ${framework} ` +
                    `runtime before configuring a job against it.`,
            };
        }

        let features: Record<string, unknown> = {};
        if (typeof config.inputFeatures === "string") {
            try {
                features = JSON.parse(config.inputFeatures);
            } catch {
                features = { value: config.inputFeatures };
            }
        } else if (typeof config.inputFeatures === "object" && config.inputFeatures !== null) {
            features = config.inputFeatures;
        }

        const forecast = computeKinematicForecast({
            features,
            horizonSeconds: Number(config.horizonSeconds || 300),
            confidenceThreshold: Number(config.confidenceThreshold || 0.75),
        });

        const output = JSON.stringify({ modelId, ...forecast }, null, 2);

        const telemetry = {
            model_id: modelId,
            framework: forecast.method,
            p50_confidence: forecast.p50,
            breach_detected: forecast.breachDetected,
            eta_seconds: forecast.etaSeconds,
            time_to_breach_min: forecast.timeToBreachMinutes,
            effective_velocity_knots: forecast.effectiveVelocityKnots,
        };

        return {
            success: true,
            output,
            status: "success",
            telemetry,
        };
    }
}
