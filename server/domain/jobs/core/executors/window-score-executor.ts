/**
 * window_score executor (Sales Opportunity Pipeline).
 *
 * Step RISK-1 of mission-deal-risk-scan: score every live window for slip-risk
 * and write advisory sales_recommendations to the Deal Risk Center. Deterministic
 * (no LLM) and advisory only — never moves a deal's stage or ceiling.
 *
 *   • slip_risk — within grace/lookahead of the next gate deadline with no
 *                 qualifying re-arm signal (about to step down).
 *   • aging     — already decayed two or more rungs and still open.
 *   • stalled   — a full interval past open with zero engagement.
 *
 * One recommendation per at-risk window (slip_risk > aging > stalled), deduped
 * against existing OPEN recommendations for the same opportunity + kind.
 */

import { Job, Pipeline } from "@shared/schema/index.js";
import { JobExecutor } from "./executor-types.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { salesStoreForOrg } from "../../../sales/core/sales-records-store.js";
import { SalesCollections, DEFAULT_REARM_SIGNALS } from "../../../sales/core/collections.js";
import {
    parseLadder,
    intervalSliceMs,
    type OpportunityWindow,
    type Activity,
} from "../../../sales/core/opportunity-window.service.js";
import { createSalesRecommendation, type SalesRecommendation, type SalesRecommendationKind } from "../../../sales/core/recommendations.js";

const HOUR_MS = 3_600_000;

function rearmSignalSet(w: OpportunityWindow): Set<string> {
    try {
        const arr = JSON.parse(w.rearm_signals);
        if (Array.isArray(arr) && arr.length) return new Set(arr.map(String));
    } catch { /* fall through */ }
    return new Set(DEFAULT_REARM_SIGNALS);
}

export class WindowScoreExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "window_score";
    }

    async execute(
        job: Job,
        _resolvedConfig: any,
        _pipeline: Pipeline,
        _context: VariableContext,
    ): Promise<StepExecutionResult> {
        const orgId = job.organizationId;
        if (!orgId) {
            return { success: false, output: "", status: "failure", error: "window_score requires an organizationId" };
        }

        const store = await salesStoreForOrg(orgId);
        const now = new Date();
        const windows = (await store.list<OpportunityWindow>(SalesCollections.opportunityWindows)).map((r) => r.data);
        const activities = (await store.list<Activity>(SalesCollections.activities)).map((r) => r.data);
        const existing = (await store.list<SalesRecommendation>(SalesCollections.recommendations)).map((r) => r.data);
        const openKeys = new Set(existing.filter((r) => r.status === "OPEN").map((r) => `${r.opportunity_id}:${r.kind}`));

        const created: string[] = [];
        let scanned = 0;

        for (const w of windows) {
            if (w.status !== "ARMED" && w.status !== "DECAYING") continue;
            scanned++;

            const signals = rearmSignalSet(w);
            const since = new Date(w.last_rearm_at ?? w.opened_at).getTime();
            const hasRecentSignal = activities.some(
                (a) =>
                    a.opportunity_id === w.opportunity_id &&
                    new Date(a.occurred_at).getTime() > since &&
                    (a.is_rearm_signal === true || signals.has(a.type)),
            );
            const hasAnyActivity = activities.some((a) => a.opportunity_id === w.opportunity_id);

            const slice = intervalSliceMs(w);
            const graceMs = (w.grace_period_hours || 0) * HOUR_MS;
            const lookahead = Math.max(graceMs, slice * 0.25);
            const msToDeadline = new Date(w.next_gate_deadline).getTime() - now.getTime();
            const ladder = parseLadder(w);

            let kind: SalesRecommendationKind | null = null;
            let title = "";
            let body = "";

            if (!hasRecentSignal && msToDeadline <= lookahead) {
                kind = "slip_risk";
                const nextCeiling = ladder[Math.min(w.current_gate_index + 1, ladder.length - 1)];
                title = `Slip risk: ceiling about to drop ${w.current_ceiling}% → ${nextCeiling}%`;
                body = `No qualifying engagement since ${new Date(since).toISOString()}. The window steps down at ${w.next_gate_deadline} unless re-armed.`;
            } else if (w.current_gate_index >= 2) {
                kind = "aging";
                title = `Aging deal: ceiling already at ${w.current_ceiling}%`;
                body = `This window has decayed ${w.current_gate_index} rung(s) from the top. Consider a Deal Window Decision before it reaches 0%.`;
            } else if (!hasAnyActivity && now.getTime() - new Date(w.opened_at).getTime() > slice) {
                kind = "stalled";
                title = "Stalled deal: no engagement logged";
                body = `No activity recorded a full interval after opening (${w.opened_at}).`;
            }

            if (!kind) continue;
            const dedupeKey = `${w.opportunity_id}:${kind}`;
            if (openKeys.has(dedupeKey)) continue;

            const rec = await createSalesRecommendation(store, {
                opportunity_id: w.opportunity_id,
                kind,
                title,
                body,
                payload: { window_id: w.window_id, current_ceiling: w.current_ceiling, next_gate_deadline: w.next_gate_deadline },
                now,
            });
            openKeys.add(dedupeKey);
            created.push(rec.rec_id);
        }

        return {
            success: true,
            output: JSON.stringify({ scanned, created }),
            status: "success",
            telemetry: { windows_scanned: scanned, recommendations_created: created.length },
        };
    }
}
