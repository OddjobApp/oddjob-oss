import { describe, it, expect } from "vitest";

import {
    analyzeScheduleImpact,
    findDstTransitions,
    type ScheduleImpactInput,
} from "./schedule-impact.service.js";

const NOW = new Date("2026-06-01T00:00:00Z");

function input(over: Partial<ScheduleImpactInput> = {}): ScheduleImpactInput {
    return {
        targetType: "cycle_schedule",
        targetId: "cycle-7",
        current: { cron: "0 3 * * *", timezone: "UTC" },
        proposed: { cron: "0 3 * * *", timezone: "UTC" },
        runtime: { p50Ms: 60_000, p90Ms: 120_000, sampleCount: 40 },
        costPerRunUsd: 0.5,
        horizonDays: 30,
        now: NOW,
        ...over,
    };
}

const codes = (r: ReturnType<typeof analyzeScheduleImpact>) => r.risks.map(x => x.code);

describe("run counts and next runs", () => {
    it("computes runs over the horizon for an unchanged schedule", () => {
        const r = analyzeScheduleImpact(input());
        expect(r.currentRunCount).toBe(30);
        expect(r.proposedRunCount).toBe(30);
        expect(r.runCountDelta).toBe(0);
        expect(r.currentNextRuns).toHaveLength(5);
    });

    // The edit that looks small and is not.
    it("surfaces a twelve-fold increase from a two-hour recurrence", () => {
        const r = analyzeScheduleImpact(input({ proposed: { cron: "0 */2 * * *", timezone: "UTC" } }));
        expect(r.proposedRunCount).toBe(360);
        expect(r.runCountDelta).toBe(330);
        const risk = r.risks.find(x => x.code === "RUN_COUNT_INCREASE")!;
        expect(risk.detail).toMatch(/12\.0×/);
    });

    it("does not flag a reduction as an increase", () => {
        const r = analyzeScheduleImpact(input({ proposed: { cron: "0 3 * * 1", timezone: "UTC" } }));
        expect(r.runCountDelta).toBeLessThan(0);
        expect(codes(r)).not.toContain("RUN_COUNT_INCREASE");
    });
});

describe("cost", () => {
    it("computes the delta when a per-run cost is known", () => {
        const r = analyzeScheduleImpact(input({ proposed: { cron: "0 */2 * * *", timezone: "UTC" } }));
        expect(r.costDeltaUsd).toBe(165); // 330 extra runs at $0.50
        expect(codes(r)).toContain("COST_INCREASE");
    });

    // Absent is not zero.
    it("reports cost as unknown rather than free when no per-run cost exists", () => {
        const r = analyzeScheduleImpact(input({ costPerRunUsd: undefined }));
        expect(r.costDeltaUsd).toBeNull();
        expect(r.currentCostUsd).toBeNull();
        const risk = r.risks.find(x => x.code === "COST_UNKNOWN")!;
        expect(risk.detail).toMatch(/Absent is not zero/);
    });
});

describe("overlap and backlog", () => {
    it("blocks when the p90 duration exceeds the proposed interval", () => {
        const r = analyzeScheduleImpact(input({
            proposed: { cron: "* * * * *", timezone: "UTC" },      // every minute
            runtime: { p50Ms: 90_000, p90Ms: 150_000, sampleCount: 50 },
        }));
        expect(codes(r)).toContain("OVERLAP_LIKELY");
        expect(r.risks.find(x => x.code === "OVERLAP_LIKELY")!.severity).toBe("blocking");
        expect(r.ok).toBe(false);
    });

    it("warns when headroom is thin but runs still fit", () => {
        const r = analyzeScheduleImpact(input({
            proposed: { cron: "* * * * *", timezone: "UTC" },      // 60s apart
            runtime: { p50Ms: 30_000, p90Ms: 50_000, sampleCount: 50 },
        }));
        const risk = r.risks.find(x => x.code === "OVERLAP_LIKELY")!;
        expect(risk.severity).toBe("warning");
        expect(r.ok).toBe(true);
    });

    it("is quiet when there is ample headroom", () => {
        const r = analyzeScheduleImpact(input());
        expect(codes(r)).not.toContain("OVERLAP_LIKELY");
    });

    // Unmeasured is not safe.
    it("warns that overlap is UNKNOWN when no runtime distribution exists", () => {
        const r = analyzeScheduleImpact(input({ runtime: undefined }));
        const risk = r.risks.find(x => x.code === "OVERLAP_UNKNOWN")!;
        expect(risk.detail).toMatch(/unknown, not safe/);
    });

    it("reports the smallest proposed interval", () => {
        const r = analyzeScheduleImpact(input({ proposed: { cron: "0 */2 * * *", timezone: "UTC" } }));
        expect(r.minProposedIntervalMs).toBe(2 * 3600_000);
    });
});

describe("daylight saving", () => {
    // A 2:30am daily job does not run on spring-forward day and may run twice
    // on fall-back day. Nobody notices until the day it matters.
    it("finds a spring-forward transition in the window", () => {
        const transitions = findDstTransitions(
            "America/Los_Angeles",
            new Date("2026-03-01T00:00:00Z"),
            new Date("2026-03-20T00:00:00Z"),
        );
        expect(transitions).toHaveLength(1);
        expect(transitions[0].kind).toBe("spring_forward");
        expect(transitions[0].detail).toMatch(/does not happen/);
    });

    it("finds a fall-back transition", () => {
        const transitions = findDstTransitions(
            "America/Los_Angeles",
            new Date("2026-10-25T00:00:00Z"),
            new Date("2026-11-10T00:00:00Z"),
        );
        expect(transitions).toHaveLength(1);
        expect(transitions[0].kind).toBe("fall_back");
        expect(transitions[0].detail).toMatch(/twice/);
    });

    it("finds none in a zone without DST", () => {
        expect(findDstTransitions("UTC", new Date("2026-03-01T00:00:00Z"), new Date("2026-04-01T00:00:00Z")))
            .toEqual([]);
    });

    it("raises a risk when a transition falls in the review window", () => {
        const r = analyzeScheduleImpact(input({
            now: new Date("2026-03-01T00:00:00Z"),
            current: { cron: "30 2 * * *", timezone: "America/Los_Angeles" },
            proposed: { cron: "30 2 * * *", timezone: "America/Los_Angeles" },
        }));
        expect(codes(r)).toContain("DST_TRANSITION");
    });
});

describe("timezone and validity", () => {
    it("warns when the timezone itself changes", () => {
        const r = analyzeScheduleImpact(input({
            proposed: { cron: "0 3 * * *", timezone: "Asia/Tokyo" },
        }));
        expect(codes(r)).toContain("TIMEZONE_CHANGE");
    });

    it("blocks on an unparseable expression rather than assuming a default", () => {
        const r = analyzeScheduleImpact(input({ proposed: { cron: "not a cron", timezone: "UTC" } }));
        expect(codes(r)).toContain("INVALID_CRON");
        expect(r.ok).toBe(false);
    });

    // Cycle and pipeline scheduling are separate targets; a forecast for one
    // must never read as authorising the other.
    it("carries the target type through the report", () => {
        const r = analyzeScheduleImpact(input({ targetType: "pipeline_step", targetId: "step-3" }));
        expect(r.targetType).toBe("pipeline_step");
        expect(r.targetId).toBe("step-3");
    });
});
