/**
 * §9.4 schedule impact — what a recurrence change would actually do.
 *
 * A cron string tells a reviewer almost nothing. Moving a daily 3am job to a
 * two-hourly one looks like a small edit and is a twelve-fold increase in runs,
 * cost, and concurrency pressure. This computes the consequences so the approval
 * is made against them rather than against the string.
 *
 * Two things the spec is specific about, and both are load-bearing:
 *
 *  - **Cycle scheduling and pipeline scheduling are separate targets and must
 *    not be conflated.** The target type travels with the analysis so a forecast
 *    for one is never read as authorising the other.
 *  - **Daylight-saving transitions inside the review window must be surfaced.**
 *    A 2:30am daily job does not run on the spring-forward day and runs twice on
 *    the fall-back day. Nobody notices until the day it matters.
 */

import { CronExpressionParser } from "cron-parser";

import type { ChangeTargetType } from "@shared/schema/improvement/index.js";

/** Where a run duration distribution came from — see §8.3. */
export interface RuntimeDistribution {
    /** Median observed run duration in milliseconds. */
    p50Ms: number;
    /** 90th percentile, the one that decides overlap risk. */
    p90Ms: number;
    /** How many runs the distribution was computed over. */
    sampleCount: number;
}

export interface ScheduleDefinition {
    cron: string;
    timezone: string;
}

export interface ScheduleImpactInput {
    targetType: Extract<ChangeTargetType, "cycle_schedule" | "pipeline_step">;
    targetId: string;
    current: ScheduleDefinition;
    proposed: ScheduleDefinition;
    /** Observed durations. Absent means overlap cannot be assessed. */
    runtime?: RuntimeDistribution;
    /** Estimated cost of a single run, in USD. Absent means cost is unknown. */
    costPerRunUsd?: number;
    /** How far ahead to forecast. Default 30 days. */
    horizonDays?: number;
    now?: Date;
}

export type ScheduleRiskCode =
    | "OVERLAP_LIKELY"
    | "OVERLAP_UNKNOWN"
    | "RUN_COUNT_INCREASE"
    | "COST_INCREASE"
    | "COST_UNKNOWN"
    | "DST_TRANSITION"
    | "TIMEZONE_CHANGE"
    | "INVALID_CRON";

export interface ScheduleRisk {
    code: ScheduleRiskCode;
    severity: "info" | "warning" | "blocking";
    detail: string;
}

export interface DstTransition {
    at: string;
    kind: "spring_forward" | "fall_back";
    detail: string;
}

export interface ScheduleImpactReport {
    targetType: ScheduleImpactInput["targetType"];
    targetId: string;
    horizonDays: number;

    currentNextRuns: string[];
    proposedNextRuns: string[];

    currentRunCount: number;
    proposedRunCount: number;
    runCountDelta: number;

    /** Null when cost per run is unknown — never assumed to be zero. */
    currentCostUsd: number | null;
    proposedCostUsd: number | null;
    costDeltaUsd: number | null;

    /** Smallest gap between consecutive proposed runs, in ms. */
    minProposedIntervalMs: number | null;
    dstTransitions: DstTransition[];
    risks: ScheduleRisk[];
    /** True when nothing blocking was found. Warnings do not block. */
    ok: boolean;
}

const DAY_MS = 86_400_000;

function nextRuns(def: ScheduleDefinition, from: Date, until: Date, cap = 500): Date[] {
    const it = CronExpressionParser.parse(def.cron, { tz: def.timezone, currentDate: from });
    const out: Date[] = [];
    while (out.length < cap) {
        const next = it.next().toDate();
        if (next.getTime() > until.getTime()) break;
        out.push(next);
    }
    return out;
}

/**
 * A zone's UTC offset, in minutes, at a given instant.
 *
 * Uses built-in `Intl` rather than a date library: the runtime already carries
 * the tz database, and adding a dependency for one arithmetic helper is not
 * worth the supply-chain surface.
 */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(date);

    const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? "0");
    // `hour` comes back as 24 at midnight under hour12:false in some engines.
    const asIfUtc = Date.UTC(
        get("year"), get("month") - 1, get("day"),
        get("hour") % 24, get("minute"), get("second"),
    );
    return Math.round((asIfUtc - date.getTime()) / 60_000);
}

/**
 * DST transitions inside the window, for the configured zone.
 *
 * Walks days and compares UTC offsets — a change between consecutive days is a
 * transition. An unknown zone yields no transitions rather than throwing; the
 * cron parse reports an invalid zone separately, and this should not be the
 * thing that fails.
 */
export function findDstTransitions(timezone: string, from: Date, until: Date): DstTransition[] {
    const out: DstTransition[] = [];

    let previousOffset: number;
    try {
        previousOffset = zoneOffsetMinutes(from, timezone);
    } catch {
        return out;
    }

    for (let t = from.getTime() + DAY_MS; t <= until.getTime(); t += DAY_MS) {
        const at = new Date(t);
        const offset = zoneOffsetMinutes(at, timezone);
        if (offset !== previousOffset) {
            const springForward = offset > previousOffset;
            out.push({
                at: at.toISOString(),
                kind: springForward ? "spring_forward" : "fall_back",
                detail: springForward
                    ? "Clocks move forward: a run scheduled in the skipped hour does not happen that day."
                    : "Clocks move back: a run scheduled in the repeated hour may happen twice that day.",
            });
            previousOffset = offset;
        }
    }
    return out;
}

export function analyzeScheduleImpact(input: ScheduleImpactInput): ScheduleImpactReport {
    const now = input.now ?? new Date();
    const horizonDays = input.horizonDays ?? 30;
    const until = new Date(now.getTime() + horizonDays * DAY_MS);
    const risks: ScheduleRisk[] = [];

    let currentRuns: Date[] = [];
    let proposedRuns: Date[] = [];
    let invalid = false;

    for (const [label, def] of [["current", input.current], ["proposed", input.proposed]] as const) {
        try {
            const runs = nextRuns(def, now, until);
            if (label === "current") currentRuns = runs;
            else proposedRuns = runs;
        } catch (error) {
            invalid = true;
            risks.push({
                code: "INVALID_CRON",
                severity: "blocking",
                detail: `The ${label} expression '${def.cron}' (${def.timezone}) could not be parsed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            });
        }
    }

    const runCountDelta = proposedRuns.length - currentRuns.length;
    if (runCountDelta > 0) {
        const factor = currentRuns.length === 0 ? Infinity : proposedRuns.length / currentRuns.length;
        risks.push({
            code: "RUN_COUNT_INCREASE",
            severity: factor >= 4 ? "warning" : "info",
            detail: `${currentRuns.length} → ${proposedRuns.length} runs over ${horizonDays} days (${
                Number.isFinite(factor) ? `${factor.toFixed(1)}×` : "from none"
            }).`,
        });
    }

    // Cost is null when unknown. A missing cost is not a free change.
    const costPerRun = input.costPerRunUsd;
    const currentCostUsd = typeof costPerRun === "number" ? currentRuns.length * costPerRun : null;
    const proposedCostUsd = typeof costPerRun === "number" ? proposedRuns.length * costPerRun : null;
    const costDeltaUsd =
        currentCostUsd === null || proposedCostUsd === null
            ? null
            : Math.round((proposedCostUsd - currentCostUsd) * 100) / 100;

    if (costDeltaUsd === null) {
        risks.push({
            code: "COST_UNKNOWN",
            severity: "warning",
            detail: "No per-run cost is known, so the cost effect of this change cannot be shown. Absent is not zero.",
        });
    } else if (costDeltaUsd > 0) {
        risks.push({
            code: "COST_INCREASE",
            severity: "info",
            detail: `Estimated cost over ${horizonDays} days rises by $${costDeltaUsd.toFixed(2)}.`,
        });
    }

    // Overlap: does the next run start before the previous one is likely done?
    let minProposedIntervalMs: number | null = null;
    for (let i = 1; i < proposedRuns.length; i++) {
        const gap = proposedRuns[i].getTime() - proposedRuns[i - 1].getTime();
        minProposedIntervalMs = minProposedIntervalMs === null ? gap : Math.min(minProposedIntervalMs, gap);
    }

    if (!input.runtime) {
        risks.push({
            code: "OVERLAP_UNKNOWN",
            severity: "warning",
            detail:
                "No observed runtime distribution, so overlap and backlog risk cannot be assessed. This is unknown, not safe.",
        });
    } else if (minProposedIntervalMs !== null) {
        const { p90Ms, sampleCount } = input.runtime;
        if (p90Ms >= minProposedIntervalMs) {
            risks.push({
                code: "OVERLAP_LIKELY",
                severity: "blocking",
                detail: `Runs would start every ${Math.round(minProposedIntervalMs / 1000)}s, but 10% of observed runs take at least ${Math.round(p90Ms / 1000)}s (n=${sampleCount}). Expect overlap and a growing backlog.`,
            });
        } else if (p90Ms >= minProposedIntervalMs * 0.75) {
            risks.push({
                code: "OVERLAP_LIKELY",
                severity: "warning",
                detail: `The p90 run duration (${Math.round(p90Ms / 1000)}s) is within 25% of the proposed interval (${Math.round(minProposedIntervalMs / 1000)}s). Little headroom for a slow run.`,
            });
        }
    }

    if (input.current.timezone !== input.proposed.timezone) {
        risks.push({
            code: "TIMEZONE_CHANGE",
            severity: "warning",
            detail: `Timezone changes from ${input.current.timezone} to ${input.proposed.timezone}; local run times shift for everyone reading them.`,
        });
    }

    const dstTransitions = invalid ? [] : findDstTransitions(input.proposed.timezone, now, until);
    for (const t of dstTransitions) {
        risks.push({
            code: "DST_TRANSITION",
            severity: "warning",
            detail: `${t.kind === "spring_forward" ? "Spring forward" : "Fall back"} at ${t.at}. ${t.detail}`,
        });
    }

    return {
        targetType: input.targetType,
        targetId: input.targetId,
        horizonDays,
        currentNextRuns: currentRuns.slice(0, 5).map(d => d.toISOString()),
        proposedNextRuns: proposedRuns.slice(0, 5).map(d => d.toISOString()),
        currentRunCount: currentRuns.length,
        proposedRunCount: proposedRuns.length,
        runCountDelta,
        currentCostUsd,
        proposedCostUsd,
        costDeltaUsd,
        minProposedIntervalMs,
        dstTransitions,
        risks,
        ok: !risks.some(r => r.severity === "blocking"),
    };
}
