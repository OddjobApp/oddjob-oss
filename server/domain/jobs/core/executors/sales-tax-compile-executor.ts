/**
 * sales_tax_compile executor (BudgetMaster / SAWM, cadence addition).
 *
 * Aggregates quarterly taxable sales and applies the configured rate to produce
 * a filing-ready collected-tax total; raises a sales_tax_due recommendation.
 * Config: { taxYear?, quarter?, rate? }.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { AppRecordsStore } from "../../../finance/core/app-records-store.js";
import { compileSalesTax } from "../../../finance/core/sales-tax.service.js";

export class SalesTaxCompileExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "sales_tax_compile";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "sales_tax_compile requires an organizationId" };
        }

        const cfg = resolvedConfig ?? {};
        const store = await AppRecordsStore.forOrg(orgId);
        const summary = await compileSalesTax(store, {
            taxYear: cfg.taxYear,
            quarter: cfg.quarter,
            rate: cfg.rate,
            persist: true,
        });

        return {
            success: true,
            output: JSON.stringify(summary),
            status: "success",
            telemetry: { quarter: summary.quarter, tax_collected: summary.tax_collected },
        };
    }
}
