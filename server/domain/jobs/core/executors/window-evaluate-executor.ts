/**
 * window_evaluate executor (Sales Opportunity Pipeline).
 *
 * The sweep step (WIN-1) of mission-window-decay-sweep: re-arm windows on buyer
 * engagement, step the ceiling down a rung on silence (90 → 60 → 30 → 0),
 * auto-close LOST at the 0% rung, and snapshot every transition. Deterministic
 * (no LLM) so it is fully testable. The `stepped` window_ids are the ones the
 * mission then routes to the Deal Window Decision human gate (WIN-3).
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { salesStoreForOrg } from "../../../sales/core/sales-records-store.js";
import { evaluateWindows } from "../../../sales/core/opportunity-window.service.js";

export class WindowEvaluateExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "window_evaluate";
    }

    async execute(
        job: Job,
        _resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "window_evaluate requires an organizationId" };
        }

        const store = await salesStoreForOrg(orgId);
        const result = await evaluateWindows(store, new Date());

        return {
            success: true,
            output: JSON.stringify(result),
            status: "success",
            telemetry: {
                windows_stepped: result.stepped.length,
                windows_rearmed: result.rearmed.length,
                windows_promoted: result.promoted.length,
                windows_lost: result.lost.length,
                snapshots_written: result.snapshots.length,
                weighted_pipeline: result.weightedPipeline,
            },
        };
    }
}
