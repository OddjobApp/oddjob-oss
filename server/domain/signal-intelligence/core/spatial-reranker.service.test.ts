import { describe, it, expect } from "vitest";
import { latLngToCell, gridDisk } from "h3-js";
import { SpatialRerankerService, type RerankableSignal } from "./spatial-reranker.service";

const engine = new SpatialRerankerService();

const HUB = latLngToCell(33.743, -118.267, 7);
const HUB_NEIGHBOURS = gridDisk(HUB, 1);
const ROTTERDAM = latLngToCell(51.924, 4.477, 7);
const SINGAPORE = latLngToCell(1.29, 103.851, 7);

function signal(over: Partial<RerankableSignal> = {}): RerankableSignal {
  return {
    ruleId: `rule_${Math.random().toString(36).slice(2, 7)}`,
    masterPriorityScore: 50,
    observedAt: new Date(),
    ...over,
  };
}

describe("urgency", () => {
  it("promotes an imminent breach over an equally-scored distant one", () => {
    const imminent = signal({
      ruleId: "imminent",
      h3Index: HUB,
      distanceToBoundaryKm: 2,
      velocityKnots: 25,
    });
    const distant = signal({
      ruleId: "distant",
      h3Index: ROTTERDAM,
      distanceToBoundaryKm: 400,
      velocityKnots: 25,
    });

    const ranked = engine.rerank([distant, imminent]);
    expect(ranked[0].signal.ruleId).toBe("imminent");
    expect(ranked[0].timeToBreachMinutes).toBeLessThan(10);
    expect(ranked[0].adjustments.some((a) => /breach/i.test(a.reason))).toBe(true);
  });

  it("treats an already-breached signal as maximally urgent", () => {
    const breached = signal({ h3Index: HUB, distanceToBoundaryKm: 0, velocityKnots: 10 });
    const ranked = engine.rerank([breached]);
    expect(ranked[0].timeToBreachMinutes).toBe(0);
  });

  it("computes no urgency for a stationary entity", () => {
    const idle = signal({ h3Index: HUB, distanceToBoundaryKm: 5, velocityKnots: 0 });
    expect(engine.rerank([idle])[0].timeToBreachMinutes).toBeNull();
  });
});

describe("spatial de-duplication", () => {
  it("demotes co-located duplicates so one hotspot cannot fill the queue", () => {
    // Eight signals from the same harbour, one from elsewhere.
    const harbour = HUB_NEIGHBOURS.slice(0, 7).map((cell, i) =>
      signal({ ruleId: `harbour_${i}`, h3Index: cell, masterPriorityScore: 90 })
    );
    const elsewhere = signal({
      ruleId: "singapore",
      h3Index: SINGAPORE,
      masterPriorityScore: 70,
    });

    const ranked = engine.rerank([...harbour, elsewhere]);

    // The distinct incident must surface above the harbour's duplicates,
    // despite its lower raw score.
    const leads = ranked.filter((r) => r.isClusterLead).map((r) => r.signal.ruleId);
    expect(leads).toContain("singapore");
    expect(leads).toHaveLength(2); // one harbour lead + singapore

    const singaporeRank = ranked.findIndex((r) => r.signal.ruleId === "singapore");
    const demotedHarbour = ranked.findIndex((r) => !r.isClusterLead);
    expect(singaporeRank).toBeLessThan(demotedHarbour);
  });

  it("reports cluster size and keeps every signal", () => {
    const cluster = HUB_NEIGHBOURS.slice(0, 5).map((cell, i) =>
      signal({ ruleId: `c${i}`, h3Index: cell })
    );
    const ranked = engine.rerank(cluster);

    expect(ranked).toHaveLength(5); // nothing dropped
    expect(ranked.every((r) => r.clusterSize === 5)).toBe(true);
    expect(ranked.filter((r) => r.isClusterLead)).toHaveLength(1);
  });

  it("honours maxPerCluster", () => {
    const cluster = HUB_NEIGHBOURS.slice(0, 6).map((cell, i) =>
      signal({ ruleId: `c${i}`, h3Index: cell })
    );
    const ranked = engine.rerank(cluster, { maxPerCluster: 3 });
    expect(ranked.filter((r) => r.isClusterLead)).toHaveLength(3);
  });

  it("never de-duplicates signals that carry no cell", () => {
    const noCell = [signal({ ruleId: "a" }), signal({ ruleId: "b" })];
    const ranked = engine.rerank(noCell);
    expect(ranked.every((r) => r.isClusterLead)).toBe(true);
    expect(ranked.every((r) => r.clusterId === null)).toBe(true);
  });
});

describe("recency and spatial score", () => {
  it("decays a stale signal below a fresh one of equal score", () => {
    const fresh = signal({ ruleId: "fresh", h3Index: HUB, observedAt: new Date() });
    const stale = signal({
      ruleId: "stale",
      h3Index: SINGAPORE,
      observedAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4h old
    });

    const ranked = engine.rerank([stale, fresh]);
    expect(ranked[0].signal.ruleId).toBe("fresh");
    expect(
      ranked.find((r) => r.signal.ruleId === "stale")!.adjustments.some((a) => a.delta < 0)
    ).toBe(true);
  });

  it("uses the spatial score as a tiebreaker", () => {
    const strong = signal({ ruleId: "strong", h3Index: HUB, spatialScore: 0.95 });
    const weak = signal({ ruleId: "weak", h3Index: SINGAPORE, spatialScore: 0.05 });

    const ranked = engine.rerank([weak, strong]);
    expect(ranked[0].signal.ruleId).toBe("strong");
  });

  it("clamps the final score to 0-100", () => {
    const extreme = signal({
      h3Index: HUB,
      masterPriorityScore: 99,
      spatialScore: 1,
      distanceToBoundaryKm: 0,
      velocityKnots: 40,
    });
    const ranked = engine.rerank([extreme], { recencyHalfLifeMinutes: 0 });
    expect(ranked[0].rerankScore).toBeLessThanOrEqual(100);
    expect(ranked[0].rerankScore).toBeGreaterThanOrEqual(0);
  });

  it("returns an empty array for no input", () => {
    expect(engine.rerank([])).toEqual([]);
  });
});
