/**
 * subscription_scan executor (BudgetMaster / SAWM, PRD §4.4).
 *
 * Monthly scan of recurring charges scoring each by utility (cost per logged
 * usage hour). Zero-usage / high-cost-per-use subscriptions are quarantined and
 * a `quarantine` cancellation recommendation is raised. Config:
 * { staleDays?, maxCostPerHour? }.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { AppRecordsStore } from "../../../finance/core/app-records-store.js";
import { scanSubscriptions } from "../../../finance/core/subscription-decay.service.js";

export class SubscriptionScanExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "subscription_scan";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "subscription_scan requires an organizationId" };
        }

        const cfg = resolvedConfig ?? {};
        const store = await AppRecordsStore.forOrg(orgId);
        const result = await scanSubscriptions(store, {
            staleDays: cfg.staleDays,
            maxCostPerHour: cfg.maxCostPerHour,
        });

        return {
            success: true,
            output: JSON.stringify(result),
            status: "success",
            telemetry: { subscriptions_quarantined: result.quarantined.length },
        };
    }
}
