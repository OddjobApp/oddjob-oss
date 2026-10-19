/**
 * information_return_assemble executor (BudgetMaster / SAWM, cadence addition).
 *
 * Clusters business payments by recipient for the tax year, builds 1099-NEC /
 * W-2 tax_documents (preserving W-9 / TIN flags), and raises an info_return_due
 * recommendation flagging missing W-9s. Config: { taxYear?, threshold? }.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { AppRecordsStore } from "../../../finance/core/app-records-store.js";
import { assembleInformationReturns } from "../../../finance/core/information-returns.service.js";

export class InformationReturnAssembleExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "information_return_assemble";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "information_return_assemble requires an organizationId" };
        }

        const cfg = resolvedConfig ?? {};
        const store = await AppRecordsStore.forOrg(orgId);
        const result = await assembleInformationReturns(store, {
            taxYear: cfg.taxYear,
            threshold: cfg.threshold,
            persist: true,
        });

        return {
            success: true,
            output: JSON.stringify(result),
            status: "success",
            telemetry: { document_count: result.documents.length, missing_w9: result.missingW9.length },
        };
    }
}
