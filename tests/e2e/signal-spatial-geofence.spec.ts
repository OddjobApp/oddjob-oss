import { test, expect } from "@playwright/test";
import { closeSignalPool, resetSignalState } from "./helpers/signal-fixtures.js";
import { COARSE_JURISDICTION, baseSignal, injectSignal } from "./helpers/signal-inject.js";
import { eventRow } from "./helpers/signal-assert.js";
import { ensureSuite, evaluateCondition, soleTrace } from "./helpers/signal-rules.js";
import {
  CORRIDOR_NS,
  H3_RES,
  ZONE_HORMUZ,
  ZONE_ROTTERDAM,
  cellFor,
  pointAtBearing,
  pointInside,
  pointOutside,
} from "./helpers/signal-geo.js";
import { cellToParent, latLngToCell } from "h3-js";

/**
 * Scenarios 9 and 10: geofence transitions over a track, topological
 * predicates, and the precision gate.
 *
 * Scenario 9 injects real signals so the telemetry resolver derives
 * `previousH3Index` and `dwellMinutes` from the subject's own history — the
 * thing that makes an ENTER edge different from "is inside". Scenario 10 uses
 * the dry-run endpoint, because what has to be asserted there is the
 * EXPLANATION, and only the dry run returns the trace.
 */

test.beforeAll(async ({ request }) => {
  await resetSignalState();
  await ensureSuite(request);
});

test.afterAll(async () => {
  await closeSignalPool();
});

const rotterdamGeometry = {
  regionName: ZONE_ROTTERDAM.name,
  h3Cells: ZONE_ROTTERDAM.cells,
  h3Resolution: H3_RES,
  centerLat: ZONE_ROTTERDAM.centerLat,
  centerLng: ZONE_ROTTERDAM.centerLng,
};

// ---------------------------------------------------------------------------
// SCENARIO 9 — geofence triggers over a subject's track
// ---------------------------------------------------------------------------

test.describe("Scenario 9 — geofence triggers over a tracked subject", () => {
  /**
   * Ticks are injected, not hand-built, so `previousH3Index` comes from the
   * resolver reading the subject's last fix. A spec that set previousH3Index
   * itself would be asserting its own arithmetic.
   */
  async function tick(
    request: Parameters<typeof injectSignal>[0],
    subjectId: string,
    position: { latitude: number; longitude: number },
    extra: Record<string, unknown> = {},
  ) {
    return injectSignal(
      request,
      baseSignal({
        eventType: "Vessel Telemetry",
        subjectId,
        ...position,
        ...extra,
      }),
    );
  }

  test("chains previousH3Index per subject, and does not bleed across subjects", async ({
    request,
  }) => {
    const far = pointAtBearing(ZONE_ROTTERDAM.centerLat, ZONE_ROTTERDAM.centerLng, 270, 40);
    const near = pointAtBearing(ZONE_ROTTERDAM.centerLat, ZONE_ROTTERDAM.centerLng, 270, 6);
    const inside = pointInside(ZONE_ROTTERDAM);

    const t1 = await tick(request, "VESSEL-ALPHA", far);
    expect(
      (await eventRow(t1.event.id))!.previous_h3_index,
      "a subject's first fix has no predecessor",
    ).toBeNull();

    // A different vessel between ALPHA's ticks must not become ALPHA's history.
    await tick(request, "VESSEL-BRAVO", pointInside(ZONE_HORMUZ));

    const t2 = await tick(request, "VESSEL-ALPHA", near);
    expect((await eventRow(t2.event.id))!.previous_h3_index).toBe(cellFor(far));

    const t3 = await tick(request, "VESSEL-ALPHA", inside);
    const row3 = await eventRow(t3.event.id);
    expect(row3!.previous_h3_index).toBe(cellFor(near));
    expect(row3!.h3_index).toBe(cellFor(inside));
  });

  test("ON_APPROACH fires inside the buffer and stops once the zone is breached", async ({
    request,
  }) => {
    const condition = {
      type: "spatial",
      mode: "geofence_trigger",
      trigger: "ON_APPROACH",
      approachBufferKm: 10,
      geometry: rotterdamGeometry,
      conditionId: "s9-approach",
    };

    const far = pointAtBearing(ZONE_ROTTERDAM.centerLat, ZONE_ROTTERDAM.centerLng, 270, 40);
    const outside = await evaluateCondition(request, "s9-approach", condition, {
      ...far,
      subjectId: "VESSEL-ALPHA",
      spatialSource: "telemetry",
      spatialPrecisionM: 10,
    });
    expect(outside.matched).toBe(false);
    expect(soleTrace(outside).explanation).toContain("outside the 10km buffer");

    const near = pointAtBearing(ZONE_ROTTERDAM.centerLat, ZONE_ROTTERDAM.centerLng, 270, 6);
    const approaching = await evaluateCondition(request, "s9-approach", condition, {
      ...near,
      subjectId: "VESSEL-ALPHA",
      spatialSource: "telemetry",
      spatialPrecisionM: 10,
    });
    expect(approaching.matched).toBe(true);
    const trace = soleTrace(approaching);
    expect(trace.unit).toBe("km");
    expect(trace.observed).toBeLessThan(10);

    // Already inside: approach is a PRE-breach warning, so it must stop.
    const breached = await evaluateCondition(request, "s9-approach", condition, {
      ...pointInside(ZONE_ROTTERDAM),
      subjectId: "VESSEL-ALPHA",
      spatialSource: "telemetry",
      spatialPrecisionM: 10,
    });
    expect(breached.matched).toBe(false);
    expect(soleTrace(breached).explanation).toContain("approach window passed");
  });

  test("ON_ENTER fires on the crossing edge, not on being inside", async ({ request }) => {
    const condition = {
      type: "spatial",
      mode: "geofence_trigger",
      trigger: "ON_ENTER",
      geometry: rotterdamGeometry,
      conditionId: "s9-enter",
    };

    const inside = pointInside(ZONE_ROTTERDAM);
    const outside = pointOutside(ZONE_ROTTERDAM);

    // Crossing in from outside.
    const entered = await evaluateCondition(request, "s9-enter", condition, {
      ...inside,
      previousH3Index: cellFor(outside),
      spatialSource: "telemetry",
      spatialPrecisionM: 10,
    });
    expect(entered.matched).toBe(true);
    expect(soleTrace(entered).explanation).toContain("crossed into");

    // Already inside at the previous tick — no edge.
    const stillInside = await evaluateCondition(request, "s9-enter", condition, {
      ...inside,
      previousH3Index: cellFor(inside),
      spatialSource: "telemetry",
      spatialPrecisionM: 10,
    });
    expect(stillInside.matched).toBe(false);
    expect(soleTrace(stillInside).explanation).toContain("already inside");

    // A first-ever fix inside counts as an entry: there is no prior cell to
    // have been outside, but the asset is demonstrably in.
    const firstFix = await evaluateCondition(request, "s9-enter", condition, {
      ...inside,
      previousH3Index: null,
      spatialSource: "telemetry",
      spatialPrecisionM: 10,
    });
    expect(firstFix.matched).toBe(true);
  });

  test("ON_EXIT needs a previous cell, and fires only on departure", async ({ request }) => {
    const condition = {
      type: "spatial",
      mode: "geofence_trigger",
      trigger: "ON_EXIT",
      geometry: rotterdamGeometry,
      conditionId: "s9-exit",
    };

    const inside = pointInside(ZONE_ROTTERDAM);
    const outside = pointOutside(ZONE_ROTTERDAM);

    const exited = await evaluateCondition(request, "s9-exit", condition, {
      ...outside,
      previousH3Index: cellFor(inside),
      spatialSource: "telemetry",
      spatialPrecisionM: 10,
    });
    expect(exited.matched).toBe(true);
    expect(soleTrace(exited).explanation).toContain("departed");

    // No prior cell: an exit cannot be ESTABLISHED, which is a different answer
    // from "did not exit" and the explanation has to say so.
    const unknown = await evaluateCondition(request, "s9-exit", condition, {
      ...outside,
      previousH3Index: null,
      spatialSource: "telemetry",
      spatialPrecisionM: 10,
    });
    expect(unknown.matched).toBe(false);
    expect(soleTrace(unknown).explanation).toContain("exit transition cannot be established");
  });

  test("ON_DWELL breaches its SLA and grades the overrun", async ({ request }) => {
    const condition = {
      type: "spatial",
      mode: "geofence_trigger",
      trigger: "ON_DWELL",
      dwellSlaMinutes: 120,
      geometry: rotterdamGeometry,
      conditionId: "s9-dwell",
    };
    const inside = { ...pointInside(ZONE_ROTTERDAM), spatialSource: "telemetry", spatialPrecisionM: 10 };

    const within = await evaluateCondition(request, "s9-dwell", condition, {
      ...inside,
      dwellMinutes: 60,
    });
    expect(within.matched).toBe(false);
    expect(soleTrace(within).explanation).toContain("within the 120min SLA");

    const marginal = await evaluateCondition(request, "s9-dwell", condition, {
      ...inside,
      dwellMinutes: 130,
    });
    const gross = await evaluateCondition(request, "s9-dwell", condition, {
      ...inside,
      dwellMinutes: 240,
    });

    expect(marginal.matched).toBe(true);
    expect(gross.matched).toBe(true);
    // The ramp runs from the SLA to double it, so a gross overrun must score
    // strictly higher than a marginal one. Equal scores would mean the ramp is
    // not being applied and severity information is being discarded.
    expect(soleTrace(gross).score).toBeGreaterThan(soleTrace(marginal).score);
    expect(soleTrace(marginal).unit).toBe("min");

    // Dwelling outside the zone is not a dwell breach however long it is.
    const elsewhere = await evaluateCondition(request, "s9-dwell", condition, {
      ...pointOutside(ZONE_ROTTERDAM),
      spatialSource: "telemetry",
      spatialPrecisionM: 10,
      dwellMinutes: 10_000,
    });
    expect(elsewhere.matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 10 — topological predicates and the precision gate
// ---------------------------------------------------------------------------

test.describe("Scenario 10 — topological predicates", () => {
  const precise = { spatialSource: "telemetry", spatialPrecisionM: 10 };

  test("there / not_there are exact complements over the same cell set", async ({ request }) => {
    const inside = { ...pointInside(ZONE_HORMUZ), ...precise };
    const outside = { ...pointOutside(ZONE_HORMUZ), ...precise };
    const geometry = {
      regionName: ZONE_HORMUZ.name,
      h3Cells: ZONE_HORMUZ.cells,
      h3Resolution: H3_RES,
      centerLat: ZONE_HORMUZ.centerLat,
      centerLng: ZONE_HORMUZ.centerLng,
    };

    const there = { type: "spatial", mode: "topological", predicate: "there", geometry, conditionId: "s10-there" };
    const notThere = { type: "spatial", mode: "topological", predicate: "not_there", geometry, conditionId: "s10-not-there" };

    expect((await evaluateCondition(request, "s10-there-in", there, inside)).matched).toBe(true);
    expect((await evaluateCondition(request, "s10-there-out", there, outside)).matched).toBe(false);
    expect((await evaluateCondition(request, "s10-nt-in", notThere, inside)).matched).toBe(false);
    expect((await evaluateCondition(request, "s10-nt-out", notThere, outside)).matched).toBe(true);
  });

  test("contains rolls a finer cell up to the zone's resolution", async ({ request }) => {
    const inside = pointInside(ZONE_ROTTERDAM);
    // A Res-9 observation of a position inside a Res-7 zone. The predicate has
    // to walk it up to its parent rather than compare across resolutions.
    const fineCell = latLngToCell(inside.latitude, inside.longitude, 9);
    expect(cellToParent(fineCell, H3_RES)).toBe(cellFor(inside));

    const result = await evaluateCondition(
      request,
      "s10-contains",
      {
        type: "spatial",
        mode: "topological",
        predicate: "contains",
        geometry: rotterdamGeometry,
        conditionId: "s10-contains",
      },
      { h3Index: fineCell, ...precise },
    );

    expect(result.matched).toBe(true);
    expect(soleTrace(result).explanation).toContain("encompasses child cell");
  });

  test("intersects crosses a corridor on the real path, and dead-reckons without one", async ({
    request,
  }) => {
    const geometry = {
      regionName: CORRIDOR_NS.name,
      h3Cells: CORRIDOR_NS.cells,
      h3Resolution: H3_RES,
    };
    const condition = {
      type: "spatial",
      mode: "topological",
      predicate: "intersects",
      geometry,
      conditionId: "s10-intersects",
    };

    // A path from one side of the corridor to the other must cross it.
    const west = pointAtBearing(CORRIDOR_NS.centerLat, CORRIDOR_NS.centerLng, 270, 25);
    const east = pointAtBearing(CORRIDOR_NS.centerLat, CORRIDOR_NS.centerLng, 90, 25);
    const crossing = await evaluateCondition(request, "s10-intersects-path", condition, {
      ...east,
      previousH3Index: cellFor(west),
      ...precise,
    });
    expect(crossing.matched).toBe(true);
    expect(soleTrace(crossing).explanation).toContain("Projected trajectory crosses");

    // No previous fix: the engine dead-reckons an hour ahead along the heading,
    // so a first-tick signal can still be tested against a corridor.
    const deadReckoned = await evaluateCondition(request, "s10-intersects-dr", condition, {
      ...west,
      previousH3Index: null,
      headingDegrees: 90,
      velocityKnots: 15,
      ...precise,
    });
    expect(soleTrace(deadReckoned).explanation).toMatch(/trajectory|Trajectory/);

    // A stationary signal far away crosses nothing.
    const stationary = await evaluateCondition(request, "s10-intersects-none", condition, {
      ...pointInside(ZONE_HORMUZ),
      previousH3Index: null,
      ...precise,
    });
    expect(stationary.matched).toBe(false);
  });

  test("k_ring accepts an explicit k and derives one from a km radius", async ({ request }) => {
    const centre = { latitude: ZONE_ROTTERDAM.centerLat, longitude: ZONE_ROTTERDAM.centerLng };
    // A k=3 ring at Res 7 reaches roughly 3 x 1.22km x 1.5 = 5.5km, so "near"
    // has to be well inside that. Res-7 cells are ~5 km² in AREA, which is not
    // a 5 km radius.
    const near = pointAtBearing(centre.latitude, centre.longitude, 45, 2);
    const far = pointAtBearing(centre.latitude, centre.longitude, 45, 120);

    const explicitK = {
      type: "spatial",
      mode: "topological",
      predicate: "k_ring",
      geometry: { regionName: "Rotterdam k-ring", centerLat: centre.latitude, centerLng: centre.longitude, h3Resolution: H3_RES, k: 3 },
      conditionId: "s10-kring",
    };

    const inRing = await evaluateCondition(request, "s10-kring-in", explicitK, { ...near, ...precise });
    expect(inRing.matched).toBe(true);
    expect(soleTrace(inRing).explanation).toContain("k=3 ring");
    expect(soleTrace(inRing).unit).toBe("km");

    const outOfRing = await evaluateCondition(request, "s10-kring-out", explicitK, { ...far, ...precise });
    expect(outOfRing.matched).toBe(false);

    // radiusKm converts to a ring count, so a generous radius must admit what a
    // small explicit k rejected.
    const byRadius = {
      ...explicitK,
      geometry: { ...explicitK.geometry, k: undefined, radiusKm: 200 },
      conditionId: "s10-kring-radius",
    };
    expect((await evaluateCondition(request, "s10-kring-radius", byRadius, { ...far, ...precise })).matched).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 10B — the precision gate
// ---------------------------------------------------------------------------

/**
 * The highest-consequence assertion in the suite.
 *
 * Ingestion places a signal at a country centroid when nothing better is
 * available — roughly 500 km of accuracy. Tested naively against a small
 * harbour geofence, such a signal reads as unambiguously OUTSIDE, which
 * silently satisfies every `not_there` exclusion rule and raises a confident
 * alert about an asset whose position is in fact unknown.
 *
 * "Unknown" and "outside" are different answers and must not collapse into one.
 */
test.describe("Scenario 10B — the precision gate refuses to guess", () => {
  test("a jurisdiction-only signal is resolved at country-centroid precision", async ({
    request,
  }) => {
    const injected = await injectSignal(
      request,
      baseSignal({
        eventType: "Sanctions",
        targetSector: "Financial",
        jurisdiction: COARSE_JURISDICTION,
        // No coordinates and no place name in the text, so the resolver has
        // nothing better than the jurisdiction to go on.
        rawText: "Sanctions announcement with no positional telemetry",
      }),
    );

    const row = await eventRow(injected.event.id);
    expect(row!.spatial_source).toBe("jurisdiction");
    expect(
      row!.spatial_precision_m,
      "a country centroid is ~500km accurate, and the row must say so",
    ).toBe(500_000);
  });

  test("that signal reads as UNKNOWN against a fine geofence, not as outside", async ({
    request,
  }) => {
    const notThere = {
      type: "spatial",
      mode: "topological",
      predicate: "not_there",
      geometry: rotterdamGeometry,
      conditionId: "s10-precision",
    };

    const result = await evaluateCondition(request, "s10-precision-coarse", notThere, {
      // A country centroid, as the resolver places a jurisdiction-only signal.
      latitude: 23.89,
      longitude: 45.08,
      spatialSource: "jurisdiction",
      spatialPrecisionM: 500_000,
    });

    expect(
      result.matched,
      "a 500km fix must NOT satisfy a not_there rule over a 19-tile harbour zone",
    ).toBe(false);

    const explanation = soleTrace(result).explanation;
    expect(explanation).toContain("too coarse");
    expect(explanation).toContain("jurisdiction");
    expect(
      explanation,
      "the operator has to be told this is unknown, not merely a failed match",
    ).toContain("Position is unknown at this granularity, not outside");
  });

  test("a precise fix on the same zone evaluates normally", async ({ request }) => {
    const notThere = {
      type: "spatial",
      mode: "topological",
      predicate: "not_there",
      geometry: rotterdamGeometry,
      conditionId: "s10-precision",
    };

    const outside = await evaluateCondition(request, "s10-precision-fine", notThere, {
      ...pointOutside(ZONE_ROTTERDAM),
      spatialSource: "telemetry",
      spatialPrecisionM: 50,
    });
    expect(outside.matched).toBe(true);
    expect(soleTrace(outside).explanation).toContain("exclusion violation");

    const inside = await evaluateCondition(request, "s10-precision-fine-in", notThere, {
      ...pointInside(ZONE_ROTTERDAM),
      spatialSource: "telemetry",
      spatialPrecisionM: 50,
    });
    expect(inside.matched).toBe(false);
  });

  /**
   * Tolerance scales with the zone's EXTENT, not one cell: a geofence painted
   * over many tiles is a large target and legitimately tolerates a coarser fix
   * than a single berth does.
   */
  test("a large zone tolerates a fix that a single-tile zone rejects", async ({ request }) => {
    const oneTile = latLngToCell(ZONE_HORMUZ.centerLat, ZONE_HORMUZ.centerLng, H3_RES);
    const sample = {
      ...pointInside(ZONE_HORMUZ),
      spatialSource: "geocoder",
      // The engine's tolerance is `edgeKm * sqrt(cellCount) * 2`. For the
      // 37-cell zone that is 1.22km * 6.08 * 2 ~= 14.8km; for a single cell it
      // is 1.22km * 1 * 2 ~= 2.4km. 10km sits between the two, which is exactly
      // the boundary this test exists to pin.
      spatialPrecisionM: 10_000,
    };

    const wide = await evaluateCondition(
      request,
      "s10-extent-wide",
      {
        type: "spatial",
        mode: "topological",
        predicate: "there",
        geometry: {
          regionName: ZONE_HORMUZ.name,
          h3Cells: ZONE_HORMUZ.cells,
          h3Resolution: H3_RES,
          centerLat: ZONE_HORMUZ.centerLat,
          centerLng: ZONE_HORMUZ.centerLng,
        },
        conditionId: "s10-extent-wide",
      },
      sample,
    );

    const narrow = await evaluateCondition(
      request,
      "s10-extent-narrow",
      {
        type: "spatial",
        mode: "topological",
        predicate: "there",
        geometry: { regionName: "Single berth", h3Cells: [oneTile], h3Resolution: H3_RES },
        conditionId: "s10-extent-narrow",
      },
      sample,
    );

    expect(wide.matched, "a 37-tile zone tolerates a 20km fix").toBe(true);
    expect(narrow.matched, "a single tile does not").toBe(false);
    expect(soleTrace(narrow).explanation).toContain("too coarse");
  });
});
