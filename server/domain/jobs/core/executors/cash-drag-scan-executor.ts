/**
 * cash_drag_scan executor (BudgetMaster / SAWM, PRD §4.2).
 *
 * Daily scan for idle cash above a liquidity floor sitting in low-yield
 * checking accounts; raises `sweep` recommendations (advisory only — no real
 * transfer is performed). Config: { floor?, yieldDelta?, minDragToFlag? }.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { AppRecordsStore } from "../../../finance/core/app-records-store.js";
import { scanIdleCash } from "../../../finance/core/cash-drag.service.js";

export class CashDragScanExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "cash_drag_scan";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "cash_drag_scan requires an organizationId" };
        }

        const cfg = resolvedConfig ?? {};
        const store = await AppRecordsStore.forOrg(orgId);
        const result = await scanIdleCash(store, {
            floor: cfg.floor,
            yieldDelta: cfg.yieldDelta,
            minDragToFlag: cfg.minDragToFlag,
        });

        return {
            success: true,
            output: JSON.stringify(result),
            status: "success",
            telemetry: { sweeps_flagged: result.sweeps.length, total_idle: result.totalIdle },
        };
    }
}
