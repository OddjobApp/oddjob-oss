/**
 * When a recurring cycle runs next.
 *
 * This file used to reach for `CycleSchedulerService.calculateNextRun`, a static
 * that no longer exists — the logic moved to shared/cycle-scheduling.ts as
 * normalizeCycleSchedule + computeNextCycleRun, and the vocabulary moved with
 * it. So the suite failed to collect at all ("Cannot read properties of
 * undefined (reading 'bind')") and had been asserting a rule that was
 * deliberately removed: "continuous" used to return a locked date a year out,
 * and now maps to on_complete, which has no scheduled next run by design.
 *
 * Rewritten against what the code actually does.
 */

import { describe, it, expect } from "vitest";
import {
    normalizeCycleSchedule,
    computeNextCycleRun,
    previewCycleRuns,
    type CycleScheduleConfig,
} from "@shared/cycle-scheduling.js";

const FROM = new Date("2026-06-11T12:00:00Z");

const schedule = (over: Partial<CycleScheduleConfig> = {}): CycleScheduleConfig => ({
    ...normalizeCycleSchedule({}, "daily", "UTC"),
    ...over,
});

describe("normalizeCycleSchedule", () => {
    it("maps the legacy recurrence names onto current modes", () => {
        // Rows written before the vocabulary changed still carry these.
        expect(normalizeCycleSchedule({}, "continuous").mode).toBe("on_complete");
        expect(normalizeCycleSchedule({}, "interval").mode).toBe("hourly");
        expect(normalizeCycleSchedule({}, "custom").mode).toBe("daily");
    });

    it("falls back to a one-shot rather than guessing at an unknown mode", () => {
        expect(normalizeCycleSchedule({}, "every-other-tuesday").mode).toBe("once");
        expect(normalizeCycleSchedule({}, null).mode).toBe("once");
    });

    it("treats a one-shot as disabled and anything recurring as enabled", () => {
        expect(normalizeCycleSchedule({}, "once").enabled).toBe(false);
        expect(normalizeCycleSchedule({}, "daily").enabled).toBe(true);
    });

    it("prefers explicit scheduling metadata over the legacy column", () => {
        const cfg = normalizeCycleSchedule({ scheduling: { mode: "weekly" } }, "daily");
        expect(cfg.mode).toBe("weekly");
    });

    it("clamps the guard rails rather than trusting the stored value", () => {
        const cfg = normalizeCycleSchedule({
            scheduling: { mode: "daily", cooldownMinutes: -5, maxConsecutiveRuns: 0 },
        });
        expect(cfg.cooldownMinutes).toBe(0);
        expect(cfg.maxConsecutiveRuns).toBe(1);
    });
});

describe("computeNextCycleRun", () => {
    it("has no next run for a one-shot, an on-complete cycle, or a disabled one", () => {
        expect(computeNextCycleRun(FROM, schedule({ mode: "once" }))).toBeNull();
        expect(computeNextCycleRun(FROM, schedule({ mode: "on_complete" }))).toBeNull();
        expect(computeNextCycleRun(FROM, schedule({ enabled: false }))).toBeNull();
    });

    it.each([
        ["hourly", "2026-06-11T13:00:00.000Z"],
        ["daily", "2026-06-12T12:00:00.000Z"],
        ["weekly", "2026-06-18T12:00:00.000Z"],
    ] as const)("advances a %s cycle by one interval", (mode, expected) => {
        const next = computeNextCycleRun(FROM, schedule({ mode }));
        expect(next?.toISOString()).toBe(expected);
    });

    it("returns a future anchor untouched instead of stepping past it", () => {
        const anchor = "2026-09-01T08:00:00.000Z";
        const next = computeNextCycleRun(FROM, schedule({ mode: "daily", anchorAt: anchor }));
        expect(next?.toISOString()).toBe(anchor);
    });

    it("walks a stale anchor forward to the first run after `from`", () => {
        // An anchor months in the past must not produce a run in the past.
        const next = computeNextCycleRun(
            FROM,
            schedule({ mode: "daily", anchorAt: "2026-06-01T12:00:00.000Z" }),
        );
        expect(next!.getTime()).toBeGreaterThan(FROM.getTime());
    });

    it("clamps a monthly cycle onto short months", () => {
        const from = new Date("2026-01-31T12:00:00Z");
        const next = computeNextCycleRun(
            from,
            schedule({ mode: "monthly", anchorAt: "2026-01-31T12:00:00.000Z" }),
        );
        // February has no 31st; the run lands on the last day rather than
        // rolling into March.
        expect(next!.getMonth()).toBe(1);
    });

    it("gives up rather than looping once maxConsecutiveRuns is spent", () => {
        // A stale anchor plus a tight cap cannot reach `from`; the walk is
        // bounded, and the last cursor is returned rather than spinning.
        const next = computeNextCycleRun(
            FROM,
            schedule({ mode: "hourly", anchorAt: "2020-01-01T00:00:00.000Z", maxConsecutiveRuns: 3 }),
        );
        expect(next!.getTime()).toBeLessThan(FROM.getTime());
    });
});

describe("previewCycleRuns", () => {
    it("lists the next few runs in order", () => {
        const runs = previewCycleRuns(FROM, schedule({ mode: "daily" }), 3);

        expect(runs).toHaveLength(3);
        for (let i = 1; i < runs.length; i++) {
            expect(runs[i].getTime()).toBeGreaterThan(runs[i - 1].getTime());
        }
    });

    it("returns nothing for a cycle that never recurs", () => {
        expect(previewCycleRuns(FROM, schedule({ mode: "once" }), 5)).toEqual([]);
    });
});
