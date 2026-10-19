import { describe, it, expect } from "vitest";

import type { AggregatedGap } from "./capability-gap-normalizer.service.js";
import { prioritizeGap, prioritizeGaps } from "./capability-gap-prioritizer-v2.service.js";

function gap(over: Partial<AggregatedGap> = {}): AggregatedGap {
    return {
        key: "42:abc",
        organizationId: 42,
        signature: {
            intendedOutcome: "jira_create_issue",
            targetSystem: "jira",
            requiredVerb: "create",
            requiredObject: "issue",
            failureClass: "missing",
        },
        eventCount: 10,
        uniqueAffectedRuns: 10,
        uniqueAffectedUsers: 5,
        eventsWithoutRunIdentity: 0,
        eventsWithoutActor: 0,
        unparsedToolNames: [],
        firstSeenAt: new Date("2026-08-01"),
        lastSeenAt: new Date("2026-08-20"),
        exampleToolNames: ["jira_create_issue"],
        ...over,
    };
}

const available = { status: "available" as const, maxScore: 0.2 };
const fullyReviewed = { strategicScore: 10, strategicScoreBy: "ops-owner", riskReviewed: true };

function component(r: ReturnType<typeof prioritizeGap>, id: string) {
    return [...r.components, ...r.penalties].find(c => c.id === id)!;
}

describe("component arithmetic is checkable by hand", () => {
    it("computes frequency from distinct runs", () => {
        const r = prioritizeGap(gap({ uniqueAffectedRuns: 5 }), available);
        expect(component(r, "frequency_score").points).toBe(12.5);
        expect(component(r, "frequency_score").detail).toContain("5 affected runs / 10");
    });

    it("caps frequency at its maximum", () => {
        const r = prioritizeGap(gap({ uniqueAffectedRuns: 500 }), available);
        expect(component(r, "frequency_score").points).toBe(25);
    });

    it("computes user impact from distinct users", () => {
        const r = prioritizeGap(gap({ uniqueAffectedUsers: 2 }), available);
        expect(component(r, "user_impact_score").points).toBe(6);
    });

    it("rewards complete evidence in the confidence term", () => {
        const complete = prioritizeGap(gap(), available);
        const patchy = prioritizeGap(
            gap({ eventsWithoutRunIdentity: 5, eventsWithoutActor: 5, unparsedToolNames: ["x"] }),
            available,
        );
        expect(component(complete, "confidence_score").points)
            .toBeGreaterThan(component(patchy, "confidence_score").points);
    });

    it("reaches a final score when everything is known", () => {
        const r = prioritizeGap(gap(), available, fullyReviewed, { medianMinutes: 30 });
        expect(r.scoreState).toBe("final");
        expect(r.outstanding).toEqual([]);
        // 25 + 15 + 7.5 + 10 + 15 - 0 - 0
        expect(r.score).toBe(72.5);
    });
});

describe("a missing positive term deflates, so the score stays usable", () => {
    it("marks the score provisional and names what is outstanding", () => {
        const r = prioritizeGap(gap(), available, { riskReviewed: true });
        expect(r.scoreState).toBe("provisional");
        expect(r.outstanding).toEqual(expect.arrayContaining(["workaround_cost_score", "strategic_score"]));
        expect(r.score).not.toBeNull();
    });

    it("never exceeds what the same gap would score with the term supplied", () => {
        const withoutStrategic = prioritizeGap(gap(), available, { riskReviewed: true });
        const withStrategic = prioritizeGap(gap(), available, fullyReviewed);
        expect(withoutStrategic.score!).toBeLessThanOrEqual(withStrategic.score!);
    });

    // "No actor recorded" is unknown, not "nobody was affected".
    it("treats a total absence of actors as unavailable rather than zero users", () => {
        const r = prioritizeGap(
            gap({ uniqueAffectedUsers: 0, eventsWithoutActor: 10 }),
            available,
            fullyReviewed,
            { medianMinutes: 30 },
        );
        expect(component(r, "user_impact_score").state).toBe("unavailable");
        expect(r.scoreState).toBe("provisional");
    });

    it("still measures user impact when only some events lack an actor", () => {
        const r = prioritizeGap(gap({ uniqueAffectedUsers: 3, eventsWithoutActor: 4 }), available);
        expect(component(r, "user_impact_score").state).toBe("measured");
    });

    it("requires a NAMED scorer for the strategic term", () => {
        const unnamed = prioritizeGap(gap(), available, { strategicScore: 15 });
        expect(component(unnamed, "strategic_score").state).toBe("unavailable");
        expect(component(unnamed, "strategic_score").points).toBe(0);
    });
});

describe("a missing penalty inflates, so it is never scored as zero", () => {
    // This is F9. A duplicate must not earn a clean result because the
    // similarity search happened to be down.
    it("withholds the score when the duplicate check could not run", () => {
        const r = prioritizeGap(gap(), { status: "unavailable" }, fullyReviewed, { medianMinutes: 30 });
        expect(r.scoreState).toBe("withheld");
        expect(r.score).toBeNull();
        expect(r.reasons.join(" ")).toMatch(/exactly how a duplicate earns a clean result/);
    });

    it("applies the duplicate penalty above the threshold", () => {
        const r = prioritizeGap(gap(), { status: "available", maxScore: 0.9 }, fullyReviewed, { medianMinutes: 30 });
        expect(component(r, "duplicate_penalty").points).toBe(20);
    });

    it("does not apply it below the threshold", () => {
        const r = prioritizeGap(gap(), { status: "available", maxScore: 0.84 }, fullyReviewed);
        expect(component(r, "duplicate_penalty").points).toBe(0);
    });

    // Same rule as an unmeasured guardrail counting as breached: unknown risk
    // is treated as risk, which deflates and is therefore safe.
    it("applies the risk penalty when no review has happened", () => {
        const r = prioritizeGap(gap(), available, { strategicScore: 5, strategicScoreBy: "x" });
        expect(component(r, "risk_penalty").points).toBe(20);
        expect(r.outstanding).toContain("risk_review");
    });

    it("lifts the risk penalty once reviewed and clear", () => {
        const r = prioritizeGap(gap(), available, fullyReviewed);
        expect(component(r, "risk_penalty").points).toBe(0);
    });

    it("keeps it applied when review found an open question", () => {
        const r = prioritizeGap(gap(), available, { ...fullyReviewed, unresolvedRiskQuestion: true });
        expect(component(r, "risk_penalty").points).toBe(20);
    });
});

describe("bounds and ranking", () => {
    it("clamps to 0..100", () => {
        const r = prioritizeGap(gap({ uniqueAffectedRuns: 1, uniqueAffectedUsers: 0, eventsWithoutActor: 0 }), available);
        expect(r.score!).toBeGreaterThanOrEqual(0);
        expect(r.score!).toBeLessThanOrEqual(100);
    });

    it("sorts withheld candidates last — unranked, not low-ranked", () => {
        const ranked = prioritizeGaps([
            { gap: gap({ key: "withheld", uniqueAffectedRuns: 10 }), similarity: { status: "unavailable" }, human: fullyReviewed },
            { gap: gap({ key: "weak", uniqueAffectedRuns: 1 }), similarity: available, human: fullyReviewed },
        ]);
        expect(ranked.map(r => r.key)).toEqual(["weak", "withheld"]);
    });

    it("ranks by score among comparable candidates", () => {
        const ranked = prioritizeGaps([
            { gap: gap({ key: "low", uniqueAffectedRuns: 1 }), similarity: available, human: fullyReviewed },
            { gap: gap({ key: "high", uniqueAffectedRuns: 10 }), similarity: available, human: fullyReviewed },
        ]);
        expect(ranked[0].key).toBe("high");
    });

    it("reports every component, including the ones it could not compute", () => {
        const r = prioritizeGap(gap(), available);
        const ids = [...r.components, ...r.penalties].map(c => c.id);
        expect(ids).toEqual(expect.arrayContaining([
            "frequency_score", "user_impact_score", "workaround_cost_score",
            "strategic_score", "confidence_score", "duplicate_penalty", "risk_penalty",
        ]));
    });
});
