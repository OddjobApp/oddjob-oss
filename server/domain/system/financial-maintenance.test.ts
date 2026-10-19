import { describe, expect, it } from "vitest";
import { budgetPeriodStart } from "./financial-maintenance.service.js";

/** Local date, matching budgetPeriodStart's own construction. */
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("budgetPeriodStart", () => {
    it("uses this month once the reset day has passed", () => {
        expect(iso(budgetPeriodStart(at(2026, 8, 10), 1))).toBe("2026-08-01");
    });

    it("uses last month before the reset day arrives", () => {
        expect(iso(budgetPeriodStart(at(2026, 8, 10), 15))).toBe("2026-07-15");
    });

    it("treats the reset day itself as the start of the new period", () => {
        expect(iso(budgetPeriodStart(at(2026, 8, 15), 15))).toBe("2026-08-15");
    });

    it("rolls back across a year boundary", () => {
        expect(iso(budgetPeriodStart(at(2026, 1, 5), 20))).toBe("2025-12-20");
    });

    it("still fires in February for a reset day of 31", () => {
        // Clamped to the month's length. The old day-equality check skipped
        // these months entirely, so a 31st-of-the-month org never reset in
        // February, April, June, September or November.
        expect(iso(budgetPeriodStart(at(2026, 2, 28), 31))).toBe("2026-02-28");
    });

    it("clamps the previous month too", () => {
        expect(iso(budgetPeriodStart(at(2026, 3, 5), 31))).toBe("2026-02-28");
    });

    it("clamps an out-of-range reset day into the month rather than skipping", () => {
        // The schema constrains this to 1-31, so these are defensive. 0 (or a
        // missing value) reads as the 1st; anything above 31 clamps to the last
        // day of the month, the same rule day-31 orgs already follow. What
        // matters is that neither produces an org that never resets.
        expect(iso(budgetPeriodStart(at(2026, 8, 10), 0))).toBe("2026-08-01");
        expect(iso(budgetPeriodStart(at(2026, 8, 10), 99))).toBe("2026-07-31");
    });

    it("starts at midnight, so a same-day reset counts as done", () => {
        const start = budgetPeriodStart(at(2026, 8, 15), 15);
        expect(start.getHours()).toBe(0);
        expect(start.getMinutes()).toBe(0);
    });

    it("marks a months-stale reset as due — the case that produced this bug", () => {
        // org 291: reset day 1, last reset 27 June, still holding its June
        // counter on 10 August. The period began 1 August, which is after the
        // last reset, so it is due.
        const periodStart = budgetPeriodStart(at(2026, 8, 10), 1);
        const lastReset = at(2026, 6, 27);
        expect(lastReset >= periodStart).toBe(false);
    });

    it("does not re-reset an org already reset inside this period", () => {
        const periodStart = budgetPeriodStart(at(2026, 8, 10), 1);
        const lastReset = at(2026, 8, 1);
        expect(lastReset >= periodStart).toBe(true);
    });
});
