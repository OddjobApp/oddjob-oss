/**
 * pipeline_post executor (Sales Opportunity Pipeline).
 *
 * Step PIPE-1 of mission-add-to-pipeline (create_opportunity): persist the
 * opportunity row, set its stage/amount/entitlement, and write the first
 * stage_history entry. Deterministic — the window itself is armed separately by
 * the window_open step (PIPE-2). Idempotent on opportunity_id.
 *
 * Config: { opportunity_id?, account_id?, lead_id?, name, amount, currency?,
 *           stage?, stage_entitlement?, owner_rep?, expected_close?, changed_by? }.
 */

import crypto from "crypto";
import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { salesStoreForOrg } from "../../../sales/core/sales-records-store.js";
import { SalesCollections } from "../../../sales/core/collections.js";

/** Default ceiling a stage re-baselines its window up to (the stage entitlement). */
const STAGE_ENTITLEMENT: Record<string, number> = {
    PROSPECT: 90,
    QUALIFIED: 90,
    PROPOSAL: 60,
    NEGOTIATION: 60,
    CLOSED_WON: 100,
    CLOSED_LOST: 0,
};

export class PipelinePostExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "pipeline_post";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "pipeline_post requires an organizationId" };
        }

        const cfg = { ...(context?.data ?? {}), ...(resolvedConfig ?? {}) };
        const name = cfg.name ? String(cfg.name) : "";
        const amount = Number(cfg.amount);
        if (!name || !Number.isFinite(amount)) {
            return { success: false, output: "", status: "failure", error: "pipeline_post requires a name and a numeric amount" };
        }

        const now = new Date();
        const opportunity_id = cfg.opportunity_id
            ? String(cfg.opportunity_id)
            : `opp_${now.getTime()}_${crypto.randomBytes(4).toString("hex")}`;
        const stage = cfg.stage ? String(cfg.stage) : "PROSPECT";
        const stage_entitlement =
            cfg.stage_entitlement != null ? Number(cfg.stage_entitlement) : (STAGE_ENTITLEMENT[stage] ?? 90);

        const store = await salesStoreForOrg(orgId);

        const opportunity = {
            opportunity_id,
            account_id: cfg.account_id ? String(cfg.account_id) : "",
            lead_id: cfg.lead_id ? String(cfg.lead_id) : "",
            name,
            amount,
            currency: cfg.currency ? String(cfg.currency) : "USD",
            stage,
            stage_entitlement,
            owner_rep: cfg.owner_rep ? String(cfg.owner_rep) : "",
            opened_at: now.toISOString(),
            expected_close: cfg.expected_close ? String(cfg.expected_close) : "",
            outcome: null,
            closed_at: null,
        };
        await store.upsert(SalesCollections.opportunities, opportunity_id, opportunity);

        const entry_id = `sh_${now.getTime()}_${crypto.randomBytes(4).toString("hex")}`;
        await store.upsert(SalesCollections.stageHistory, entry_id, {
            entry_id,
            opportunity_id,
            from_stage: "",
            to_stage: stage,
            changed_at: now.toISOString(),
            changed_by: cfg.changed_by ? String(cfg.changed_by) : "pipeline_post",
        });

        return {
            success: true,
            output: JSON.stringify({ opportunity, stage_history_entry_id: entry_id }),
            status: "success",
            telemetry: { opportunity_id, stage, amount },
        };
    }
}
