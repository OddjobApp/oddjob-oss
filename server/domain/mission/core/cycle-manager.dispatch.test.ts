/**
 * Unit tests for the concurrency-capped dispatcher (Phase 2 #1 + #6).
 * Exercises the private static `dispatchWithConcurrency` directly with a mock
 * `spawnOne` — pure scheduling, no DB.
 */
import { describe, it, expect, afterEach } from "vitest";
import { CycleManagerService } from "./cycle-manager.service.js";

const fts = (name: string) => ({ blueprintName: name, type: "finish_to_start" });

function makeTracker(delays: Record<string, number> = {}) {
  const order: string[] = [];
  const stats = { active: 0, peak: 0 };
  const poolPeak: Record<string, number> = {};
  const poolActive: Record<string, number> = {};
  const spawnOne = (bp: any) => {
    order.push(bp.name);
    stats.active++;
    stats.peak = Math.max(stats.peak, stats.active);
    return new Promise<void>((resolve) =>
      setTimeout(() => { stats.active--; resolve(); }, delays[bp.name] ?? 1)
    );
  };
  return { spawnOne, order, stats, poolPeak, poolActive };
}

const dispatch = (bps: any[], policy: any, spawnOne: (bp: any) => Promise<void>) =>
  (CycleManagerService as any).dispatchWithConcurrency(99, bps, spawnOne, policy, null);

afterEach(() => { delete process.env.WAVE_SCHEDULER; });

describe("dispatchWithConcurrency", () => {
  it("respects dependency order (downstream starts after upstream completes)", async () => {
    const bps = [
      { name: "A", dependencies: [] },
      { name: "B", dependencies: [fts("A")] },
      { name: "C", dependencies: [fts("B")] },
    ];
    const t = makeTracker();
    await dispatch(bps, {}, t.spawnOne);
    expect(t.order).toEqual(["A", "B", "C"]);
    expect(t.stats.peak).toBe(1); // linear chain never overlaps
  });

  it("runs independent blueprints concurrently when uncapped", async () => {
    const bps = ["A", "B", "C", "D"].map((n) => ({ name: n, dependencies: [] }));
    const t = makeTracker();
    await dispatch(bps, {}, t.spawnOne);
    expect(t.order.sort()).toEqual(["A", "B", "C", "D"]);
    expect(t.stats.peak).toBe(4);
  });

  it("enforces maxParallelMissions (#6 global cap)", async () => {
    const bps = ["A", "B", "C", "D", "E"].map((n) => ({ name: n, dependencies: [] }));
    const t = makeTracker();
    await dispatch(bps, { maxParallelMissions: 2 }, t.spawnOne);
    expect(t.order.length).toBe(5);        // all eventually run
    expect(t.stats.peak).toBeLessThanOrEqual(2);
  });

  it("enforces per-pool capacity (#6 resource pools)", async () => {
    const bps = ["A", "B", "C"].map((n) => ({ name: n, dependencies: [] }));
    const t = makeTracker();
    await dispatch(bps, { resourcePools: [{ name: "coders", capacity: 1, missions: ["A", "B", "C"] }] }, t.spawnOne);
    expect(t.order.length).toBe(3);
    expect(t.stats.peak).toBe(1); // pool capacity 1 serializes the whole pool
  });

  it("lets non-pool blueprints run alongside a capped pool", async () => {
    const bps = ["P1", "P2", "FREE"].map((n) => ({ name: n, dependencies: [] }));
    const t = makeTracker();
    await dispatch(bps, { resourcePools: [{ name: "p", capacity: 1, missions: ["P1", "P2"] }] }, t.spawnOne);
    expect(t.order.length).toBe(3);
    // FREE can overlap with one pool member → peak at least 2
    expect(t.stats.peak).toBeGreaterThanOrEqual(2);
  });

  it("completes even with a misconfigured zero-capacity pool (deadlock guard)", async () => {
    const bps = [{ name: "A", dependencies: [] }];
    const t = makeTracker();
    // capacity coerces to >=1, but exercise the guard path regardless
    await dispatch(bps, { resourcePools: [{ name: "x", capacity: 0, missions: ["A"] }] }, t.spawnOne);
    expect(t.order).toEqual(["A"]);
  });

  it("falls back to all-at-once when WAVE_SCHEDULER=off", async () => {
    process.env.WAVE_SCHEDULER = "off";
    const bps = ["A", "B", "C"].map((n) => ({ name: n, dependencies: [] }));
    const t = makeTracker();
    await dispatch(bps, { maxParallelMissions: 1 }, t.spawnOne); // cap ignored in fallback
    expect(t.stats.peak).toBe(3);
  });

  it("resolves on an empty blueprint list", async () => {
    const t = makeTracker();
    await dispatch([], {}, t.spawnOne);
    expect(t.order).toEqual([]);
  });
});
