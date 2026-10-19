/**
 * forecast_calibration executor (BudgetMaster / SAWM, prediction-intelligence loop).
 *
 * Reconciles matured forecast predictions (written by the cash-flow and
 * estimated-tax engines) against their actual outcomes through the Prediction
 * Intelligence calibration pod. Writes a forecast_calibrations record per
 * reconciled prediction and raises a forecast_miscalibrated recommendation when
 * the pod detects systematic over/under-confidence. Config: none.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { AppRecordsStore } from "../../../finance/core/app-records-store.js";
import { reconcileForecastOutcomes, createPodForecastPredictionPort } from "../../../finance/core/forecast-prediction.bridge.js";

export class ForecastCalibrationExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "forecast_calibration";
    }

    async execute(
        job: Job,
        _resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "forecast_calibration requires an organizationId" };
        }

        const store = await AppRecordsStore.forOrg(orgId);
        const port = await createPodForecastPredictionPort();
        const result = await reconcileForecastOutcomes(store, port, { orgId });

        return {
            success: true,
            output: JSON.stringify(result),
            status: "success",
            telemetry: {
                reconciled: result.reconciled,
                miscalibrated: result.miscalibrated,
                pending: result.pending,
            },
        };
    }
}
