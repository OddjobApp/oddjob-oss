import { describe, it, expect, beforeEach } from "vitest";
import { latLngToCell, cellToLatLng, gridDisk, cellToParent } from "h3-js";
import {
  SpatialPredicateEngineService,
  type SpatialObservation,
} from "./spatial-predicate-engine.service";
import {
  makeCellGroupId,
  normalizeOperator,
  normalizeSpatialPredicate,
  parseH3Resolution,
  requiredMatchCount,
  type SpatialCondition,
} from "@shared/contracts/spatial-predicates";

// Port of LA / Long Beach — the platform's default maritime hub.
const HUB_LAT = 33.743;
const HUB_LNG = -118.267;
const RES = 7;

const HUB_CELL = latLngToCell(HUB_LAT, HUB_LNG, RES);
/** Ring of 7 cells (origin + 6 neighbours) used as the standard test zone. */
const HUB_DISK = gridDisk(HUB_CELL, 1);

/** A cell far outside the hub — mid-Atlantic. */
const FAR_CELL = latLngToCell(20.0, -40.0, RES);
const [FAR_LAT, FAR_LNG] = cellToLatLng(FAR_CELL);

let engine: SpatialPredicateEngineService;

beforeEach(() => {
  engine = new SpatialPredicateEngineService();
});

function hubGeometry(cells: string[] = HUB_DISK) {
  return {
    regionName: "Pacific Maritime Hub",
    h3Cells: cells,
    h3Resolution: RES,
    centerLat: HUB_LAT,
    centerLng: HUB_LNG,
  };
}

/** An observation positioned at a given cell's centroid. */
function atCell(cell: string, extra: Partial<SpatialObservation> = {}): SpatialObservation {
  const [lat, lng] = cellToLatLng(cell);
  return { latitude: lat, longitude: lng, h3Index: cell, ...extra };
}

// ===========================================================================
// 1. GEOFENCE TRIGGERS
// ===========================================================================

describe("geofence triggers", () => {
  it("ON_ENTER fires when the previous fix was outside and the current is inside", () => {
    const cond: SpatialCondition = {
      type: "spatial",
      mode: "geofence_trigger",
      trigger: "ON_ENTER",
      geometry: hubGeometry(),
    };

    const entered = engine.evaluateCondition(cond, atCell(HUB_CELL, { previousH3Index: FAR_CELL }));
    expect(entered.passed).toBe(true);
    expect(entered.explanation).toMatch(/crossed into/i);
  });

  it("ON_ENTER does NOT re-fire when the asset was already inside", () => {
    const cond: SpatialCondition = {
      type: "spatial",
      mode: "geofence_trigger",
      trigger: "ON_ENTER",
      geometry: hubGeometry(),
    };

    // Previous tick was a different cell but still inside the zone.
    const stillInside = engine.evaluateCondition(
      cond,
      atCell(HUB_CELL, { previousH3Index: HUB_DISK[1] })
    );
    expect(stillInside.passed).toBe(false);
    expect(stillInside.explanation).toMatch(/already inside/i);
  });

  it("ON_EXIT fires only on an inside→outside transition", () => {
    const cond: SpatialCondition = {
      type: "spatial",
      mode: "geofence_trigger",
      trigger: "ON_EXIT",
      geometry: hubGeometry(),
    };

    expect(
      engine.evaluateCondition(cond, atCell(FAR_CELL, { previousH3Index: HUB_CELL })).passed
    ).toBe(true);

    // Never was inside → not an exit.
    expect(
      engine.evaluateCondition(cond, atCell(FAR_CELL, { previousH3Index: FAR_CELL })).passed
    ).toBe(false);
  });

  it("ON_DWELL fires past the SLA and scores higher the longer the overrun", () => {
    const cond: SpatialCondition = {
      type: "spatial",
      mode: "geofence_trigger",
      trigger: "ON_DWELL",
      dwellSlaMinutes: 120,
      geometry: hubGeometry(),
    };

    const within = engine.evaluateCondition(cond, atCell(HUB_CELL, { dwellMinutes: 90 }));
    expect(within.passed).toBe(false);

    const marginal = engine.evaluateCondition(cond, atCell(HUB_CELL, { dwellMinutes: 150 }));
    const gross = engine.evaluateCondition(cond, atCell(HUB_CELL, { dwellMinutes: 240 }));

    expect(marginal.passed).toBe(true);
    expect(gross.passed).toBe(true);
    // The ramp is the point: a 4h overrun must outrank a 30min one.
    expect(gross.score).toBeGreaterThan(marginal.score);
    expect(gross.observed).toBe(240);
  });

  it("ON_APPROACH fires inside the buffer but not once the boundary is breached", () => {
    const cond: SpatialCondition = {
      type: "spatial",
      mode: "geofence_trigger",
      trigger: "ON_APPROACH",
      approachBufferKm: 50,
      geometry: hubGeometry(),
    };

    // A cell ~20km out: outside the zone, inside the 50km buffer.
    const nearby = gridDisk(HUB_CELL, 4).find((c) => !HUB_DISK.includes(c))!;
    const approach = engine.evaluateCondition(cond, atCell(nearby));
    expect(approach.passed).toBe(true);

    // Already inside → the approach window has passed.
    const breached = engine.evaluateCondition(cond, atCell(HUB_CELL));
    expect(breached.passed).toBe(false);
    expect(breached.explanation).toMatch(/already breached/i);

    // Far away → outside the buffer.
    expect(engine.evaluateCondition(cond, atCell(FAR_CELL)).passed).toBe(false);
  });
});

// ===========================================================================
// 2. TOPOLOGICAL PREDICATES
// ===========================================================================

describe("topological predicates", () => {
  const base = { type: "spatial" as const, mode: "topological" as const, geometry: hubGeometry() };

  it("there / not_there are exact complements", () => {
    const there = engine.evaluateCondition({ ...base, predicate: "there" }, atCell(HUB_CELL));
    const notThere = engine.evaluateCondition({ ...base, predicate: "not_there" }, atCell(HUB_CELL));
    expect(there.passed).toBe(true);
    expect(notThere.passed).toBe(false);

    const outsideThere = engine.evaluateCondition({ ...base, predicate: "there" }, atCell(FAR_CELL));
    const outsideNot = engine.evaluateCondition(
      { ...base, predicate: "not_there" },
      atCell(FAR_CELL)
    );
    expect(outsideThere.passed).toBe(false);
    expect(outsideNot.passed).toBe(true);
  });

  it("contains matches a fine child cell against a coarse parent zone", () => {
    // Zone declared at Res 6; the asset reports a Res 9 cell inside it.
    const parentCell = cellToParent(HUB_CELL, 6);
    const fineCell = latLngToCell(HUB_LAT, HUB_LNG, 9);

    const result = engine.evaluateCondition(
      {
        type: "spatial",
        mode: "topological",
        predicate: "contains",
        geometry: { regionName: "Macro Sector", h3Cells: [parentCell] },
      },
      atCell(fineCell)
    );

    expect(result.passed).toBe(true);
    expect(result.explanation).toMatch(/encompasses/i);
  });

  it("intersects detects a trajectory crossing the zone", () => {
    // Path from far outside, through the hub.
    const crossing = engine.evaluateCondition(
      { ...base, predicate: "intersects" },
      atCell(HUB_CELL, { previousH3Index: gridDisk(HUB_CELL, 5)[18] })
    );
    expect(crossing.passed).toBe(true);
  });

  it("k_ring bounds selection to the concentric rings around the origin", () => {
    const k1: SpatialCondition = {
      type: "spatial",
      mode: "topological",
      predicate: "k_ring",
      geometry: { ...hubGeometry(), k: 1 },
    };

    // A neighbour is within k=1.
    expect(engine.evaluateCondition(k1, atCell(HUB_DISK[1])).passed).toBe(true);

    // A cell three rings out is not.
    const ring3 = gridDisk(HUB_CELL, 3).find((c) => !gridDisk(HUB_CELL, 2).includes(c))!;
    expect(engine.evaluateCondition(k1, atCell(ring3)).passed).toBe(false);
  });

  it("reports rather than throws when the signal has no coordinates", () => {
    const result = engine.evaluateCondition({ ...base, predicate: "there" }, {});
    expect(result.passed).toBe(false);
    expect(result.explanation).toMatch(/no coordinates/i);
  });
});

// ===========================================================================
// 3. FLUX & VECTOR ANALYTICS
// ===========================================================================

describe("flux and vector analytics", () => {
  it("spatial_drift measures the gap between actual and projected position", () => {
    const cond: SpatialCondition = {
      type: "spatial",
      mode: "flux_analytic",
      fn: "spatial_drift",
      operator: "greater_than_or_equal",
      value: 5,
      geometry: hubGeometry(),
    };

    // ~0 drift: actual == projected.
    const onCourse = engine.evaluateCondition(cond, {
      latitude: HUB_LAT,
      longitude: HUB_LNG,
      projectedLatitude: HUB_LAT,
      projectedLongitude: HUB_LNG,
    });
    expect(onCourse.passed).toBe(false);
    expect(onCourse.observed).toBeCloseTo(0, 3);

    // ~111km of drift (1 degree of latitude).
    const offCourse = engine.evaluateCondition(cond, {
      latitude: HUB_LAT + 1,
      longitude: HUB_LNG,
      projectedLatitude: HUB_LAT,
      projectedLongitude: HUB_LNG,
    });
    expect(offCourse.passed).toBe(true);
    expect(offCourse.observed).toBeGreaterThan(100);
  });

  it("velocity_vector enforces a speed limit", () => {
    const cond: SpatialCondition = {
      type: "spatial",
      mode: "flux_analytic",
      fn: "velocity_vector",
      operator: "greater_than_or_equal",
      value: 25,
      geometry: hubGeometry(),
    };

    expect(engine.evaluateCondition(cond, atCell(HUB_CELL, { velocityKnots: 30 })).passed).toBe(true);
    expect(engine.evaluateCondition(cond, atCell(HUB_CELL, { velocityKnots: 12 })).passed).toBe(false);
  });

  it("between accepts bounds written in either order", () => {
    const cond: SpatialCondition = {
      type: "spatial",
      mode: "flux_analytic",
      fn: "velocity_vector",
      operator: "between",
      value: [10, 30],
      geometry: hubGeometry(),
    };
    const reversed: SpatialCondition = { ...cond, value: [30, 10] };

    for (const c of [cond, reversed]) {
      expect(engine.evaluateCondition(c, atCell(HUB_CELL, { velocityKnots: 20 })).passed).toBe(true);
      expect(engine.evaluateCondition(c, atCell(HUB_CELL, { velocityKnots: 45 })).passed).toBe(false);
    }
  });

  it("equidistant_neighbors yields 6 for a normal hexagon", () => {
    const cond: SpatialCondition = {
      type: "spatial",
      mode: "flux_analytic",
      fn: "equidistant_neighbors",
      operator: "equals",
      value: 6,
      geometry: hubGeometry(),
    };
    const result = engine.evaluateCondition(cond, atCell(HUB_CELL));
    expect(result.observed).toBe(6);
    expect(result.passed).toBe(true);
  });

  it("reports missing telemetry instead of scoring a false pass", () => {
    const cond: SpatialCondition = {
      type: "spatial",
      mode: "flux_analytic",
      fn: "isotropic_flux_density",
      operator: "greater_than_or_equal",
      value: 0.7,
      geometry: hubGeometry(),
    };
    const result = engine.evaluateCondition(cond, atCell(HUB_CELL)); // no phi
    expect(result.passed).toBe(false);
    expect(result.explanation).toMatch(/lacks the telemetry/i);
  });
});

// ===========================================================================
// 4. HEX TILE GROUPS
// ===========================================================================

describe("hex tile groups", () => {
  /** Per-tile flux metrics: 3 of the 7 hub tiles are congested. */
  function metricsWithBreaches(count: number) {
    const cellMetrics: Record<string, { fluxDensityPhi: number }> = {};
    HUB_DISK.forEach((cell, i) => {
      cellMetrics[cell] = { fluxDensityPhi: i < count ? 0.9 : 0.1 };
    });
    return cellMetrics;
  }

  function groupCondition(
    aggregation: "any" | "all" | "majority" | "at_least",
    atLeastK?: number
  ): SpatialCondition {
    return {
      type: "spatial",
      mode: "flux_analytic",
      fn: "isotropic_flux_density",
      operator: "greater_than_or_equal",
      value: 0.7,
      geometry: {
        regionName: "Pacific Maritime Hub",
        cellGroups: [
          {
            groupId: makeCellGroupId("Harbour Approaches"),
            name: "Harbour Approaches",
            cells: HUB_DISK,
            resolution: RES,
            aggregation,
            atLeastK,
          },
        ],
      },
    };
  }

  it("'any' passes on a single breaching tile", () => {
    const result = engine.evaluateCondition(
      groupCondition("any"),
      atCell(HUB_CELL, { cellMetrics: metricsWithBreaches(1) })
    );
    expect(result.passed).toBe(true);
    expect(result.groups?.[0].matchedCells).toHaveLength(1);
  });

  it("'at_least' K enforces the tile count", () => {
    const threeBreaching = atCell(HUB_CELL, { cellMetrics: metricsWithBreaches(3) });

    expect(engine.evaluateCondition(groupCondition("at_least", 3), threeBreaching).passed).toBe(true);
    expect(engine.evaluateCondition(groupCondition("at_least", 4), threeBreaching).passed).toBe(false);
  });

  it("'majority' needs more than half the tiles", () => {
    // 7 tiles → majority is 4.
    expect(
      engine.evaluateCondition(
        groupCondition("majority"),
        atCell(HUB_CELL, { cellMetrics: metricsWithBreaches(3) })
      ).passed
    ).toBe(false);

    expect(
      engine.evaluateCondition(
        groupCondition("majority"),
        atCell(HUB_CELL, { cellMetrics: metricsWithBreaches(4) })
      ).passed
    ).toBe(true);
  });

  it("'all' needs every tile", () => {
    expect(
      engine.evaluateCondition(
        groupCondition("all"),
        atCell(HUB_CELL, { cellMetrics: metricsWithBreaches(HUB_DISK.length - 1) })
      ).passed
    ).toBe(false);

    expect(
      engine.evaluateCondition(
        groupCondition("all"),
        atCell(HUB_CELL, { cellMetrics: metricsWithBreaches(HUB_DISK.length) })
      ).passed
    ).toBe(true);
  });

  it("scores by how much of the set matched, not merely that it did", () => {
    const few = engine.evaluateCondition(
      groupCondition("any"),
      atCell(HUB_CELL, { cellMetrics: metricsWithBreaches(1) })
    );
    const many = engine.evaluateCondition(
      groupCondition("any"),
      atCell(HUB_CELL, { cellMetrics: metricsWithBreaches(6) })
    );

    expect(few.passed).toBe(true);
    expect(many.passed).toBe(true);
    expect(many.score).toBeGreaterThan(few.score);
  });

  it("combines multiple groups with any/all", () => {
    const farDisk = gridDisk(FAR_CELL, 1);
    const cellMetrics: Record<string, { fluxDensityPhi: number }> = {};
    HUB_DISK.forEach((c) => (cellMetrics[c] = { fluxDensityPhi: 0.9 })); // hub breaches
    farDisk.forEach((c) => (cellMetrics[c] = { fluxDensityPhi: 0.1 })); // atlantic quiet

    const build = (combinator: "any" | "all"): SpatialCondition => ({
      type: "spatial",
      mode: "flux_analytic",
      fn: "isotropic_flux_density",
      operator: "greater_than_or_equal",
      value: 0.7,
      geometry: {
        groupCombinator: combinator,
        cellGroups: [
          {
            groupId: "g_hub",
            name: "Hub",
            cells: HUB_DISK,
            resolution: RES,
            aggregation: "any",
          },
          {
            groupId: "g_atlantic",
            name: "Atlantic",
            cells: farDisk,
            resolution: RES,
            aggregation: "any",
          },
        ],
      },
    });

    const obs = atCell(HUB_CELL, { cellMetrics });
    expect(engine.evaluateCondition(build("any"), obs).passed).toBe(true);
    // Atlantic is quiet, so requiring both must fail.
    expect(engine.evaluateCondition(build("all"), obs).passed).toBe(false);
  });

  it("a single-tile group is a valid set", () => {
    const cond: SpatialCondition = {
      type: "spatial",
      mode: "topological",
      predicate: "there",
      geometry: {
        cellGroups: [
          { groupId: "g_one", name: "Berth 12", cells: [HUB_CELL], resolution: RES, aggregation: "any" },
        ],
      },
    };

    expect(engine.evaluateCondition(cond, atCell(HUB_CELL)).passed).toBe(true);
    expect(engine.evaluateCondition(cond, atCell(FAR_CELL)).passed).toBe(false);
  });

  it("flags an empty tile set rather than silently passing", () => {
    const cond: SpatialCondition = {
      type: "spatial",
      mode: "topological",
      predicate: "there",
      geometry: {
        cellGroups: [{ groupId: "g_empty", name: "Unpainted", cells: [], aggregation: "any" }],
      },
    };
    const result = engine.evaluateCondition(cond, atCell(HUB_CELL));
    expect(result.passed).toBe(false);
    expect(result.groups?.[0].explanation).toMatch(/no valid H3 cells/i);
  });
});

// ===========================================================================
// AGGREGATION & SCORING
// ===========================================================================

describe("aggregate scoring", () => {
  const inside: SpatialCondition = {
    type: "spatial",
    mode: "topological",
    predicate: "there",
    geometry: hubGeometry(),
  };
  const outside: SpatialCondition = {
    type: "spatial",
    mode: "topological",
    predicate: "not_there",
    geometry: hubGeometry(),
  };

  it("ALL requires every condition, ANY requires one", () => {
    const obs = atCell(HUB_CELL);
    expect(engine.evaluate([inside, outside], obs, "ALL").passed).toBe(false);
    expect(engine.evaluate([inside, outside], obs, "ANY").passed).toBe(true);
  });

  it("weights bias the aggregate score", () => {
    const heavyPass = engine.evaluate(
      [
        { ...inside, scoring: { weight: 9 } },
        { ...outside, scoring: { weight: 1 } },
      ],
      atCell(HUB_CELL),
      "ANY"
    );
    const heavyFail = engine.evaluate(
      [
        { ...inside, scoring: { weight: 1 } },
        { ...outside, scoring: { weight: 9 } },
      ],
      atCell(HUB_CELL),
      "ANY"
    );

    expect(heavyPass.spatialScore).toBeGreaterThan(heavyFail.spatialScore);
  });

  it("a failed critical condition zeroes the aggregate", () => {
    const summary = engine.evaluate(
      [
        { ...inside, scoring: { weight: 1 } },
        { ...outside, scoring: { weight: 1, critical: true } },
      ],
      atCell(HUB_CELL),
      "ANY"
    );

    expect(summary.passed).toBe(true); // ANY still matches
    expect(summary.spatialScore).toBe(0); // but the required condition failed
  });

  it("an empty condition list is vacuously true with no score", () => {
    const summary = engine.evaluate([], atCell(HUB_CELL));
    expect(summary.passed).toBe(true);
    expect(summary.spatialScore).toBe(0);
  });
});

// ===========================================================================
// PRECISION GATE
// ===========================================================================

describe("precision gate", () => {
  const there: SpatialCondition = {
    type: "spatial",
    mode: "topological",
    predicate: "there",
    geometry: hubGeometry(), // Res 7 ≈ 5km cells
  };
  const notThere: SpatialCondition = { ...there, predicate: "not_there" };

  it("refuses a country-centroid fix against a 5km geofence", () => {
    const coarse = engine.evaluateCondition(there, {
      ...atCell(HUB_CELL),
      spatialSource: "jurisdiction",
      spatialPrecisionM: 500_000,
    });

    expect(coarse.passed).toBe(false);
    expect(coarse.explanation).toMatch(/too coarse/i);
    expect(coarse.explanation).toMatch(/unknown at this granularity, not outside/i);
  });

  it("does NOT let a coarse fix satisfy an exclusion-zone rule", () => {
    // The dangerous case: a signal whose real position is unknown reads as
    // "outside the harbour" and fires a not_there alert. It must not.
    const coarse = engine.evaluateCondition(notThere, {
      ...atCell(FAR_CELL),
      spatialSource: "jurisdiction",
      spatialPrecisionM: 500_000,
    });

    expect(coarse.passed).toBe(false);
    expect(coarse.explanation).toMatch(/too coarse/i);

    // A precise fix in the same place SHOULD fire it — proving the gate is
    // what suppressed the coarse one, not the geometry.
    const precise = engine.evaluateCondition(notThere, {
      ...atCell(FAR_CELL),
      spatialSource: "telemetry",
      spatialPrecisionM: 10,
    });
    expect(precise.passed).toBe(true);
  });

  it("admits a gazetteer fix against a comparable zone", () => {
    // 5km accuracy vs a Res 7 zone (~5km cells, ~10km tolerance) — usable.
    const result = engine.evaluateCondition(there, {
      ...atCell(HUB_CELL),
      spatialSource: "gazetteer",
      spatialPrecisionM: 5_000,
    });
    expect(result.passed).toBe(true);
  });

  it("admits a coarse fix against a correspondingly coarse zone", () => {
    // The same 500km fix is legitimate against a continental Res 1 zone,
    // whose cells are ~418km on edge.
    const coarseZone: SpatialCondition = {
      type: "spatial",
      mode: "topological",
      predicate: "there",
      geometry: {
        regionName: "Continental",
        h3Cells: [cellToParent(HUB_CELL, 1)],
      },
    };

    const result = engine.evaluateCondition(coarseZone, {
      ...atCell(HUB_CELL),
      spatialSource: "jurisdiction",
      spatialPrecisionM: 500_000,
    });
    expect(result.passed).toBe(true);
  });

  it("is inert when no provenance is recorded", () => {
    // Signals predating the provenance columns must keep evaluating.
    const result = engine.evaluateCondition(there, atCell(HUB_CELL));
    expect(result.passed).toBe(true);
  });

  it("gates geofence triggers too, not just containment", () => {
    const trigger: SpatialCondition = {
      type: "spatial",
      mode: "geofence_trigger",
      trigger: "ON_ENTER",
      geometry: hubGeometry(),
    };

    const result = engine.evaluateCondition(trigger, {
      ...atCell(HUB_CELL, { previousH3Index: FAR_CELL }),
      spatialSource: "jurisdiction",
      spatialPrecisionM: 500_000,
    });
    expect(result.passed).toBe(false);
    expect(result.explanation).toMatch(/too coarse/i);
  });
});

// ===========================================================================
// ITERATION GATE (persistence / hysteresis)
// ===========================================================================

describe("iteration gate", () => {
  const gated = (
    persistence: SpatialCondition["persistence"],
    conditionId = "cond_gate"
  ): SpatialCondition => ({
    type: "spatial",
    mode: "topological",
    predicate: "there",
    conditionId,
    persistence,
    geometry: hubGeometry(),
  });

  it("withholds the match until N consecutive confirmations", () => {
    const cond = gated({ requiredConsecutiveHits: 3 });
    const obs = atCell(HUB_CELL, { subjectId: "vessel-1" });

    const first = engine.evaluateCondition(cond, obs);
    expect(first.passed).toBe(false);
    expect(first.persistence).toMatchObject({ hits: 1, required: 3, pending: true });
    expect(first.explanation).toMatch(/1\/3 consecutive hits/);

    expect(engine.evaluateCondition(cond, obs).passed).toBe(false); // 2/3

    const third = engine.evaluateCondition(cond, obs);
    expect(third.passed).toBe(true);
    expect(third.persistence?.latched).toBe(true);
    expect(third.explanation).toMatch(/Confirmed over 3/);
  });

  it("resets the count when the predicate flaps", () => {
    const cond = gated({ requiredConsecutiveHits: 3 }, "cond_flap");
    const inside = atCell(HUB_CELL, { subjectId: "vessel-2" });
    const outside = atCell(FAR_CELL, { subjectId: "vessel-2" });

    engine.evaluateCondition(cond, inside); // 1
    engine.evaluateCondition(cond, inside); // 2
    engine.evaluateCondition(cond, outside); // flap → reset

    const afterFlap = engine.evaluateCondition(cond, inside);
    expect(afterFlap.passed).toBe(false);
    expect(afterFlap.persistence?.hits).toBe(1);
  });

  it("holds a latched condition through a stray miss (hysteresis)", () => {
    const cond = gated({ requiredConsecutiveHits: 2, releaseAfterMisses: 3 }, "cond_hyst");
    const inside = atCell(HUB_CELL, { subjectId: "vessel-3" });
    const outside = atCell(FAR_CELL, { subjectId: "vessel-3" });

    engine.evaluateCondition(cond, inside);
    expect(engine.evaluateCondition(cond, inside).passed).toBe(true); // latched

    // One stray fix outside must NOT release it — that is the whole point.
    const stray = engine.evaluateCondition(cond, outside);
    expect(stray.passed).toBe(true);
    expect(stray.explanation).toMatch(/Held latched/);

    engine.evaluateCondition(cond, outside); // 2 misses
    expect(engine.evaluateCondition(cond, outside).passed).toBe(false); // 3 → released
  });

  it("tracks subjects independently", () => {
    const cond = gated({ requiredConsecutiveHits: 2 }, "cond_multi");

    engine.evaluateCondition(cond, atCell(HUB_CELL, { subjectId: "alpha" }));
    // Bravo's first hit must not inherit alpha's progress.
    const bravo = engine.evaluateCondition(cond, atCell(HUB_CELL, { subjectId: "bravo" }));
    expect(bravo.passed).toBe(false);
    expect(bravo.persistence?.hits).toBe(1);

    expect(engine.evaluateCondition(cond, atCell(HUB_CELL, { subjectId: "alpha" })).passed).toBe(true);
  });

  it("carries partial score while confirming when configured", () => {
    const cond = gated(
      { requiredConsecutiveHits: 4, pendingScoreFactor: 0.5 },
      "cond_partial"
    );
    const pending = engine.evaluateCondition(cond, atCell(HUB_CELL, { subjectId: "v4" }));
    expect(pending.passed).toBe(false);
    expect(pending.score).toBeGreaterThan(0); // still contributes priority
    expect(pending.score).toBeLessThan(1);
  });

  it("is a pass-through when no gate is configured", () => {
    const ungated: SpatialCondition = {
      type: "spatial",
      mode: "topological",
      predicate: "there",
      geometry: hubGeometry(),
    };
    const result = engine.evaluateCondition(ungated, atCell(HUB_CELL));
    expect(result.passed).toBe(true); // fires on the first tick, as before
    expect(result.persistence).toBeUndefined();
  });

  it("discards progress that falls outside the window", () => {
    const cond = gated({ requiredConsecutiveHits: 2, windowMs: -1 }, "cond_window");
    // A negative window makes every prior entry stale by construction, so the
    // count can never accumulate.
    engine.evaluateCondition(cond, atCell(HUB_CELL, { subjectId: "v5" }));
    const second = engine.evaluateCondition(cond, atCell(HUB_CELL, { subjectId: "v5" }));
    expect(second.persistence?.hits).toBe(1);
    expect(second.passed).toBe(false);
  });
});

// ===========================================================================
// CONTRACT NORMALISATION
// ===========================================================================

describe("operator normalisation", () => {
  it("maps display symbols onto canonical operators", () => {
    // This is the mismatch that made every Rule Builder condition a no-op.
    expect(normalizeOperator(">=")).toBe("greater_than_or_equal");
    expect(normalizeOperator("≥")).toBe("greater_than_or_equal");
    expect(normalizeOperator("==")).toBe("equals");
    expect(normalizeOperator("greater_than_or_equal")).toBe("greater_than_or_equal");
    expect(normalizeOperator("BETWEEN")).toBe("between");
  });

  it("returns null for junk so callers can fail loudly", () => {
    expect(normalizeOperator("~=")).toBeNull();
    expect(normalizeOperator(undefined)).toBeNull();
  });

  it("maps predicate synonyms", () => {
    expect(normalizeSpatialPredicate("in")).toBe("there");
    expect(normalizeSpatialPredicate("located_in")).toBe("there");
    expect(normalizeSpatialPredicate("outside")).toBe("not_there");
    expect(normalizeSpatialPredicate("not_in")).toBe("not_there");
    expect(normalizeSpatialPredicate("crosses")).toBe("intersects");
    expect(normalizeSpatialPredicate("within_radius")).toBe("k_ring");
  });

  it("parses H3 resolution from UI labels", () => {
    expect(parseH3Resolution("Res 7 (~5km)")).toBe(7);
    expect(parseH3Resolution(9)).toBe(9);
    expect(parseH3Resolution("garbage")).toBe(7);
    expect(parseH3Resolution(99)).toBe(7);
  });

  it("requiredMatchCount matches the engine's aggregation semantics", () => {
    const base = { groupId: "g", name: "g", cells: HUB_DISK }; // 7 cells
    expect(requiredMatchCount({ ...base, aggregation: "any" })).toBe(1);
    expect(requiredMatchCount({ ...base, aggregation: "all" })).toBe(7);
    expect(requiredMatchCount({ ...base, aggregation: "majority" })).toBe(4);
    expect(requiredMatchCount({ ...base, aggregation: "at_least", atLeastK: 3 })).toBe(3);
    // K is clamped to the set size.
    expect(requiredMatchCount({ ...base, aggregation: "at_least", atLeastK: 99 })).toBe(7);
  });
});
