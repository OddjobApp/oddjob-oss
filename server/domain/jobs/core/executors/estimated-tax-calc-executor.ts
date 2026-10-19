/**
 * estimated_tax_calc executor (BudgetMaster / SAWM, cadence addition).
 *
 * Projects quarterly self-employment + income tax on YTD net profit and persists
 * a PROJECTED tax_estimate + estimated_tax_due recommendation. Advisory only.
 * Config: { taxYear?, periodLabel?, dueDate?, incomeTaxRate?, priorYearTotalTax?,
 *           safeHarborMultiplier? }.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { AppRecordsStore } from "../../../finance/core/app-records-store.js";
import { projectEstimatedTax } from "../../../finance/core/estimated-tax.service.js";
import { registerTaxPrediction, createPodForecastPredictionPort } from "../../../finance/core/forecast-prediction.bridge.js";

export class EstimatedTaxCalcExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "estimated_tax_calc";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "estimated_tax_calc requires an organizationId" };
        }

        const cfg = resolvedConfig ?? {};
        const store = await AppRecordsStore.forOrg(orgId);
        const estimate = await projectEstimatedTax(store, {
            taxYear: cfg.taxYear,
            periodLabel: cfg.periodLabel,
            dueDate: cfg.dueDate,
            incomeTaxRate: cfg.incomeTaxRate,
            priorYearTotalTax: cfg.priorYearTotalTax,
            safeHarborMultiplier: cfg.safeHarborMultiplier,
            persist: true,
        });

        // Register the estimate as a calibrated prediction (best-effort).
        try {
            const port = await createPodForecastPredictionPort();
            await registerTaxPrediction(store, port, { orgId, estimate });
        } catch { /* prediction tracking is advisory — never block the estimate */ }

        return {
            success: true,
            output: JSON.stringify(estimate),
            status: "success",
            telemetry: { period: estimate.estimate_id, total_due: estimate.total_due },
        };
    }
}
