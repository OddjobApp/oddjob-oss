/**
 * receivables_scan executor (BudgetMaster / SAWM, cadence addition).
 *
 * Weekly sweep for open/overdue invoices; flips past-due invoices to OVERDUE and
 * raises receivable_overdue recommendations. Config: { graceDays? }.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { AppRecordsStore } from "../../../finance/core/app-records-store.js";
import { scanReceivables } from "../../../finance/core/receivables.service.js";

export class ReceivablesScanExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "receivables_scan";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "receivables_scan requires an organizationId" };
        }

        const cfg = resolvedConfig ?? {};
        const store = await AppRecordsStore.forOrg(orgId);
        const result = await scanReceivables(store, { graceDays: cfg.graceDays });

        return {
            success: true,
            output: JSON.stringify(result),
            status: "success",
            telemetry: { overdue_count: result.overdue.length, total_overdue: result.totalOverdue },
        };
    }
}
