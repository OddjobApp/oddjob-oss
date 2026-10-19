import { describe, it, expect } from "vitest";

import { cycleScheduleToCron, bothTranslatable } from "./cycle-schedule-bridge.js";
import { analyzeScheduleImpact } from "./schedule-impact.service.js";

// 2026-06-01 14:37 UTC — a Monday.
const ANCHOR = "2026-06-01T14:37:00Z";

const cfg = (mode: any, timezone = "UTC", anchorAt: string | null = ANCHOR) =>
    ({ mode, timezone, anchorAt });

describe("cycleScheduleToCron", () => {
    it("takes the minute from the anchor for an hourly schedule", () => {
        expect(cycleScheduleToCron(cfg("hourly"))).toEqual({
            kind: "cron", cron: "37 * * * *", timezone: "UTC",
        });
    });

    it("takes minute and hour for a daily schedule", () => {
        expect(cycleScheduleToCron(cfg("daily"))).toMatchObject({ cron: "37 14 * * *" });
    });

    it("adds the weekday for a weekly schedule", () => {
        // 2026-06-01 is a Monday.
        expect(cycleScheduleToCron(cfg("weekly"))).toMatchObject({ cron: "37 14 * * 1" });
    });

    it("adds the day of month for a monthly schedule", () => {
        expect(cycleScheduleToCron(cfg("monthly"))).toMatchObject({ cron: "37 14 1 * *" });
    });

    it("adds the month for a yearly schedule", () => {
        expect(cycleScheduleToCron(cfg("yearly"))).toMatchObject({ cron: "37 14 1 6 *" });
    });

    // The anchor decides the time of day, so it must be read in the schedule's
    // own zone rather than the server's.
    it("reads the anchor in the configured timezone", () => {
        const utc = cycleScheduleToCron(cfg("daily", "UTC"));
        const tokyo = cycleScheduleToCron(cfg("daily", "Asia/Tokyo"));
        expect(utc).not.toEqual(tokyo);
        expect(tokyo).toMatchObject({ cron: "37 23 * * *" }); // UTC+9
    });

    it("falls back to a supplied anchor when the config has none", () => {
        const t = cycleScheduleToCron(cfg("daily", "UTC", null), new Date("2026-06-01T08:05:00Z"));
        expect(t).toMatchObject({ cron: "5 8 * * *" });
    });

    describe("modes with no cron form say so", () => {
        it("reports 'once' as not recurring", () => {
            const t = cycleScheduleToCron(cfg("once"));
            expect(t.kind).toBe("not_recurring");
            if (t.kind === "not_recurring") expect(t.reason).toMatch(/does not recur/);
        });

        // Presenting a duration-driven cadence as a fixed interval would be a
        // fabrication — the exact kind this loop exists to prevent.
        it("reports 'on_complete' as duration-driven, not as an interval", () => {
            const t = cycleScheduleToCron(cfg("on_complete"));
            expect(t.kind).toBe("duration_driven");
            if (t.kind === "duration_driven") expect(t.reason).toMatch(/fabrication/);
        });

        it("refuses to guess for an unrecognised mode", () => {
            const t = cycleScheduleToCron(cfg("teleportation" as any));
            expect(t.kind).toBe("duration_driven");
            if (t.kind === "duration_driven") expect(t.reason).toMatch(/refusing to guess/);
        });
    });

    it("bothTranslatable gates comparison", () => {
        const a = cycleScheduleToCron(cfg("daily"));
        const b = cycleScheduleToCron(cfg("hourly"));
        const once = cycleScheduleToCron(cfg("once"));
        expect(bothTranslatable(a, b)).toBe(true);
        expect(bothTranslatable(a, once)).toBe(false);
        expect(bothTranslatable(once, b)).toBe(false);
    });
});

describe("the bridge feeds the impact analyzer", () => {
    it("turns a daily → hourly change into a real forecast", () => {
        const current = cycleScheduleToCron(cfg("daily"));
        const proposed = cycleScheduleToCron(cfg("hourly"));
        expect(bothTranslatable(current, proposed)).toBe(true);
        if (current.kind !== "cron" || proposed.kind !== "cron") return;

        const report = analyzeScheduleImpact({
            targetType: "cycle_schedule",
            targetId: "cycle-1",
            current: { cron: current.cron, timezone: current.timezone },
            proposed: { cron: proposed.cron, timezone: proposed.timezone },
            runtime: { p50Ms: 60_000, p90Ms: 120_000, sampleCount: 30 },
            costPerRunUsd: 0.25,
            horizonDays: 7,
            now: new Date("2026-06-01T00:00:00Z"),
        });

        expect(report.currentRunCount).toBe(7);
        expect(report.proposedRunCount).toBe(7 * 24);
        expect(report.risks.map(r => r.code)).toContain("RUN_COUNT_INCREASE");
        expect(report.costDeltaUsd).toBeGreaterThan(0);
    });

    it("surfaces overlap when an hourly cycle runs longer than an hour", () => {
        const proposed = cycleScheduleToCron(cfg("hourly"));
        if (proposed.kind !== "cron") throw new Error("expected cron");

        const report = analyzeScheduleImpact({
            targetType: "cycle_schedule",
            targetId: "cycle-1",
            current: { cron: "37 14 * * *", timezone: "UTC" },
            proposed: { cron: proposed.cron, timezone: proposed.timezone },
            runtime: { p50Ms: 40 * 60_000, p90Ms: 75 * 60_000, sampleCount: 25 },
            horizonDays: 7,
            now: new Date("2026-06-01T00:00:00Z"),
        });

        const overlap = report.risks.find(r => r.code === "OVERLAP_LIKELY");
        expect(overlap?.severity).toBe("blocking");
        expect(report.ok).toBe(false);
    });
});
