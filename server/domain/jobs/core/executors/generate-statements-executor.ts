/**
 * generate_statements executor (BudgetMaster / SAWM, cadence addition).
 *
 * Renders the monthly P&L, cash-flow statement, and budget-vs-actual variance
 * for a closed period. Pure compute — no ledger mutation. Config: { period? }.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { AppRecordsStore } from "../../../finance/core/app-records-store.js";
import { generateStatements } from "../../../finance/core/statements.service.js";

export class GenerateStatementsExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "generate_statements";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "generate_statements requires an organizationId" };
        }

        const cfg = resolvedConfig ?? {};
        const store = await AppRecordsStore.forOrg(orgId);
        const statements = await generateStatements(store, { period: cfg.period });

        return {
            success: true,
            output: JSON.stringify(statements),
            status: "success",
            telemetry: {
                period: statements.period,
                net_profit: statements.profit_and_loss.net_profit,
                over_budget_categories: statements.budget_vs_actual.filter((r) => r.over_budget).length,
            },
        };
    }
}
