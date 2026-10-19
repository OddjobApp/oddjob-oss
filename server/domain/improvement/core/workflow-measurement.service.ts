/**
 * Deterministic workflow measurements (§8.3).
 *
 * Pure computation over normalized events. No model is involved, and none may
 * be: release gate 2 requires every metric to be reproducible without an LLM,
 * which means the percentile method, the rounding, and the definition of every
 * rate have to be stated and stable.
 *
 * Three rules run through the whole file:
 *
 * - **Nothing is imputed.** A case missing a timestamp or a case id lowers
 *   data-quality coverage; it never gets a guessed value.
 * - **Attestations stay separate.** Human-entered events are counted apart from
 *   observed ones, because blending them makes a report irreproducible.
 * - **A "bottleneck" carries its definition.** A high wait time is a number.
 *   Calling it a bottleneck is a claim, and the claim ships with the operational
 *   rule that produced it.
 */

import type { WorkflowEvent, WorkflowEventType } from "@shared/schema/improvement/index.js";

/* ────────────────────────────  distributions  ─────────────────────────────── */

export interface Distribution {
    count: number;
    min: number | null;
    p50: number | null;
    p75: number | null;
    p90: number | null;
    max: number | null;
}

export const EMPTY_DISTRIBUTION: Distribution = {
    count: 0, min: null, p50: null, p75: null, p90: null, max: null,
};

/**
 * Nearest-rank percentile on a sorted ascending array.
 *
 * Stated explicitly because percentile methods disagree: nearest-rank returns a
 * value that actually occurred in the data, which keeps every figure in a report
 * traceable to a real case rather than to an interpolation.
 */
export function percentile(sortedAsc: number[], p: number): number | null {
    if (sortedAsc.length === 0) return null;
    const rank = Math.ceil((p / 100) * sortedAsc.length);
    return sortedAsc[Math.min(Math.max(rank, 1), sortedAsc.length) - 1];
}

export function describeDistribution(values: number[]): Distribution {
    if (values.length === 0) return { ...EMPTY_DISTRIBUTION };
    const sorted = [...values].sort((a, b) => a - b);
    return {
        count: sorted.length,
        min: sorted[0],
        p50: percentile(sorted, 50),
        p75: percentile(sorted, 75),
        p90: percentile(sorted, 90),
        max: sorted[sorted.length - 1],
    };
}

/* ──────────────────────────────  data quality  ────────────────────────────── */

export interface DataQuality {
    totalEvents: number;
    usableEvents: number;
    /** Events dropped, by reason. Reported, never silently absorbed. */
    droppedMissingCaseId: number;
    droppedMissingTimestamp: number;
    droppedMissingStepKey: number;
    /** Cases whose event order could not be reconciled. */
    invalidSequenceCases: number;
    /** Events supplied by a person rather than observed. */
    attestationEvents: number;
    /** usableEvents / totalEvents, 0-1, rounded to 4dp. */
    coverage: number;
}

export interface CaseSequenceIssue {
    caseId: string;
    reason: string;
}

/* ──────────────────────────────  the report  ──────────────────────────────── */

export interface StepWait {
    stepKey: string;
    /** Wait between entering the step and work starting on it. */
    waitMs: Distribution;
    /** Completed cases that reached this step. */
    caseCount: number;
}

export interface WorkflowVariant {
    /** The observed step sequence, in order. */
    sequence: string[];
    caseCount: number;
}

export interface BottleneckClaim {
    stepKey: string;
    waitP75Ms: number;
    caseCount: number;
    /** The operational rule that produced this claim, carried with it. */
    definition: string;
}

export interface WorkflowMeasurementReport {
    workflowKey: string;
    windowStart: Date | null;
    windowEnd: Date | null;

    caseCount: number;
    completedCount: number;
    cancelledCount: number;
    /** Completed / total cases, 0-1, 4dp. */
    completionRate: number;
    cancellationRate: number;

    /** First to last event, for completed cases only. */
    elapsedMs: Distribution;
    stepWaits: StepWait[];
    handoffCounts: Distribution;

    reopenedCaseCount: number;
    reopenRate: number;

    approvalCount: number;
    /** Time from a step being entered to its approval. */
    approvalLatencyMs: Distribution;

    variants: WorkflowVariant[];
    dataQuality: DataQuality;
    sequenceIssues: CaseSequenceIssue[];
    bottlenecks: BottleneckClaim[];
}

export interface MeasurementOptions {
    /**
     * A step is only called a bottleneck with at least this many completed
     * cases behind it. Default 20, matching the spec's worked example.
     */
    minCasesForBottleneck?: number;
}

function rate(numerator: number, denominator: number): number {
    if (denominator === 0) return 0;
    return Math.round((numerator / denominator) * 10000) / 10000;
}

const TERMINAL_TYPES: ReadonlySet<WorkflowEventType> = new Set(["completed", "cancelled", "rejected"]);

/**
 * Compute the report for one workflow over the supplied events.
 *
 * Events may arrive in any order; they are sorted per case. Anything unusable
 * is dropped with a counted reason rather than repaired.
 */
export function measureWorkflow(
    workflowKey: string,
    events: WorkflowEvent[],
    options: MeasurementOptions = {},
): WorkflowMeasurementReport {
    const minCases = options.minCasesForBottleneck ?? 20;

    let droppedMissingCaseId = 0;
    let droppedMissingTimestamp = 0;
    let droppedMissingStepKey = 0;
    let attestationEvents = 0;

    const usable: WorkflowEvent[] = [];
    for (const event of events) {
        if (event.sourceType === "attestation") attestationEvents += 1;
        if (!event.caseId?.trim()) { droppedMissingCaseId += 1; continue; }
        if (!event.occurredAt || Number.isNaN(new Date(event.occurredAt).getTime())) {
            droppedMissingTimestamp += 1; continue;
        }
        if (!event.stepKey?.trim()) { droppedMissingStepKey += 1; continue; }
        usable.push(event);
    }

    // Group by case, each sorted by time.
    const byCase = new Map<string, WorkflowEvent[]>();
    for (const event of usable) {
        byCase.set(event.caseId, [...(byCase.get(event.caseId) ?? []), event]);
    }
    for (const [caseId, caseEvents] of byCase) {
        byCase.set(
            caseId,
            [...caseEvents].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()),
        );
    }

    const sequenceIssues: CaseSequenceIssue[] = [];
    const elapsedValues: number[] = [];
    const handoffValues: number[] = [];
    const approvalLatencies: number[] = [];
    const waitsByStep = new Map<string, number[]>();
    const variantCounts = new Map<string, { sequence: string[]; caseCount: number }>();

    let completedCount = 0;
    let cancelledCount = 0;
    let reopenedCaseCount = 0;
    let approvalCount = 0;
    let windowStart: number | null = null;
    let windowEnd: number | null = null;

    for (const [caseId, caseEvents] of byCase) {
        const first = new Date(caseEvents[0].occurredAt).getTime();
        const last = new Date(caseEvents[caseEvents.length - 1].occurredAt).getTime();
        windowStart = windowStart === null ? first : Math.min(windowStart, first);
        windowEnd = windowEnd === null ? last : Math.max(windowEnd, last);

        const types = caseEvents.map(e => e.eventType);
        const isCompleted = types.includes("completed");
        const isCancelled = types.includes("cancelled");
        if (isCompleted) completedCount += 1;
        if (isCancelled) cancelledCount += 1;
        if (types.includes("reopened")) reopenedCaseCount += 1;

        // A case that continues after a terminal event is not measurable as a
        // clean run — flagged, not silently repaired.
        const terminalIndex = caseEvents.findIndex(e => TERMINAL_TYPES.has(e.eventType));
        if (terminalIndex >= 0 && terminalIndex < caseEvents.length - 1) {
            const after = caseEvents[terminalIndex + 1];
            if (after.eventType !== "reopened") {
                sequenceIssues.push({
                    caseId,
                    reason: `Event '${after.eventType}' occurs after terminal '${caseEvents[terminalIndex].eventType}'.`,
                });
            }
        }

        // 'started' before 'entered' at the same step is an ordering fault.
        const enteredAt = new Map<string, number>();
        for (const event of caseEvents) {
            const at = new Date(event.occurredAt).getTime();
            if (event.eventType === "entered") {
                if (!enteredAt.has(event.stepKey)) enteredAt.set(event.stepKey, at);
            } else if (event.eventType === "started") {
                const entered = enteredAt.get(event.stepKey);
                if (entered === undefined) {
                    sequenceIssues.push({
                        caseId,
                        reason: `Step '${event.stepKey}' started without a recorded 'entered' event.`,
                    });
                } else {
                    waitsByStep.set(event.stepKey, [...(waitsByStep.get(event.stepKey) ?? []), at - entered]);
                }
            } else if (event.eventType === "approved") {
                approvalCount += 1;
                const entered = enteredAt.get(event.stepKey);
                if (entered !== undefined) approvalLatencies.push(at - entered);
            }
        }

        if (isCompleted) {
            elapsedValues.push(last - first);
            handoffValues.push(caseEvents.filter(e => e.eventType === "handed_off").length);

            const sequence = caseEvents.map(e => e.stepKey);
            const key = sequence.join(">");
            const existing = variantCounts.get(key);
            variantCounts.set(key, { sequence, caseCount: (existing?.caseCount ?? 0) + 1 });
        }
    }

    const caseCount = byCase.size;

    const stepWaits: StepWait[] = [...waitsByStep.entries()]
        .map(([stepKey, waits]) => ({
            stepKey,
            waitMs: describeDistribution(waits),
            caseCount: waits.length,
        }))
        .sort((a, b) => (b.waitMs.p75 ?? 0) - (a.waitMs.p75 ?? 0));

    // A bottleneck claim requires BOTH a top-quartile wait and enough cases to
    // stand behind it. Below the threshold the number is still reported as a
    // wait; it just is not given a label it has not earned.
    const allP75 = stepWaits.map(s => s.waitMs.p75).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const topQuartileThreshold = percentile(allP75, 75);
    const definition = `Top-quartile p75 wait across measured steps (>= ${topQuartileThreshold ?? 0} ms) and present in at least ${minCases} completed cases.`;

    const bottlenecks: BottleneckClaim[] =
        topQuartileThreshold === null
            ? []
            : stepWaits
                  .filter(s => s.waitMs.p75 !== null && s.waitMs.p75 >= topQuartileThreshold && s.caseCount >= minCases)
                  .map(s => ({
                      stepKey: s.stepKey,
                      waitP75Ms: s.waitMs.p75 as number,
                      caseCount: s.caseCount,
                      definition,
                  }));

    const totalEvents = events.length;
    const dataQuality: DataQuality = {
        totalEvents,
        usableEvents: usable.length,
        droppedMissingCaseId,
        droppedMissingTimestamp,
        droppedMissingStepKey,
        invalidSequenceCases: new Set(sequenceIssues.map(i => i.caseId)).size,
        attestationEvents,
        coverage: rate(usable.length, totalEvents),
    };

    return {
        workflowKey,
        windowStart: windowStart === null ? null : new Date(windowStart),
        windowEnd: windowEnd === null ? null : new Date(windowEnd),
        caseCount,
        completedCount,
        cancelledCount,
        completionRate: rate(completedCount, caseCount),
        cancellationRate: rate(cancelledCount, caseCount),
        elapsedMs: describeDistribution(elapsedValues),
        stepWaits,
        handoffCounts: describeDistribution(handoffValues),
        reopenedCaseCount,
        reopenRate: rate(reopenedCaseCount, caseCount),
        approvalCount,
        approvalLatencyMs: describeDistribution(approvalLatencies),
        variants: [...variantCounts.values()].sort((a, b) => b.caseCount - a.caseCount),
        dataQuality,
        sequenceIssues,
        bottlenecks,
    };
}
