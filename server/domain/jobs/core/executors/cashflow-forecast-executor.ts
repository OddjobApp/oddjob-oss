/**
 * cashflow_forecast executor (BudgetMaster / SAWM, cadence addition).
 *
 * Powers both the weekly 13-week rolling forecast and the ad-hoc runway what-if.
 * Config: { horizonWeeks?, safetyFloor?, scenario?: ScenarioDelta[],
 *           scenarioLabel? }. A non-empty `scenario` marks the run as a scenario.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { AppRecordsStore } from "../../../finance/core/app-records-store.js";
import { projectCashFlow } from "../../../finance/core/cash-flow-forecast.service.js";
import { registerCashflowPrediction, createPodForecastPredictionPort } from "../../../finance/core/forecast-prediction.bridge.js";

export class CashflowForecastExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "cashflow_forecast";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "cashflow_forecast requires an organizationId" };
        }

        const cfg = resolvedConfig ?? {};
        const store = await AppRecordsStore.forOrg(orgId);
        const forecast = await projectCashFlow(store, {
            horizonWeeks: cfg.horizonWeeks,
            safetyFloor: cfg.safetyFloor,
            scenario: Array.isArray(cfg.scenario) ? cfg.scenario : [],
            scenarioLabel: cfg.scenarioLabel,
            persist: true,
        });

        // Register the baseline forecast as a calibrated prediction (best-effort;
        // ad-hoc what-if scenarios are not tracked — they're not a standing claim).
        if (forecast.kind === "rolling_13week") {
            try {
                const port = await createPodForecastPredictionPort();
                await registerCashflowPrediction(store, port, { orgId, forecast });
            } catch { /* prediction tracking is advisory — never block the forecast */ }
        }

        return {
            success: true,
            output: JSON.stringify(forecast),
            status: "success",
            telemetry: {
                kind: forecast.kind,
                projected_min_balance: forecast.projected_min_balance,
                shortfall: forecast.shortfall_flag,
            },
        };
    }
}
