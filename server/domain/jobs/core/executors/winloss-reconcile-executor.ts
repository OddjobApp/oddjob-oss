/**
 * winloss_reconcile executor (Sales Opportunity Pipeline).
 *
 * The terminal step (WIN-2) of mission-window-decay-sweep: any non-terminal
 * window whose opportunity has reached CLOSED_WON / CLOSED_LOST is frozen
 * (won=100 / lost=0), a terminal snapshot is written, and `realized_outcome` is
 * backfilled across that window's snapshot history — turning the decay curve
 * into labelled data for gate calibration. Deterministic (no LLM).
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { salesStoreForOrg } from "../../../sales/core/sales-records-store.js";
import { reconcileWonLoss } from "../../../sales/core/opportunity-window.service.js";

export class WinLossReconcileExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "winloss_reconcile";
    }

    async execute(
        job: Job,
        _resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "winloss_reconcile requires an organizationId" };
        }

        const store = await salesStoreForOrg(orgId);
        const result = await reconcileWonLoss(store, new Date());

        return {
            success: true,
            output: JSON.stringify(result),
            status: "success",
            telemetry: {
                windows_won: result.won.length,
                windows_lost: result.lost.length,
                snapshots_backfilled: result.backfilled,
            },
        };
    }
}
