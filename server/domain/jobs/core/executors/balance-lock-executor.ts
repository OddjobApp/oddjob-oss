/**
 * balance_lock executor (BudgetMaster / SAWM, PRD §6 + §4.2 weekly).
 *
 * Two modes (config.mode):
 *   - "lock" (default, monthly 0 0 1 * *): write an immutable net-worth
 *     `balance_snapshots` row for the period. failIfExists means a month can
 *     never be silently rewritten.
 *   - "capex" (weekly 0 12 * * 0): flag CapEx-project contexts whose spend has
 *     exceeded their allocation cap → `capex_overrun` recommendation.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { AppRecordsStore } from "../../../finance/core/app-records-store.js";
import { lockBalanceSheet, computeCapexBurn } from "../../../finance/core/balance-lock.service.js";

export class BalanceLockExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "balance_lock";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "balance_lock requires an organizationId" };
        }

        const cfg = resolvedConfig ?? {};
        const store = await AppRecordsStore.forOrg(orgId);

        if (cfg.mode === "capex") {
            const result = await computeCapexBurn(store);
            return {
                success: true,
                output: JSON.stringify(result),
                status: "success",
                telemetry: { capex_overruns: result.overruns.length },
            };
        }

        const result = await lockBalanceSheet(store, { period: cfg.period });
        return {
            success: true,
            output: JSON.stringify(result),
            status: "success",
            telemetry: { net_worth: result.snapshot.net_worth, already_locked: result.alreadyLocked },
        };
    }
}
