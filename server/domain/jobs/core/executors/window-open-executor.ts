/**
 * window_open executor (Sales Opportunity Pipeline).
 *
 * Step PIPE-2 of mission-add-to-pipeline: arm a fresh narrowing-probability
 * window at the top rung (90%) for a newly created opportunity and write the
 * opening snapshot. Thin deterministic wrapper over openWindow() — the engine
 * logic already exists and unit-tests against InMemoryRecordStore.
 *
 * Config: { opportunity_id, amount, cycle_length_days, gate_ladder?,
 *           grace_period_hours?, rearm_signals? }.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { salesStoreForOrg } from "../../../sales/core/sales-records-store.js";
import { openWindow } from "../../../sales/core/opportunity-window.service.js";

export class WindowOpenExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "window_open";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "window_open requires an organizationId" };
        }

        const cfg = { ...(context?.data ?? {}), ...(resolvedConfig ?? {}) };
        const opportunity_id = cfg.opportunity_id ? String(cfg.opportunity_id) : "";
        const amount = Number(cfg.amount);
        const cycle_length_days = Number(cfg.cycle_length_days);
        if (!opportunity_id || !Number.isFinite(amount) || !Number.isFinite(cycle_length_days) || cycle_length_days <= 0) {
            return {
                success: false,
                output: "",
                status: "failure",
                error: "window_open requires opportunity_id, a numeric amount, and a positive cycle_length_days",
            };
        }

        const store = await salesStoreForOrg(orgId);
        const ladder = Array.isArray(cfg.gate_ladder) ? cfg.gate_ladder.map(Number).filter(Number.isFinite) : undefined;
        const rearm_signals = Array.isArray(cfg.rearm_signals) ? cfg.rearm_signals.map(String) : undefined;

        const window = await openWindow(store, {
            opportunity_id,
            amount,
            cycle_length_days,
            gate_ladder: ladder && ladder.length >= 2 ? ladder : undefined,
            grace_period_hours: cfg.grace_period_hours != null ? Number(cfg.grace_period_hours) : undefined,
            rearm_signals,
            now: new Date(),
        });

        return {
            success: true,
            output: JSON.stringify(window),
            status: "success",
            telemetry: {
                window_id: window.window_id,
                opportunity_id: window.opportunity_id,
                opening_ceiling: window.current_ceiling,
            },
        };
    }
}
