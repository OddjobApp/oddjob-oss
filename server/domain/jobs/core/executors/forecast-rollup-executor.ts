/**
 * forecast_rollup executor (Sales Opportunity Pipeline).
 *
 * Step FCST-1 of mission-generate-forecast: roll up the live weighted pipeline
 * from current window ceilings and persist a forecasts snapshot. Deterministic.
 *
 *   • weighted_pipeline — Σ(amount × current_ceiling/100) over live windows
 *                         (the probability-weighted most-likely number).
 *   • committed         — weighted contribution of top-rung deals only
 *                         (ceiling === ladder top) — the safest commit.
 *   • best_case         — Σ full amount over all live windows.
 *   ⇒ committed ≤ weighted_pipeline ≤ best_case by construction.
 *
 * Config: { period? }.
 */

import crypto from "crypto";
import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { salesStoreForOrg } from "../../../sales/core/sales-records-store.js";
import { SalesCollections } from "../../../sales/core/collections.js";
import {
    currentWeightedPipeline,
    parseLadder,
    type OpportunityWindow,
} from "../../../sales/core/opportunity-window.service.js";

const round2 = (n: number): number => Math.round(n * 100) / 100;

export class ForecastRollupExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "forecast_rollup";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "forecast_rollup requires an organizationId" };
        }

        const cfg = { ...(context?.data ?? {}), ...(resolvedConfig ?? {}) };
        const now = new Date();
        const period = cfg.period ? String(cfg.period) : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

        const store = await salesStoreForOrg(orgId);
        const windows = (await store.list<OpportunityWindow>(SalesCollections.opportunityWindows)).map((r) => r.data);
        const live = windows.filter((w) => w.status === "ARMED" || w.status === "DECAYING");

        const weighted_pipeline = await currentWeightedPipeline(store);
        let committed = 0;
        let best_case = 0;
        for (const w of live) {
            const top = parseLadder(w)[0];
            if (w.current_ceiling >= top) committed += (w.amount * w.current_ceiling) / 100;
            best_case += w.amount;
        }
        committed = round2(committed);
        best_case = round2(best_case);

        const forecast_id = `fcst_${now.getTime()}_${crypto.randomBytes(4).toString("hex")}`;
        const forecast = {
            forecast_id,
            period,
            generated_at: now.toISOString(),
            weighted_pipeline,
            committed,
            best_case,
            deal_count: live.length,
            generated_by: "forecast_rollup",
        };
        await store.upsert(SalesCollections.forecasts, forecast_id, forecast);

        return {
            success: true,
            output: JSON.stringify(forecast),
            status: "success",
            telemetry: { weighted_pipeline, committed, best_case, deal_count: live.length },
        };
    }
}
