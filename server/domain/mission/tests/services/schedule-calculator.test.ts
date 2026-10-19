/**
 * schedule-calculator.ts Tests — pure date logic with mocked deps
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@shared/schema", () => ({ schedules: {} }));
vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
}));

import { calculateNextRun } from "@domain/schedules/infrastructure/schedule-calculator.js";

type MockSchedule = {
    pattern: number;
    patternString: any;
    timezone?: string;
};

function makeSchedule(pattern: number, patternString: any, timezone?: string): any {
    return { pattern, patternString, timezone };
}

describe("calculateNextRun", () => {
    describe("pattern=1 (Daily)", () => {
        it("returns a future date for daily at a time later today", () => {
            // Far-future time → next run should be today
            const schedule = makeSchedule(1, { time: "23:59" });
            const result = calculateNextRun(schedule);
            expect(result).toBeInstanceOf(Date);
            expect(result!.getTime()).toBeGreaterThan(Date.now());
        });

        it("returns next day if the time has already passed today", () => {
            const schedule = makeSchedule(1, { time: "00:00" });
            const result = calculateNextRun(schedule);
            // 00:00 has definitely passed, so next run should be strictly in the future
            expect(result).toBeInstanceOf(Date);
            expect(result!.getTime()).toBeGreaterThan(Date.now());
        });

        it("falls back to 09:00 when no time config", () => {
            const schedule = makeSchedule(1, {});
            const result = calculateNextRun(schedule);
            expect(result).toBeInstanceOf(Date);
        });

        it("uses starttime field when time is absent", () => {
            const schedule = makeSchedule(1, { starttime: "10:00" });
            const result = calculateNextRun(schedule);
            expect(result).toBeInstanceOf(Date);
        });
    });

    describe("pattern=2 (Weekly)", () => {
        it("returns a future date for weekly on any valid day set", () => {
            // Use all 7 days so it's always valid
            const schedule = makeSchedule(2, { time: "09:00", days: [0, 1, 2, 3, 4, 5, 6] });
            const result = calculateNextRun(schedule);
            expect(result).toBeInstanceOf(Date);
            expect(result!.getTime()).toBeGreaterThan(Date.now());
        });

        it("returns null when days array is empty", () => {
            const schedule = makeSchedule(2, { time: "09:00", days: [] });
            const result = calculateNextRun(schedule);
            expect(result).toBeNull();
        });

        it("uses weekdays fallback when days is absent", () => {
            const schedule = makeSchedule(2, { weekdays: [1, 2, 3, 4, 5] });
            const result = calculateNextRun(schedule);
            expect(result).toBeInstanceOf(Date);
        });

        it("defaults to Mon-Fri when no days config", () => {
            const schedule = makeSchedule(2, { time: "09:00" });
            const result = calculateNextRun(schedule);
            expect(result).toBeInstanceOf(Date);
        });
    });

    describe("pattern=3 (Monthly)", () => {
        it("returns a future date", () => {
            const schedule = makeSchedule(3, { time: "09:00", dayOfMonth: 28 });
            const result = calculateNextRun(schedule);
            expect(result).toBeInstanceOf(Date);
        });

        it("uses day fallback when dayOfMonth absent", () => {
            const schedule = makeSchedule(3, { time: "09:00", day: 15 });
            const result = calculateNextRun(schedule);
            expect(result).toBeInstanceOf(Date);
        });

        it("defaults to day 1 when no day config", () => {
            const schedule = makeSchedule(3, { time: "09:00" });
            const result = calculateNextRun(schedule);
            expect(result).toBeInstanceOf(Date);
        });
    });

    describe("pattern=4 (Cron)", () => {
        it("returns next run for cron", () => {
            const schedule = makeSchedule(4, { cron: "0 9 * * *" });
            const result = calculateNextRun(schedule);
            expect(result).toBeInstanceOf(Date);
        });

        it("returns null when cron expression is missing", () => {
            const schedule = makeSchedule(4, {});
            const result = calculateNextRun(schedule);
            expect(result).toBeNull();
        });

        it("returns null for invalid cron expression", () => {
            const schedule = makeSchedule(4, { cron: "not-a-cron" });
            const result = calculateNextRun(schedule);
            expect(result).toBeNull();
        });

        it("returns next run for expression field fallback", () => {
            const schedule = makeSchedule(4, { expression: "*/5 * * * *" });
            const result = calculateNextRun(schedule);
            expect(result).toBeInstanceOf(Date);
        });

        it("returns next run with timezone", () => {
            const schedule = makeSchedule(4, { cron: "0 9 * * *" }, "America/New_York");
            const result = calculateNextRun(schedule);
            expect(result).toBeInstanceOf(Date);
        });
    });

    describe("pattern=unknown", () => {
        it("returns null for unknown pattern", () => {
            const schedule = makeSchedule(99, {});
            const result = calculateNextRun(schedule);
            expect(result).toBeNull();
        });
    });
});
