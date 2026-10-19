/**
 * lead_qualify executor (Sales Opportunity Pipeline).
 *
 * Step QUAL-2 of mission-qualify-lead (score_fit): assess product fit for a lead
 * and persist a qualification_score + status back onto the lead row. Uses a
 * transparent deterministic heuristic over source / timeline / estimated value
 * so the score is reproducible and testable (no LLM). An LLM enrichment pass can
 * later layer on top, but the funnel no longer depends on free-form output that
 * never persists.
 *
 * Config: { lead_id, ...lead fields? }. The lead is read from the store by
 * lead_id; any fields supplied in config override the stored row.
 * Output (consumed by mission-add-to-pipeline): the qualification verdict +
 * recommended initial stage / amount / cycle_length_days.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { salesStoreForOrg } from "../../../sales/core/sales-records-store.js";
import { SalesCollections } from "../../../sales/core/collections.js";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

// Each factor contributes a bounded slice of the [0,1] score.
const SOURCE_WEIGHT: Record<string, number> = {
    Referral: 0.3, Partner: 0.3, Event: 0.22, LinkedIn: 0.2, Website: 0.2, "Cold Outreach": 0.1,
};
const TIMELINE_WEIGHT: Record<string, number> = {
    Immediate: 0.3, "1-3 months": 0.25, "3-6 months": 0.15, "6-12 months": 0.05, Unknown: 0.1,
};
// Timeline → a sensible default sales-interval length for the window.
const TIMELINE_CYCLE_DAYS: Record<string, number> = {
    Immediate: 14, "1-3 months": 45, "3-6 months": 120, "6-12 months": 270, Unknown: 90,
};
const VALUE_CAP = 100_000; // estimated value contributing its full 0.4 slice.

export class LeadQualifyExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "lead_qualify";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        _pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "lead_qualify requires an organizationId" };
        }

        const cfg = { ...(context?.data ?? {}), ...(resolvedConfig ?? {}) };
        const lead_id = cfg.lead_id ? String(cfg.lead_id) : "";
        if (!lead_id) {
            return { success: false, output: "", status: "failure", error: "lead_qualify requires a lead_id" };
        }

        const store = await salesStoreForOrg(orgId);
        const stored = await store.get<any>(SalesCollections.leads, lead_id);
        if (!stored && cfg.estimated_value == null && cfg.source == null) {
            return { success: false, output: "", status: "failure", error: `lead ${lead_id} not found` };
        }
        const lead = { ...(stored?.data ?? {}), ...cfg };

        const source = String(lead.source ?? "Unknown");
        const timeline = String(lead.timeline ?? "Unknown");
        const estimated_value = Number(lead.estimated_value) || 0;

        const sourceScore = SOURCE_WEIGHT[source] ?? 0.1;
        const timelineScore = TIMELINE_WEIGHT[timeline] ?? 0.1;
        const valueScore = Math.min(estimated_value / VALUE_CAP, 1) * 0.4;
        const qualification_score = round2(clamp01(sourceScore + timelineScore + valueScore));

        // Verdict thresholds: ≥0.5 advances; ≥0.7 enters as already-qualified.
        const status = qualification_score >= 0.5 ? "QUALIFIED" : "DISQUALIFIED";
        const recommended_stage = qualification_score >= 0.7 ? "QUALIFIED" : "PROSPECT";
        const cycle_length_days = TIMELINE_CYCLE_DAYS[timeline] ?? 90;

        await store.upsert(SalesCollections.leads, lead_id, {
            ...lead,
            lead_id,
            status,
            qualification_score,
        });

        const verdict = {
            lead_id,
            qualification_score,
            status,
            recommended_stage,
            recommended_amount: estimated_value,
            cycle_length_days,
            factors: { sourceScore, timelineScore, valueScore: round2(valueScore) },
        };

        return {
            success: true,
            output: JSON.stringify(verdict),
            status: "success",
            telemetry: { lead_id, qualification_score, status },
        };
    }
}
