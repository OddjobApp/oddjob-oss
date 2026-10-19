/**
 * Opportunity Window decay engine — the revenue analog of the Dead Man's Switch.
 *
 * Every open opportunity carries a window with a DECAYING win-probability
 * ceiling that steps down a ladder (default 90 → 60 → 30 → 0) as the sales
 * interval elapses. Buyer engagement (the `activities` feed) RE-ARMS the window:
 *   • HOLD       — resets the current rung's interval clock; ceiling unchanged.
 *   • REBASELINE — a stage advance jumps the ceiling back UP to the stage's
 *                  entitlement (the one upward move; everything else is monotone
 *                  non-increasing).
 * Silence past `next_gate_deadline + grace` STEPS the ceiling down one rung.
 * Reaching the 0% rung auto-closes the window LOST. Every transition writes an
 * immutable row to `window_snapshots` (the decay curve) — `failIfExists` keeps
 * them append-only; only `realized_outcome` is ever backfilled, by reconcile.
 *
 * Re-arm is evaluated BEFORE step-down, exactly like the DMS arrival-before-fault
 * rule (evaluateSwitches). Services here depend only on RecordStore, so the whole
 * engine unit-tests against InMemoryRecordStore with no DB.
 */

import crypto from "crypto";
import { RecordStore } from "./record-store.js";
import { SalesCollections, DEFAULT_GATE_LADDER, DEFAULT_REARM_SIGNALS } from "./collections.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type WindowStatus = "ARMED" | "DECAYING" | "WON" | "LOST";
export type RearmEffect = "HOLD" | "REBASELINE" | "NONE";
export type SnapshotTrigger =
    | "opened"
    | "interval_elapsed"
    | "rearm"
    | "promotion"
    | "won"
    | "lost"
    | "manual_override";

export interface OpportunityWindow {
    window_id: string;
    opportunity_id: string;
    amount: number;
    opened_at: string;
    cycle_length_days: number;
    gate_ladder: string;          // JSON-encoded number[] (per the cycle.yaml schema)
    current_gate_index: number;
    current_ceiling: number;
    next_gate_deadline: string;
    grace_period_hours: number;
    rearm_signals: string;        // JSON-encoded string[] of qualifying activity types
    last_rearm_at?: string | null;
    status: WindowStatus;
    outcome?: "won" | "lost" | null;
    closed_at?: string | null;
}

export interface WindowSnapshot {
    snapshot_id: string;
    window_id: string;
    opportunity_id: string;
    taken_at: string;
    gate_index: number;
    ceiling_before: number;
    ceiling_after: number;
    amount_at_snapshot: number;
    weighted_value: number;       // amount * ceiling_after / 100
    trigger: SnapshotTrigger;
    realized_outcome: number | null; // backfilled won=100 / lost=0 at terminal
}

export interface Activity {
    activity_id: string;
    opportunity_id: string;
    type: string;
    occurred_at: string;
    is_rearm_signal?: boolean;
    rearm_effect?: RearmEffect;   // defaults to HOLD when the activity qualifies
    rebaseline_to?: number;       // REBASELINE target ceiling (the stage entitlement)
    weight?: number;
}

export interface WindowEvaluation {
    stepped: string[];   // window_ids that dropped a rung but are still live (need a gate)
    rearmed: string[];   // window_ids held or promoted by engagement this run
    promoted: string[];  // subset of rearmed whose ceiling moved UP
    lost: string[];      // window_ids auto-closed at the 0% rung
    snapshots: string[]; // snapshot_ids written this run
    weightedPipeline: number; // Σ(amount * current_ceiling/100) over live windows
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Decode the gate ladder, falling back to the default on any malformed value. */
export function parseLadder(w: Pick<OpportunityWindow, "gate_ladder">): number[] {
    try {
        const arr = JSON.parse(w.gate_ladder);
        if (Array.isArray(arr) && arr.length >= 2 && arr.every((n) => typeof n === "number")) {
            return arr;
        }
    } catch {
        /* fall through */
    }
    return [...DEFAULT_GATE_LADDER];
}

function parseSignals(w: Pick<OpportunityWindow, "rearm_signals">): Set<string> {
    try {
        const arr = JSON.parse(w.rearm_signals);
        if (Array.isArray(arr)) return new Set(arr.map(String));
    } catch {
        /* fall through */
    }
    return new Set(DEFAULT_REARM_SIGNALS);
}

/** ms per gate step: the cycle is divided across the number of step-downs. */
export function intervalSliceMs(w: Pick<OpportunityWindow, "gate_ladder" | "cycle_length_days">): number {
    const ladder = parseLadder(w);
    const stepDowns = Math.max(1, ladder.length - 1);
    return (w.cycle_length_days * DAY_MS) / stepDowns;
}

const weightedOf = (w: Pick<OpportunityWindow, "amount" | "current_ceiling">): number =>
    round2((w.amount * w.current_ceiling) / 100);

/** Index of the ladder rung closest to `target` (ties favor the higher ceiling). */
function nearestRungIndex(ladder: number[], target: number): number {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < ladder.length; i++) {
        const d = Math.abs(ladder[i] - target);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}

async function writeSnapshot(
    store: RecordStore,
    w: OpportunityWindow,
    opts: { ceiling_before: number; ceiling_after: number; trigger: SnapshotTrigger; now: Date },
): Promise<WindowSnapshot> {
    const snap: WindowSnapshot = {
        snapshot_id: `snap_${opts.now.getTime()}_${crypto.randomBytes(5).toString("hex")}`,
        window_id: w.window_id,
        opportunity_id: w.opportunity_id,
        taken_at: opts.now.toISOString(),
        gate_index: w.current_gate_index,
        ceiling_before: opts.ceiling_before,
        ceiling_after: opts.ceiling_after,
        amount_at_snapshot: w.amount,
        weighted_value: round2((w.amount * opts.ceiling_after) / 100),
        trigger: opts.trigger,
        realized_outcome: null,
    };
    // Immutable append — a duplicate id would throw rather than overwrite history.
    await store.upsert(SalesCollections.windowSnapshots, snap.snapshot_id, snap, { failIfExists: true });
    return snap;
}

export interface OpenWindowParams {
    opportunity_id: string;
    amount: number;
    cycle_length_days: number;
    gate_ladder?: number[];
    grace_period_hours?: number;
    rearm_signals?: string[];
    now?: Date;
}

/** Arm a fresh window at the top rung and write the opening snapshot. */
export async function openWindow(store: RecordStore, p: OpenWindowParams): Promise<OpportunityWindow> {
    const now = p.now ?? new Date();
    const ladder = p.gate_ladder && p.gate_ladder.length >= 2 ? p.gate_ladder : [...DEFAULT_GATE_LADDER];
    const slice = (p.cycle_length_days * DAY_MS) / Math.max(1, ladder.length - 1);
    const w: OpportunityWindow = {
        window_id: `win_${now.getTime()}_${crypto.randomBytes(5).toString("hex")}`,
        opportunity_id: p.opportunity_id,
        amount: p.amount,
        opened_at: now.toISOString(),
        cycle_length_days: p.cycle_length_days,
        gate_ladder: JSON.stringify(ladder),
        current_gate_index: 0,
        current_ceiling: ladder[0],
        next_gate_deadline: new Date(now.getTime() + slice).toISOString(),
        grace_period_hours: p.grace_period_hours ?? 0,
        rearm_signals: JSON.stringify(p.rearm_signals ?? DEFAULT_REARM_SIGNALS),
        last_rearm_at: null,
        status: "ARMED",
        outcome: null,
        closed_at: null,
    };
    await store.upsert(SalesCollections.opportunityWindows, w.window_id, w);
    await writeSnapshot(store, w, { ceiling_before: ladder[0], ceiling_after: ladder[0], trigger: "opened", now });
    return w;
}

/** Qualifying re-arm activities since the window's last re-arm (or open), in order. */
function qualifyingActivities(activities: Activity[], w: OpportunityWindow, now: Date): Activity[] {
    const since = new Date(w.last_rearm_at ?? w.opened_at).getTime();
    const signals = parseSignals(w);
    return activities
        .filter((a) => a.opportunity_id === w.opportunity_id)
        .filter((a) => {
            const t = new Date(a.occurred_at).getTime();
            return !isNaN(t) && t > since && t <= now.getTime();
        })
        .filter((a) => a.is_rearm_signal === true || signals.has(a.type))
        .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
}

/**
 * The sweep: re-arm on engagement, else step the ceiling down on silence
 * (catching up multiple rungs if the window is badly overdue), auto-close LOST
 * at the 0% rung, and snapshot every transition. Returns what changed so the
 * mission can route a Deal Window Decision gate for each `stepped` window.
 */
export async function evaluateWindows(store: RecordStore, now: Date = new Date()): Promise<WindowEvaluation> {
    const windows = await store.list<OpportunityWindow>(SalesCollections.opportunityWindows);
    const activities = (await store.list<Activity>(SalesCollections.activities)).map((r) => r.data);
    const ev: WindowEvaluation = { stepped: [], rearmed: [], promoted: [], lost: [], snapshots: [], weightedPipeline: 0 };

    for (const { recordId, data } of windows) {
        const w: OpportunityWindow = { ...data };
        if (w.status === "WON" || w.status === "LOST") continue;

        const ladder = parseLadder(w);
        const slice = intervalSliceMs(w);

        // 1. Re-arm FIRST (arrival-before-fault).
        const acts = qualifyingActivities(activities, w, now);
        let rearmed = false;
        let promoted = false;
        for (const a of acts) {
            const effect: RearmEffect = a.rearm_effect ?? "HOLD";
            if (effect === "NONE") continue;
            rearmed = true;
            if (effect === "REBASELINE" && typeof a.rebaseline_to === "number") {
                const targetIdx = nearestRungIndex(ladder, a.rebaseline_to);
                if (targetIdx < w.current_gate_index) {
                    const before = w.current_ceiling;
                    w.current_gate_index = targetIdx;
                    w.current_ceiling = ladder[targetIdx];
                    w.status = "ARMED";
                    const snap = await writeSnapshot(store, w, {
                        ceiling_before: before,
                        ceiling_after: w.current_ceiling,
                        trigger: "promotion",
                        now,
                    });
                    ev.snapshots.push(snap.snapshot_id);
                    promoted = true;
                }
            }
        }
        if (rearmed) {
            w.last_rearm_at = now.toISOString();
            w.next_gate_deadline = new Date(now.getTime() + slice).toISOString();
            if (!promoted) {
                const snap = await writeSnapshot(store, w, {
                    ceiling_before: w.current_ceiling,
                    ceiling_after: w.current_ceiling,
                    trigger: "rearm",
                    now,
                });
                ev.snapshots.push(snap.snapshot_id);
            }
            await store.upsert(SalesCollections.opportunityWindows, recordId, w);
            ev.rearmed.push(recordId);
            if (promoted) ev.promoted.push(recordId);
            ev.weightedPipeline += weightedOf(w);
            continue; // re-arm wins this cycle
        }

        // 2. Step down — one rung per elapsed interval, catching up if overdue.
        let stepped = false;
        let becameLost = false;
        let deadlineMs = new Date(w.next_gate_deadline).getTime();
        const graceMs = (w.grace_period_hours || 0) * HOUR_MS;
        while (!becameLost && now.getTime() > deadlineMs + graceMs) {
            const before = w.current_ceiling;
            w.current_gate_index = Math.min(w.current_gate_index + 1, ladder.length - 1);
            w.current_ceiling = ladder[w.current_gate_index];
            stepped = true;
            if (w.current_ceiling <= 0) {
                w.status = "LOST";
                w.outcome = "lost";
                w.closed_at = now.toISOString();
                becameLost = true;
                const snap = await writeSnapshot(store, w, { ceiling_before: before, ceiling_after: 0, trigger: "lost", now });
                ev.snapshots.push(snap.snapshot_id);
                break;
            }
            w.status = "DECAYING";
            const snap = await writeSnapshot(store, w, {
                ceiling_before: before,
                ceiling_after: w.current_ceiling,
                trigger: "interval_elapsed",
                now,
            });
            ev.snapshots.push(snap.snapshot_id);
            deadlineMs += slice;
            w.next_gate_deadline = new Date(deadlineMs).toISOString();
        }
        if (stepped) {
            await store.upsert(SalesCollections.opportunityWindows, recordId, w);
            if (becameLost) ev.lost.push(recordId);
            else ev.stepped.push(recordId);
        }
        ev.weightedPipeline += weightedOf(w);
    }

    ev.weightedPipeline = round2(ev.weightedPipeline);
    return ev;
}

export interface ReArmResult {
    window_id: string;
    opportunity_id: string;
    ceiling: number;
    next_gate_deadline: string;
    snapshot_id: string;
}

/**
 * Targeted re-arm for a single opportunity — the engagement analog of a DMS
 * check-in. Used by the outbound-rescue breakpoint (Act III): dispatching a
 * followup HOLDs the live window, resetting its interval clock so the ceiling
 * gets a full slice before the next step-down. HOLD only — the ceiling is held,
 * never raised (that stays the exclusive right of a REBASELINE stage advance),
 * so this is monotone-safe. Writes an immutable `rearm` snapshot, mirroring the
 * HOLD branch of {@link evaluateWindows}. Returns null if the opp has no live
 * (ARMED/DECAYING) window.
 */
export async function reArmWindow(
    store: RecordStore,
    opportunity_id: string,
    now: Date = new Date(),
): Promise<ReArmResult | null> {
    const windows = await store.list<OpportunityWindow>(SalesCollections.opportunityWindows);
    const match = windows.find(
        ({ data }) => data.opportunity_id === opportunity_id && (data.status === "ARMED" || data.status === "DECAYING"),
    );
    if (!match) return null;

    const w: OpportunityWindow = { ...match.data };
    w.last_rearm_at = now.toISOString();
    w.next_gate_deadline = new Date(now.getTime() + intervalSliceMs(w)).toISOString();
    await store.upsert(SalesCollections.opportunityWindows, match.recordId, w);
    const snap = await writeSnapshot(store, w, {
        ceiling_before: w.current_ceiling,
        ceiling_after: w.current_ceiling,
        trigger: "rearm",
        now,
    });
    return {
        window_id: w.window_id,
        opportunity_id,
        ceiling: w.current_ceiling,
        next_gate_deadline: w.next_gate_deadline,
        snapshot_id: snap.snapshot_id,
    };
}

/** Live weighted pipeline across all ARMED/DECAYING windows. */
export async function currentWeightedPipeline(store: RecordStore): Promise<number> {
    const windows = await store.list<OpportunityWindow>(SalesCollections.opportunityWindows);
    let sum = 0;
    for (const { data } of windows) {
        if (data.status === "ARMED" || data.status === "DECAYING") sum += weightedOf(data);
    }
    return round2(sum);
}

export interface ReconcileResult {
    won: string[];
    lost: string[];
    backfilled: number; // snapshot rows stamped with realized_outcome
}

/**
 * Terminal reconciliation: any non-terminal window whose opportunity has reached
 * CLOSED_WON / CLOSED_LOST is frozen (won=100 / lost=0), a terminal snapshot is
 * written, and `realized_outcome` is backfilled across that window's snapshot
 * history. The backfill is the ONE sanctioned mutation of a snapshot row — it
 * turns the decay curve into labelled training data for gate calibration.
 */
export async function reconcileWonLoss(store: RecordStore, now: Date = new Date()): Promise<ReconcileResult> {
    const opps = (await store.list<{ opportunity_id: string; stage: string }>(SalesCollections.opportunities)).map((r) => r.data);
    const stageByOpp = new Map(opps.map((o) => [o.opportunity_id, o.stage]));
    const windows = await store.list<OpportunityWindow>(SalesCollections.opportunityWindows);
    const res: ReconcileResult = { won: [], lost: [], backfilled: 0 };

    for (const { recordId, data } of windows) {
        if (data.status === "WON" || data.status === "LOST") continue;
        const stage = stageByOpp.get(data.opportunity_id);
        const terminal: "won" | "lost" | null =
            stage === "CLOSED_WON" ? "won" : stage === "CLOSED_LOST" ? "lost" : null;
        if (!terminal) continue;

        const before = data.current_ceiling;
        const after = terminal === "won" ? 100 : 0;
        const w: OpportunityWindow = {
            ...data,
            status: terminal === "won" ? "WON" : "LOST",
            outcome: terminal,
            current_ceiling: after,
            closed_at: now.toISOString(),
        };
        await store.upsert(SalesCollections.opportunityWindows, recordId, w);
        await writeSnapshot(store, w, { ceiling_before: before, ceiling_after: after, trigger: terminal, now });

        const realized = terminal === "won" ? 100 : 0;
        const allSnaps = await store.list<WindowSnapshot>(SalesCollections.windowSnapshots);
        for (const s of allSnaps) {
            if (s.data.window_id === w.window_id && s.data.realized_outcome === null) {
                await store.upsert(SalesCollections.windowSnapshots, s.recordId, { ...s.data, realized_outcome: realized });
                res.backfilled++;
            }
        }
        (terminal === "won" ? res.won : res.lost).push(recordId);
    }
    return res;
}
