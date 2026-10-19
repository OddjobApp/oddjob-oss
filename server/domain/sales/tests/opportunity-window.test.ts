import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRecordStore } from "../core/record-store.js";
import { SalesCollections } from "../core/collections.js";
import {
    openWindow,
    evaluateWindows,
    reArmWindow,
    reconcileWonLoss,
    currentWeightedPipeline,
    intervalSliceMs,
    parseLadder,
    type OpportunityWindow,
    type WindowSnapshot,
    type Activity,
} from "../core/opportunity-window.service.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = new Date("2026-01-01T00:00:00.000Z");
const at = (days: number, hours = 0) => new Date(T0.getTime() + days * DAY + hours * HOUR);

let store: InMemoryRecordStore;
beforeEach(() => {
    store = new InMemoryRecordStore();
});

async function getWindow(id: string): Promise<OpportunityWindow> {
    const r = await store.get<OpportunityWindow>(SalesCollections.opportunityWindows, id);
    if (!r) throw new Error(`window ${id} not found`);
    return r.data;
}
async function snapsFor(windowId: string): Promise<WindowSnapshot[]> {
    const all = await store.list<WindowSnapshot>(SalesCollections.windowSnapshots);
    return all.map((r) => r.data).filter((s) => s.window_id === windowId).sort((a, b) => a.taken_at.localeCompare(b.taken_at));
}
async function logActivity(a: Partial<Activity> & Pick<Activity, "opportunity_id" | "type" | "occurred_at">) {
    const rec: Activity = { activity_id: `act_${Math.random().toString(16).slice(2)}`, ...a };
    await store.upsert(SalesCollections.activities, rec.activity_id, rec);
}
/** Open a 30-day window (ladder [90,60,30,0] → 10-day slice) for a fresh opp. */
async function openStandard(opts: { grace?: number } = {}) {
    return openWindow(store, {
        opportunity_id: "opp_1",
        amount: 10_000,
        cycle_length_days: 30,
        grace_period_hours: opts.grace ?? 0,
        now: T0,
    });
}

describe("opportunity-window helpers", () => {
    it("derives the interval slice from the ladder", () => {
        expect(intervalSliceMs({ gate_ladder: JSON.stringify([90, 60, 30, 0]), cycle_length_days: 30 })).toBe(10 * DAY);
        expect(parseLadder({ gate_ladder: "not json" })).toEqual([90, 60, 30, 0]);
    });
});

describe("openWindow", () => {
    it("arms at the top rung and writes the opening snapshot", async () => {
        const w = await openStandard();
        expect(w.status).toBe("ARMED");
        expect(w.current_ceiling).toBe(90);
        expect(w.current_gate_index).toBe(0);
        expect(new Date(w.next_gate_deadline).getTime()).toBe(at(10).getTime());

        const snaps = await snapsFor(w.window_id);
        expect(snaps).toHaveLength(1);
        expect(snaps[0].trigger).toBe("opened");
        expect(snaps[0].ceiling_after).toBe(90);
        expect(snaps[0].weighted_value).toBe(9_000);
        expect(await currentWeightedPipeline(store)).toBe(9_000);
    });
});

describe("evaluateWindows — decay", () => {
    it("holds inside the interval, steps a rung once the deadline passes", async () => {
        const w = await openStandard();

        const quiet = await evaluateWindows(store, at(5));
        expect(quiet.stepped).toHaveLength(0);
        expect((await getWindow(w.window_id)).current_ceiling).toBe(90);

        const ev = await evaluateWindows(store, at(11));
        expect(ev.stepped).toEqual([w.window_id]);
        const after = await getWindow(w.window_id);
        expect(after.current_ceiling).toBe(60);
        expect(after.status).toBe("DECAYING");
        expect(new Date(after.next_gate_deadline).getTime()).toBe(at(20).getTime());

        const snaps = await snapsFor(w.window_id);
        expect(snaps.map((s) => s.trigger)).toEqual(["opened", "interval_elapsed"]);
        expect(ev.weightedPipeline).toBe(6_000);
    });

    it("respects the grace window before stepping", async () => {
        const w = await openStandard({ grace: 48 });

        const within = await evaluateWindows(store, at(10, 24)); // 24h past deadline, inside 48h grace
        expect(within.stepped).toHaveLength(0);
        expect((await getWindow(w.window_id)).current_ceiling).toBe(90);

        const past = await evaluateWindows(store, at(10, 49)); // 49h past → grace exhausted
        expect(past.stepped).toEqual([w.window_id]);
        expect((await getWindow(w.window_id)).current_ceiling).toBe(60);
    });

    it("catches up multiple rungs and auto-closes LOST at 0%", async () => {
        const w = await openStandard();
        const ev = await evaluateWindows(store, at(100)); // way overdue

        expect(ev.lost).toEqual([w.window_id]);
        expect(ev.stepped).toHaveLength(0);
        const after = await getWindow(w.window_id);
        expect(after.status).toBe("LOST");
        expect(after.outcome).toBe("lost");
        expect(after.current_ceiling).toBe(0);
        expect(after.closed_at).toBeTruthy();

        const snaps = await snapsFor(w.window_id);
        expect(snaps.map((s) => s.trigger)).toEqual(["opened", "interval_elapsed", "interval_elapsed", "lost"]);
        expect(ev.weightedPipeline).toBe(0);
    });
});

describe("evaluateWindows — re-arm", () => {
    it("a HOLD signal inside the run prevents the step-down and pushes the deadline", async () => {
        const w = await openStandard();
        await logActivity({ opportunity_id: "opp_1", type: "REPLY", occurred_at: at(9).toISOString() });

        const ev = await evaluateWindows(store, at(11));
        expect(ev.rearmed).toEqual([w.window_id]);
        expect(ev.stepped).toHaveLength(0);

        const after = await getWindow(w.window_id);
        expect(after.current_ceiling).toBe(90); // held
        expect(after.status).toBe("ARMED");
        expect(new Date(after.next_gate_deadline).getTime()).toBe(at(21).getTime()); // now + slice
        expect((await snapsFor(w.window_id)).map((s) => s.trigger)).toEqual(["opened", "rearm"]);
    });

    it("a STAGE_ADVANCED rebaseline jumps the ceiling back up", async () => {
        const w = await openStandard();
        // First let it decay to the 30% rung (index 2).
        await evaluateWindows(store, at(25));
        expect((await getWindow(w.window_id)).current_ceiling).toBe(30);

        // Then advance the stage → re-baseline to the 60% entitlement.
        await logActivity({
            opportunity_id: "opp_1",
            type: "STAGE_ADVANCED",
            occurred_at: at(26).toISOString(),
            rearm_effect: "REBASELINE",
            rebaseline_to: 60,
        });
        const ev = await evaluateWindows(store, at(26, 1));
        expect(ev.promoted).toEqual([w.window_id]);

        const after = await getWindow(w.window_id);
        expect(after.current_ceiling).toBe(60);
        expect(after.current_gate_index).toBe(1);
        expect((await snapsFor(w.window_id)).some((s) => s.trigger === "promotion")).toBe(true);
    });
});

describe("reArmWindow — targeted outbound rescue (Act III)", () => {
    it("holds the ceiling, resets the clock, and writes a rearm snapshot", async () => {
        const w = await openStandard();
        // Decay one rung to 60% so we can prove HOLD keeps the ceiling.
        await evaluateWindows(store, at(11));
        expect((await getWindow(w.window_id)).current_ceiling).toBe(60);

        const res = await reArmWindow(store, "opp_1", at(15));
        expect(res).not.toBeNull();
        expect(res!.ceiling).toBe(60); // held, not raised
        expect(new Date(res!.next_gate_deadline).getTime()).toBe(at(25).getTime()); // now + 10-day slice

        const after = await getWindow(w.window_id);
        expect(after.current_ceiling).toBe(60);
        expect(after.last_rearm_at).toBe(at(15).toISOString());
        const snaps = await snapsFor(w.window_id);
        expect(snaps.map((s) => s.trigger)).toEqual(["opened", "interval_elapsed", "rearm"]);
        // The reset clock defers the next step-down: a sweep just past the OLD deadline no longer steps.
        const ev = await evaluateWindows(store, at(21));
        expect(ev.stepped).toHaveLength(0);
    });

    it("returns null when the opportunity has no live window", async () => {
        expect(await reArmWindow(store, "ghost_opp", at(1))).toBeNull();
    });

    it("does not re-arm a terminal (LOST) window", async () => {
        const w = await openStandard();
        await evaluateWindows(store, at(100)); // decays to LOST
        expect((await getWindow(w.window_id)).status).toBe("LOST");
        expect(await reArmWindow(store, "opp_1", at(101))).toBeNull();
    });
});

describe("currentWeightedPipeline", () => {
    it("sums amount × ceiling/100 over live windows only", async () => {
        await openWindow(store, { opportunity_id: "opp_a", amount: 10_000, cycle_length_days: 30, now: T0 });
        await openWindow(store, { opportunity_id: "opp_b", amount: 20_000, cycle_length_days: 30, now: T0 });
        // opp_b decays one rung → 60%.
        const b = (await store.list<OpportunityWindow>(SalesCollections.opportunityWindows)).map((r) => r.data).find((w) => w.opportunity_id === "opp_b")!;
        await evaluateWindows(store, at(11)); // both still 90 except those past deadline... both opened at T0
        // After at(11) both stepped to 60 (no activity). Pipeline = (10k+20k)*0.6.
        expect(await currentWeightedPipeline(store)).toBe(18_000);
        void b;
    });
});

describe("reconcileWonLoss", () => {
    it("freezes a CLOSED_WON window and backfills realized_outcome across its snapshots", async () => {
        const w = await openStandard();
        await evaluateWindows(store, at(11)); // one interval_elapsed snapshot at 60%

        await store.upsert(SalesCollections.opportunities, "opp_1", { opportunity_id: "opp_1", stage: "CLOSED_WON" });
        const res = await reconcileWonLoss(store, at(12));

        expect(res.won).toEqual([w.window_id]);
        const after = await getWindow(w.window_id);
        expect(after.status).toBe("WON");
        expect(after.outcome).toBe("won");
        expect(after.current_ceiling).toBe(100);

        const snaps = await snapsFor(w.window_id);
        expect(snaps.some((s) => s.trigger === "won")).toBe(true);
        expect(snaps.every((s) => s.realized_outcome === 100)).toBe(true);
        expect(res.backfilled).toBe(snaps.length);
        // Frozen window no longer counts toward live pipeline.
        expect(await currentWeightedPipeline(store)).toBe(0);
    });

    it("marks a CLOSED_LOST window lost with realized_outcome 0", async () => {
        const w = await openStandard();
        await store.upsert(SalesCollections.opportunities, "opp_1", { opportunity_id: "opp_1", stage: "CLOSED_LOST" });
        const res = await reconcileWonLoss(store, at(3));

        expect(res.lost).toEqual([w.window_id]);
        expect((await getWindow(w.window_id)).status).toBe("LOST");
        expect((await snapsFor(w.window_id)).every((s) => s.realized_outcome === 0)).toBe(true);
    });
});
