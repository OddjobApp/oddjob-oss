/**
 * amortize_sim executor (BudgetMaster / SAWM, PRD §4.3).
 *
 * On-demand Capital Purchase Sandbox math: given a financed purchase, compute
 * the amortization schedule, total interest, and the opportunity cost of the
 * down payment had it been invested instead. The core calc is pure; if a
 * `sandboxId` is supplied the result is persisted to `purchase_sandboxes` so the
 * workbench can render it.
 *
 * Config: { principal, downPayment, annualRate, termMonths, opportunityRate?,
 *           sandboxId?, label? }.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { AppRecordsStore } from "../../../finance/core/app-records-store.js";
import { FinanceCollections } from "../../../finance/core/collections.js";
import { simulateAmortization } from "../../../finance/core/amortization.service.js";

export class AmortizeSimExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "amortize_sim";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const cfg = resolvedConfig ?? {};
        const result = simulateAmortization({
            principal: Number(cfg.principal) || 0,
            downPayment: Number(cfg.downPayment) || 0,
            annualRate: Number(cfg.annualRate) || 0,
            termMonths: Number(cfg.termMonths) || 1,
            opportunityRate: cfg.opportunityRate != null ? Number(cfg.opportunityRate) : undefined,
        });

                // Optional persistence so the sandboxes module can render the scenario.
        if (cfg.sandboxId && job.organizationId) {
            try {
                const store = await AppRecordsStore.forOrg(job.organizationId);
                await store.upsert(FinanceCollections.purchaseSandboxes, String(cfg.sandboxId), {
                    sandbox_id: String(cfg.sandboxId),
                    label: cfg.label ?? "Capital Purchase Scenario",
                    inputs: {
                        principal: cfg.principal,
                        downPayment: cfg.downPayment,
                        annualRate: cfg.annualRate,
                        termMonths: cfg.termMonths,
                        opportunityRate: cfg.opportunityRate,
                    },
                    result,
                    computed_at: new Date().toISOString(),
                });
                
                // Publish dataset.updated event so Next.js apps receive the real-time update
                try {
                    const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
                    await eventStream.publish("dataset.updated", {
                        organizationId: job.organizationId,
                        collection: FinanceCollections.purchaseSandboxes,
                        recordId: String(cfg.sandboxId),
                    }, {
                        organizationId: job.organizationId
                    });
                } catch (publishErr: any) {
                    console.warn(`[AmortizeSimExecutor] Failed to publish dataset.updated for ${cfg.sandboxId}: ${publishErr?.message}`);
                }
            } catch (err: any) {
                // Persistence is best-effort; the computed result is still returned.
                console.warn(`[AmortizeSimExecutor] Could not persist sandbox ${cfg.sandboxId}: ${err?.message}`);
            }
        }

        return {
            success: true,
            output: JSON.stringify(result),
            status: "success",
            telemetry: { monthly_payment: result.monthlyPayment, true_cost: result.trueCost },
        };
    }
}
