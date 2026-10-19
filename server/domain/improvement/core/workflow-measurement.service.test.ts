import { describe, it, expect } from "vitest";

import type { WorkflowEvent, WorkflowEventType } from "@shared/schema/improvement/index.js";
import {
    measureWorkflow,
    describeDistribution,
    percentile,
    EMPTY_DISTRIBUTION,
} from "./workflow-measurement.service.js";

let seq = 0;
function ev(
    caseId: string,
    eventType: WorkflowEventType,
    stepKey: string,
    occurredAt: string,
    overrides: Partial<WorkflowEvent> = {},
): WorkflowEvent {
    seq += 1;
    return {
        id: seq,
        organizationId: 42,
        projectId: null,
        workflowKey: "onboarding",
        caseId,
        eventId: `e${seq}`,
        eventType,
        stepKey,
        actorType: "user",
        actorIdHash: "hash",
        occurredAt: new Date(occurredAt),
        sourceType: "oddjob",
        sourceReference: "mission:1",
        attributes: {},
        ingestedAt: new Date(occurredAt),
        ...overrides,
    } as WorkflowEvent;
}

/** One clean case: entered → started (after `waitMin`) → completed. */
function cleanCase(caseId: string, waitMin: number, totalMin = 60): WorkflowEvent[] {
    const t0 = new Date("2026-08-01T09:00:00Z").getTime();
    return [
        ev(caseId, "entered", "review", new Date(t0).toISOString()),
        ev(caseId, "started", "review", new Date(t0 + waitMin * 60000).toISOString()),
        ev(caseId, "completed", "review", new Date(t0 + totalMin * 60000).toISOString()),
    ];
}

describe("percentile", () => {
    it("uses nearest rank, returning a value that actually occurred", () => {
        const sorted = [10, 20, 30, 40];
        expect(percentile(sorted, 50)).toBe(20);
        expect(percentile(sorted, 75)).toBe(30);
        expect(percentile(sorted, 100)).toBe(40);
        expect(sorted).toContain(percentile(sorted, 90));
    });

    it("returns null for an empty set rather than zero", () => {
        expect(percentile([], 50)).toBeNull();
    });

    it("handles a single value", () => {
        expect(percentile([7], 50)).toBe(7);
        expect(percentile([7], 90)).toBe(7);
    });
});

describe("describeDistribution", () => {
    it("summarises a set of values", () => {
        const d = describeDistribution([5, 1, 3]);
        expect(d).toMatchObject({ count: 3, min: 1, max: 5, p50: 3 });
    });

    // An empty distribution reports nulls, never zeros — "no data" and "zero
    // milliseconds" are different findings.
    it("returns nulls, not zeros, for no data", () => {
        expect(describeDistribution([])).toEqual(EMPTY_DISTRIBUTION);
    });
});

describe("measureWorkflow", () => {
    it("counts cases, completions and cancellations", () => {
        const events = [
            ...cleanCase("c1", 10),
            ...cleanCase("c2", 20),
            ev("c3", "entered", "review", "2026-08-01T09:00:00Z"),
            ev("c3", "cancelled", "review", "2026-08-01T09:30:00Z"),
        ];
        const r = measureWorkflow("onboarding", events);
        expect(r.caseCount).toBe(3);
        expect(r.completedCount).toBe(2);
        expect(r.cancelledCount).toBe(1);
        expect(r.completionRate).toBeCloseTo(0.6667, 3);
        expect(r.cancellationRate).toBeCloseTo(0.3333, 3);
    });

    it("measures elapsed duration for completed cases only", () => {
        const events = [
            ...cleanCase("c1", 10, 60),
            ev("c2", "entered", "review", "2026-08-01T09:00:00Z"),
        ];
        const r = measureWorkflow("onboarding", events);
        expect(r.elapsedMs.count).toBe(1);
        expect(r.elapsedMs.p50).toBe(60 * 60000);
    });

    it("measures wait between entering a step and starting it", () => {
        const r = measureWorkflow("onboarding", [...cleanCase("c1", 10), ...cleanCase("c2", 30)]);
        const review = r.stepWaits.find(s => s.stepKey === "review")!;
        expect(review.waitMs.count).toBe(2);
        expect(review.waitMs.max).toBe(30 * 60000);
    });

    it("counts handoffs and reopens", () => {
        const events = [
            ...cleanCase("c1", 5),
            ev("c1", "handed_off", "review", "2026-08-01T09:10:00Z"),
            ev("c2", "entered", "review", "2026-08-01T09:00:00Z"),
            ev("c2", "reopened", "review", "2026-08-01T10:00:00Z"),
        ];
        const r = measureWorkflow("onboarding", events);
        expect(r.handoffCounts.max).toBe(1);
        expect(r.reopenedCaseCount).toBe(1);
        expect(r.reopenRate).toBe(0.5);
    });

    it("measures approval latency from the step being entered", () => {
        const events = [
            ev("c1", "entered", "signoff", "2026-08-01T09:00:00Z"),
            ev("c1", "approved", "signoff", "2026-08-01T09:45:00Z"),
        ];
        const r = measureWorkflow("onboarding", events);
        expect(r.approvalCount).toBe(1);
        expect(r.approvalLatencyMs.p50).toBe(45 * 60000);
    });

    it("groups completed cases into observed step-sequence variants", () => {
        const events = [...cleanCase("c1", 5), ...cleanCase("c2", 5)];
        const r = measureWorkflow("onboarding", events);
        expect(r.variants).toHaveLength(1);
        expect(r.variants[0].caseCount).toBe(2);
        expect(r.variants[0].sequence).toEqual(["review", "review", "review"]);
    });

    it("sorts events per case regardless of input order", () => {
        const c = cleanCase("c1", 10, 60);
        const r = measureWorkflow("onboarding", [c[2], c[0], c[1]]);
        expect(r.elapsedMs.p50).toBe(60 * 60000);
        expect(r.sequenceIssues).toHaveLength(0);
    });

    describe("data quality is reported, never imputed", () => {
        it("drops events missing a case id and counts them", () => {
            const bad = ev("", "entered", "review", "2026-08-01T09:00:00Z");
            const r = measureWorkflow("onboarding", [...cleanCase("c1", 5), bad]);
            expect(r.dataQuality.droppedMissingCaseId).toBe(1);
            expect(r.caseCount).toBe(1);
            expect(r.dataQuality.coverage).toBeLessThan(1);
        });

        it("drops events missing a timestamp and counts them", () => {
            const bad = ev("c9", "entered", "review", "2026-08-01T09:00:00Z");
            (bad as any).occurredAt = null;
            const r = measureWorkflow("onboarding", [...cleanCase("c1", 5), bad]);
            expect(r.dataQuality.droppedMissingTimestamp).toBe(1);
        });

        it("drops events missing a step key and counts them", () => {
            const bad = ev("c9", "entered", "", "2026-08-01T09:00:00Z");
            const r = measureWorkflow("onboarding", [bad]);
            expect(r.dataQuality.droppedMissingStepKey).toBe(1);
            expect(r.caseCount).toBe(0);
        });

        it("reports coverage as usable over total", () => {
            const r = measureWorkflow("onboarding", cleanCase("c1", 5));
            expect(r.dataQuality.coverage).toBe(1);
        });

        // §8.6: human attestations must stay distinguishable from system events.
        it("counts attestation events separately", () => {
            const attested = ev("c1", "started", "review", "2026-08-01T09:05:00Z", {
                sourceType: "attestation",
            });
            const r = measureWorkflow("onboarding", [
                ev("c1", "entered", "review", "2026-08-01T09:00:00Z"),
                attested,
            ]);
            expect(r.dataQuality.attestationEvents).toBe(1);
        });
    });

    describe("invalid sequences are flagged, not repaired", () => {
        it("flags a step started with no entered event", () => {
            const r = measureWorkflow("onboarding", [
                ev("c1", "started", "review", "2026-08-01T09:05:00Z"),
            ]);
            expect(r.sequenceIssues[0].reason).toMatch(/without a recorded 'entered'/);
            expect(r.dataQuality.invalidSequenceCases).toBe(1);
        });

        it("flags activity after a terminal event", () => {
            const r = measureWorkflow("onboarding", [
                ...cleanCase("c1", 5, 30),
                ev("c1", "started", "review", "2026-08-01T11:00:00Z"),
            ]);
            expect(r.sequenceIssues.some(i => /after terminal/.test(i.reason))).toBe(true);
        });

        it("does not flag a legitimate reopen after completion", () => {
            const r = measureWorkflow("onboarding", [
                ...cleanCase("c1", 5, 30),
                ev("c1", "reopened", "review", "2026-08-01T11:00:00Z"),
            ]);
            expect(r.sequenceIssues.filter(i => /after terminal/.test(i.reason))).toHaveLength(0);
        });

        it("excludes a step with no wait measurement from step waits", () => {
            const r = measureWorkflow("onboarding", [
                ev("c1", "started", "review", "2026-08-01T09:05:00Z"),
            ]);
            expect(r.stepWaits).toHaveLength(0);
        });
    });

    describe("bottleneck claims carry their definition", () => {
        function manyCases(step: string, count: number, waitMin: number): WorkflowEvent[] {
            const out: WorkflowEvent[] = [];
            for (let i = 0; i < count; i++) {
                const t0 = new Date("2026-08-01T09:00:00Z").getTime() + i * 3600000;
                out.push(
                    ev(`${step}-${i}`, "entered", step, new Date(t0).toISOString()),
                    ev(`${step}-${i}`, "started", step, new Date(t0 + waitMin * 60000).toISOString()),
                    ev(`${step}-${i}`, "completed", step, new Date(t0 + (waitMin + 10) * 60000).toISOString()),
                );
            }
            return out;
        }

        // A number is a number; a label is a claim, and the claim ships with
        // the rule that produced it.
        it("names no bottleneck below the case threshold", () => {
            const r = measureWorkflow("onboarding", [
                ...manyCases("slow", 5, 120),
                ...manyCases("fast", 5, 1),
            ]);
            expect(r.bottlenecks).toHaveLength(0);
            expect(r.stepWaits.length).toBeGreaterThan(0);
        });

        it("names a bottleneck once both conditions hold, with its definition", () => {
            const r = measureWorkflow("onboarding", [
                ...manyCases("slow", 25, 120),
                ...manyCases("fast", 25, 1),
            ]);
            expect(r.bottlenecks).toHaveLength(1);
            expect(r.bottlenecks[0].stepKey).toBe("slow");
            expect(r.bottlenecks[0].definition).toMatch(/at least 20 completed cases/);
            expect(r.bottlenecks[0].definition).toMatch(/Top-quartile/);
        });

        it("honours a custom case threshold", () => {
            const r = measureWorkflow(
                "onboarding",
                [...manyCases("slow", 5, 120), ...manyCases("fast", 5, 1)],
                { minCasesForBottleneck: 3 },
            );
            expect(r.bottlenecks.length).toBeGreaterThan(0);
            expect(r.bottlenecks[0].definition).toMatch(/at least 3 completed cases/);
        });
    });

    it("reports an empty window and zero rates for no events", () => {
        const r = measureWorkflow("onboarding", []);
        expect(r.caseCount).toBe(0);
        expect(r.windowStart).toBeNull();
        expect(r.elapsedMs).toEqual(EMPTY_DISTRIBUTION);
        expect(r.dataQuality.coverage).toBe(0);
    });
});
