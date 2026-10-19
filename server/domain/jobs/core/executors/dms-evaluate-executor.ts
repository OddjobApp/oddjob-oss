/**
 * dms_evaluate executor (BudgetMaster / SAWM, PRD §4.1).
 *
 * Hourly/daily sweep over `dead_mans_switches`: any ARMED switch whose
 * expiration_deadline + grace window has elapsed trips to FAULT and a
 * `dms_fault` recommendation is raised for human response. Deterministic
 * (no LLM) so it is fully testable.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { AppRecordsStore } from "../../../finance/core/app-records-store.js";
import { evaluateSwitches } from "../../../finance/core/dead-mans-switch.service.js";

export class DmsEvaluateExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "dms_evaluate";
    }

    async execute(
        job: Job,
        _resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "dms_evaluate requires an organizationId" };
        }

        const store = await AppRecordsStore.forOrg(orgId);
        const result = await evaluateSwitches(store, new Date());

        return {
            success: true,
            output: JSON.stringify(result),
            status: "success",
            telemetry: { dms_faulted: result.faulted.length, shielded_amount: result.shieldedAmount },
        };
    }
}
