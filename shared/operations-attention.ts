export type AttentionSeverity = "critical" | "high" | "medium" | "low";
export type AttentionKind = "approval" | "mission" | "cycle" | "connection";

/** Recovery strategies accepted by POST /api/mission-runs/:id/recovery (applyRecoveryStrategy). */
export type RecoveryStrategy = "retry" | "reset" | "replan" | "safe_state";

export interface AttentionQueueItem {
    id: string;
    kind: AttentionKind;
    severity: AttentionSeverity;
    title: string;
    summary: string;
    status: string;
    occurredAt: string;
    ageMinutes: number;
    href: string;
    actionLabel: string;
    organizationId: number;
    /** Human-readable next step to fix the problem (failed runs only). */
    recommendation?: string;
    /** The recovery action this item can trigger (failed mission runs only). */
    recovery?: { strategy: RecoveryStrategy; missionRunId: number };
    metadata?: Record<string, string | number | boolean | null>;
}

export interface FailureDiagnosis {
    /** What actually went wrong, in plain language. */
    problem: string;
    /** The most useful next step to fix it. */
    recommendation: string;
    /** Which recovery strategy the fix button should apply. */
    suggestedStrategy: RecoveryStrategy;
}

const GENERIC_PROBLEM = "The run failed and requires diagnosis or recovery.";

/**
 * Derive a human-readable diagnosis for a failed mission run from whatever signal is available.
 * Pure + shared so the attention queue (backend) and the run-detail page (frontend) show the same
 * thing. Existing failed runs have `failureReason: null` but usually carry `root_cause_analysis` /
 * `last_criticism` on their missionContext, so the diagnosis surfaces without any data backfill.
 */
export function deriveFailureDiagnosis(
    missionContext: Record<string, any> | null | undefined,
    failureReason?: string | null,
): FailureDiagnosis {
    const ctx = missionContext ?? {};
    const rca = typeof ctx.root_cause_analysis === "string" ? ctx.root_cause_analysis : "";
    const critique = typeof ctx.last_criticism === "string" ? ctx.last_criticism : "";
    const problem = (failureReason?.trim() || rca.trim() || critique.trim() || GENERIC_PROBLEM);

    // Pattern-match across every available text signal to pick the most useful recommendation.
    const haystack = [failureReason, rca, critique].filter(Boolean).join("\n").toLowerCase();

    if (/package\.json|enoent|npm (install|ci)/.test(haystack)) {
        return {
            problem,
            recommendation:
                "The workspace has no package.json — no source-control repo is configured for this org, " +
                "so `npm install` fails. Configure a repo for the org, or Reset the run. Retrying as-is will fail again.",
            suggestedStrategy: "reset",
        };
    }
    if (/exceeded \d+ waves|wave limit|max.?waves/.test(haystack)) {
        return {
            problem,
            recommendation: "The run hit its wave limit without converging. Reset to start clean, or replan with a narrower scope.",
            suggestedStrategy: "reset",
        };
    }
    if (/constitutional veto|--force|human approval/.test(haystack)) {
        return {
            problem,
            recommendation: critique.trim()
                ? `A policy check blocked the run: ${critique.trim()}`
                : "A policy check blocked the run. Replan to satisfy the constraint, then retry.",
            suggestedStrategy: "replan",
        };
    }
    return {
        problem,
        recommendation: "Review the run timeline. Retry if this looks transient, otherwise Reset to start clean.",
        suggestedStrategy: "retry",
    };
}

export interface AttentionQueueSummary {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    byKind: Record<AttentionKind, number>;
}

export interface AttentionQueueResponse {
    generatedAt: string;
    items: AttentionQueueItem[];
    summary: AttentionQueueSummary;
}

