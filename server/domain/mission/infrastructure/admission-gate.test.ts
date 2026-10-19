import { describe, it, expect } from "vitest";

/**
 * The org concurrency admission gate, as a pure decision.
 *
 * Regression for a mutual standoff: the dynamic-mission gate counted every OTHER
 * active run (`id != self`), so with a limit of 1 and runs 86/87/88 all active,
 * each one saw 2 blockers and yielded — forever. Nothing could start, all 20
 * admission yields burned, and every run terminally failed. The rolling-wave
 * gate had always used `id < self` ("only yield to LOWER IDs"), which makes the
 * ordering a total order so exactly one run is always at the front.
 */

/** Mirrors the gate: yield when `blockers >= limit`. */
function admits(selfId: number, activeIds: number[], limit: number, mode: "lower-only" | "all-others"): boolean {
    const blockers = activeIds.filter(id =>
        mode === "lower-only" ? id < selfId : id !== selfId,
    );
    return blockers.length < limit;
}

const LIMIT = 1;

describe("org concurrency admission gate", () => {
    it("the old `!= self` rule deadlocks: nobody is admitted", () => {
        const active = [86, 87, 88];
        const admitted = active.filter(id => admits(id, active, LIMIT, "all-others"));
        expect(admitted, "every run yields to every other — the 4/1 standoff").toEqual([]);
    });

    it("`< self` always admits exactly one run — the earliest", () => {
        const active = [86, 87, 88];
        const admitted = active.filter(id => admits(id, active, LIMIT, "lower-only"));
        expect(admitted).toEqual([86]);
    });

    it("never admits more than the limit", () => {
        for (const limit of [1, 2, 3]) {
            const active = [10, 11, 12, 13, 14];
            const admitted = active.filter(id => admits(id, active, limit, "lower-only"));
            expect(admitted.length, `limit ${limit}`).toBe(limit);
        }
    });

    it("progress is monotonic: retiring the front run admits the next", () => {
        let active = [86, 87, 88];
        const order: number[] = [];
        while (active.length > 0) {
            const admitted = active.filter(id => admits(id, active, LIMIT, "lower-only"));
            expect(admitted.length, "the queue must never stall").toBe(1);
            order.push(admitted[0]);
            active = active.filter(id => id !== admitted[0]);
        }
        expect(order, "runs drain in submission order").toEqual([86, 87, 88]);
    });

    it("a lone run is always admitted under either rule", () => {
        expect(admits(88, [88], LIMIT, "lower-only")).toBe(true);
        expect(admits(88, [88], LIMIT, "all-others")).toBe(true);
    });

    it("a later run still yields to a live earlier one", () => {
        expect(admits(99, [86], LIMIT, "lower-only")).toBe(false);
        expect(admits(86, [99], LIMIT, "lower-only")).toBe(true);
    });
});
