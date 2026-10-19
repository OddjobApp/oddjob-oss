import { test, expect } from "@playwright/test";
import {
  closeSignalPool,
  createIsolatedCycle,
  createSignalFixtures,
  createSubscription,
  signalPool,
  type SignalFixtures,
} from "./helpers/signal-fixtures.js";
import { baseSignal, injectSignal } from "./helpers/signal-inject.js";
import {
  deliveryFor,
  ruleOutcomesForEvent,
  waitForRuleOutcome,
  worldStateVersion,
} from "./helpers/signal-assert.js";
import {
  deleteRule,
  ensureSuite,
  evaluateCondition,
  putRule,
  soleTrace,
  E2E_SUITE_ID,
} from "./helpers/signal-rules.js";
import { H3_RES, ZONE_ROTTERDAM, pointAtBearing, pointInside } from "./helpers/signal-geo.js";

/**
 * Hardening scenarios — the four enhancements that came out of building the
 * main suite.
 *
 * Each covers a gap the original 15 scenarios did not reach, because each was
 * discovered BY writing them: two correctness holes in directions the code
 * already claimed to protect, one observability gap, and one operator that had
 * never been implemented.
 */

let fx: SignalFixtures;

test.beforeAll(async ({ request }) => {
  fx = await createSignalFixtures();
  await ensureSuite(request);
});

test.afterAll(async () => {
  await closeSignalPool();
});

// ---------------------------------------------------------------------------
// H1 — the precision gate now covers position-derived magnitudes
// ---------------------------------------------------------------------------

/**
 * The zone gate protects geofence and containment predicates. Flux functions
 * had no equivalent, so `spatial_drift` on a country-centroid fix reported
 * hundreds of kilometres of drift as a confident breach — the same "unknown
 * presented as fact" failure, in the function where the number looks most
 * authoritative.
 */
test.describe("H1 — coarse fixes cannot assert a measured displacement", () => {
  const drift = (thresholdKm: number) => ({
    type: "spatial",
    mode: "flux_analytic",
    fn: "spatial_drift",
    operator: "greater_than_or_equal",
    value: thresholdKm,
    conditionId: `h1-drift-${thresholdKm}`,
  });

  test("a jurisdiction-centroid fix cannot satisfy a drift rule", async ({ request }) => {
    const actual = pointInside(ZONE_ROTTERDAM);
    // 300km off the projected track — a large, alarming-looking drift.
    const projected = pointAtBearing(actual.latitude, actual.longitude, 90, 300);

    const coarse = await evaluateCondition(request, "h1-drift-coarse", drift(2), {
      ...actual,
      projectedLatitude: projected.latitude,
      projectedLongitude: projected.longitude,
      spatialSource: "jurisdiction",
      spatialPrecisionM: 500_000,
    });

    expect(
      coarse.matched,
      "a +/-500km fix cannot support a 2km drift assertion, however large the number",
    ).toBe(false);
    const explanation = soleTrace(coarse).explanation;
    expect(explanation).toContain("too coarse");
    expect(explanation).toContain("accuracy radius, not a measured displacement");
  });

  test("the same geometry with a real fix evaluates normally", async ({ request }) => {
    const actual = pointInside(ZONE_ROTTERDAM);
    const projected = pointAtBearing(actual.latitude, actual.longitude, 90, 300);

    const precise = await evaluateCondition(request, "h1-drift-precise", drift(2), {
      ...actual,
      projectedLatitude: projected.latitude,
      projectedLongitude: projected.longitude,
      spatialSource: "telemetry",
      spatialPrecisionM: 10,
    });

    expect(precise.matched).toBe(true);
    expect(soleTrace(precise).observed).toBeGreaterThan(200);
  });

  /**
   * The gate is threshold-relative, not a fixed cut-off: a coarse fix can still
   * support a coarse assertion. A 20km fix cannot measure 2km of drift, but it
   * can perfectly well establish that drift exceeds 1000km.
   */
  test("a coarse fix can still support a correspondingly coarse threshold", async ({ request }) => {
    const actual = pointInside(ZONE_ROTTERDAM);
    const projected = pointAtBearing(actual.latitude, actual.longitude, 90, 2000);
    const sample = {
      ...actual,
      projectedLatitude: projected.latitude,
      projectedLongitude: projected.longitude,
      spatialSource: "geocoder",
      spatialPrecisionM: 20_000,
    };

    expect((await evaluateCondition(request, "h1-fine", drift(2), sample)).matched).toBe(false);
    expect((await evaluateCondition(request, "h1-coarse-ok", drift(1000), sample)).matched).toBe(
      true,
    );
  });

  test("velocity is read from telemetry and is not gated by positional accuracy", async ({
    request,
  }) => {
    // A vessel's speed over ground does not become unknowable because its
    // position was resolved from a place name.
    const result = await evaluateCondition(
      request,
      "h1-velocity",
      {
        type: "spatial",
        mode: "flux_analytic",
        fn: "velocity_vector",
        operator: "greater_than_or_equal",
        value: 10,
        conditionId: "h1-velocity",
      },
      {
        ...pointInside(ZONE_ROTTERDAM),
        velocityKnots: 18,
        spatialSource: "jurisdiction",
        spatialPrecisionM: 500_000,
      },
    );
    expect(result.matched).toBe(true);
  });

  test("a parent-cell rollup refuses a fix coarser than the sector", async ({ request }) => {
    const condition = {
      type: "spatial",
      mode: "flux_analytic",
      fn: "h3_parent_zoom",
      operator: "less_than_or_equal",
      value: 6,
      geometry: { h3Resolution: 6 },
      conditionId: "h1-zoom",
    };

    const coarse = await evaluateCondition(request, "h1-zoom-coarse", condition, {
      ...pointInside(ZONE_ROTTERDAM),
      spatialSource: "jurisdiction",
      spatialPrecisionM: 500_000,
    });
    expect(coarse.matched).toBe(false);
    expect(soleTrace(coarse).explanation).toContain("not known to occupy");

    const precise = await evaluateCondition(request, "h1-zoom-precise", condition, {
      ...pointInside(ZONE_ROTTERDAM),
      spatialSource: "telemetry",
      spatialPrecisionM: 10,
    });
    expect(precise.matched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H2 — cooldown throttles per subject, not fleet-wide
// ---------------------------------------------------------------------------

test.describe("H2 — one asset's signal does not silence another's", () => {
  test("throttles a repeat from the same subject but admits a different one", async ({
    request,
  }) => {
    const { cycleId } = await createIsolatedCycle("H2 cooldown");
    const subscriptionId = await createSubscription(request, {
      cycleId,
      name: "H2 cooldown",
      deliveryMode: "context_only",
      filters: { eventTypes: ["H2 Cooldown Probe"] },
      cooldownMinutes: 15,
    });

    const alpha1 = await injectSignal(
      request,
      baseSignal({ eventType: "H2 Cooldown Probe", subjectId: "VESSEL-ALPHA" }),
    );
    expect(await deliveryFor(subscriptionId, alpha1.event.id)).not.toBeNull();
    expect(await worldStateVersion(cycleId)).toBe(1);

    // Same vessel inside the window — correctly throttled.
    const alpha2 = await injectSignal(
      request,
      baseSignal({ eventType: "H2 Cooldown Probe", subjectId: "VESSEL-ALPHA" }),
    );
    expect(await deliveryFor(subscriptionId, alpha2.event.id)).toBeNull();
    expect(await worldStateVersion(cycleId)).toBe(1);

    // A DIFFERENT vessel, same window. Under the old per-subscription cooldown
    // this was swallowed — a Rotterdam signal muting an unrelated Hormuz one,
    // failing silently.
    const bravo = await injectSignal(
      request,
      baseSignal({ eventType: "H2 Cooldown Probe", subjectId: "VESSEL-BRAVO" }),
    );
    expect(
      await deliveryFor(subscriptionId, bravo.event.id),
      "a second asset must not be silenced by the first",
    ).not.toBeNull();
    expect(await worldStateVersion(cycleId)).toBe(2);

    // And BRAVO is now throttled on its own account, independently of ALPHA.
    const bravo2 = await injectSignal(
      request,
      baseSignal({ eventType: "H2 Cooldown Probe", subjectId: "VESSEL-BRAVO" }),
    );
    expect(await deliveryFor(subscriptionId, bravo2.event.id)).toBeNull();
    expect(await worldStateVersion(cycleId)).toBe(2);
  });

  test("signals with no subject still share one bucket", async ({ request }) => {
    // Single-asset feeds carry no subjectId, and for them the original
    // behaviour was correct — they must keep it rather than lose throttling.
    const { cycleId } = await createIsolatedCycle("H2 global bucket");
    const subscriptionId = await createSubscription(request, {
      cycleId,
      name: "H2 global",
      deliveryMode: "context_only",
      filters: { eventTypes: ["H2 Global Probe"] },
      cooldownMinutes: 15,
    });

    const first = await injectSignal(request, baseSignal({ eventType: "H2 Global Probe" }));
    expect(await deliveryFor(subscriptionId, first.event.id)).not.toBeNull();

    const second = await injectSignal(request, baseSignal({ eventType: "H2 Global Probe" }));
    expect(await deliveryFor(subscriptionId, second.event.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// H3 — every evaluation is recorded, not only the matches
// ---------------------------------------------------------------------------

test.describe("H3 — why a rule did not fire is answerable", () => {
  const RULE_MATCH = "h3-audit-match";
  const RULE_MISS = "h3-audit-miss";

  test.beforeAll(async ({ request }) => {
    await putRule(request, {
      ruleId: RULE_MATCH,
      ruleName: "H3 expected match",
      enabled: true,
      priorityWeight: 60,
      ifBranch: {
        branchId: "h3-match-if",
        branchName: "IF",
        matchStrategy: "ALL",
        conditions: [{ field: "eventType", operator: "equals", value: "H3 Audit Probe" }],
        thenAction: { deliveryMode: "context_only" },
      },
    });
    await putRule(request, {
      ruleId: RULE_MISS,
      ruleName: "H3 expected miss",
      enabled: true,
      priorityWeight: 60,
      ifBranch: {
        branchId: "h3-miss-if",
        branchName: "IF",
        matchStrategy: "ALL",
        conditions: [
          { field: "eventType", operator: "equals", value: "H3 Audit Probe" },
          { field: "severity", operator: "greater_than_or_equal", value: "Critical" },
        ],
        thenAction: { deliveryMode: "context_only" },
      },
    });
  });

  test.afterAll(async ({ request }) => {
    await deleteRule(request, RULE_MATCH);
    await deleteRule(request, RULE_MISS);
  });

  test("a non-matching rule leaves a no_match row, not silence", async ({ request }) => {
    const injected = await injectSignal(
      request,
      baseSignal({ eventType: "H3 Audit Probe", severity: "Medium" }),
    );

    const matched = await waitForRuleOutcome(injected.event.id, RULE_MATCH);
    expect(matched.outcome).toBe("matched");

    const missed = await waitForRuleOutcome(injected.event.id, RULE_MISS);
    expect(
      missed.outcome,
      "a rule that evaluated and legitimately did not match must be distinguishable from one that never ran",
    ).toBe("no_match");
    expect(missed.failureReason).toBeNull();
  });

  test("a spatial rule records its per-condition reasoning even when it fails", async ({
    request,
  }) => {
    const RULE_SPATIAL = "h3-audit-spatial";
    await putRule(request, {
      ruleId: RULE_SPATIAL,
      ruleName: "H3 spatial reasoning",
      enabled: true,
      ifBranch: {
        branchId: "h3-spatial-if",
        branchName: "IF",
        matchStrategy: "ALL",
        conditions: [
          { field: "eventType", operator: "equals", value: "H3 Spatial Audit Probe" },
          {
            type: "spatial",
            mode: "topological",
            predicate: "there",
            geometry: {
              regionName: ZONE_ROTTERDAM.name,
              h3Cells: ZONE_ROTTERDAM.cells,
              h3Resolution: H3_RES,
            },
            conditionId: "h3-audit-there",
          },
        ],
        thenAction: { deliveryMode: "context_only" },
      },
    });

    // Positioned far outside the zone, so the spatial condition fails.
    const away = pointAtBearing(ZONE_ROTTERDAM.centerLat, ZONE_ROTTERDAM.centerLng, 90, 400);
    const injected = await injectSignal(
      request,
      baseSignal({ eventType: "H3 Spatial Audit Probe", ...away }),
    );

    const row = await waitForRuleOutcome(injected.event.id, RULE_SPATIAL);
    expect(row.outcome).toBe("no_match");
    expect(
      row.spatialTrace,
      "the explanation that answers 'why not' must be persisted for live signals, not only dry runs",
    ).toBeTruthy();
    expect(JSON.stringify(row.spatialTrace)).toContain("not within");

    await deleteRule(request, RULE_SPATIAL);
  });

  test("the audits endpoint can filter to failures", async ({ request }) => {
    const res = await request.get(`/api/rule-suites/${E2E_SUITE_ID}/audits?outcome=no_match`);
    expect(res.ok()).toBeTruthy();
    const rows = (await res.json()) as Array<Record<string, any>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.outcome === "no_match")).toBe(true);

    const bad = await request.get(`/api/rule-suites/${E2E_SUITE_ID}/audits?outcome=banana`);
    expect(bad.status()).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// H4 — FREQUENCY_SPIKE actually counts
// ---------------------------------------------------------------------------

test.describe("H4 — FREQUENCY_SPIKE counts signals in a window", () => {
  const spike = (minCount: number) => ({
    type: "temporal_velocity",
    temporalOperator: "FREQUENCY_SPIKE",
    frequencyWindowMinutes: 60,
    minFrequencyCount: minCount,
  });

  /**
   * Driven live, not through the dry run: the operator counts rows in
   * `event_primitives`, and a dry-run sample is never persisted, so it would
   * always see whatever the database already held rather than a burst under
   * test.
   */
  async function outcomeFor(
    request: any,
    ruleId: string,
    minCount: number,
    eventType: string,
    subjectId: string,
  ) {
    await putRule(request, {
      ruleId,
      ruleName: ruleId,
      enabled: true,
      ifBranch: {
        branchId: `${ruleId}-if`,
        branchName: "IF",
        matchStrategy: "ALL",
        conditions: [
          { field: "eventType", operator: "equals", value: eventType },
          spike(minCount),
        ],
        thenAction: { deliveryMode: "context_only" },
      },
    });
    const injected = await injectSignal(request, baseSignal({ eventType, subjectId }));
    const row = await waitForRuleOutcome(injected.event.id, ruleId);
    await deleteRule(request, ruleId);
    return row.outcome;
  }

  test("a lone signal does not clear a threshold of three", async ({ request }) => {
    expect(
      await outcomeFor(request, "h4-lonely", 3, "H4 Lonely Probe", "VESSEL-QUIET"),
      "one signal in the window must not satisfy minFrequencyCount 3 — this operator " +
        "returned true unconditionally before, so any assertion here used to pass",
    ).toBe("no_match");
  });

  test("a burst from the same subject does clear it", async ({ request }) => {
    // Two prior signals plus the one the rule evaluates against makes three.
    for (let i = 0; i < 2; i++) {
      await injectSignal(
        request,
        baseSignal({ eventType: "H4 Burst Probe", subjectId: "VESSEL-BUSY" }),
      );
    }
    expect(await outcomeFor(request, "h4-burst", 3, "H4 Burst Probe", "VESSEL-BUSY")).toBe(
      "matched",
    );
  });

  test("a burst from a different subject does not count toward this one", async ({ request }) => {
    // A spike is about the tracked entity. Traffic from other vessels of the
    // same event type must not manufacture one.
    for (let i = 0; i < 5; i++) {
      await injectSignal(
        request,
        baseSignal({ eventType: "H4 Cross Probe", subjectId: "VESSEL-NOISY" }),
      );
    }
    expect(
      await outcomeFor(request, "h4-cross", 3, "H4 Cross Probe", "VESSEL-CALM"),
      "another vessel's burst must not satisfy this vessel's spike condition",
    ).toBe("no_match");
  });
});

// ---------------------------------------------------------------------------
// H5 — deterministic subscription ordering
// ---------------------------------------------------------------------------

test.describe("H5 — competing subscriptions resolve in a defined order", () => {
  test("the lower-id gate is the one that pauses", async ({ request }) => {
    const { cycleId } = await createIsolatedCycle("H5 ordering");

    const first = await createSubscription(request, {
      cycleId,
      name: "H5 gate A",
      deliveryMode: "gate",
      filters: { eventTypes: ["H5 Order Probe"] },
    });
    const second = await createSubscription(request, {
      cycleId,
      name: "H5 gate B",
      deliveryMode: "gate",
      filters: { eventTypes: ["H5 Order Probe"] },
    });
    expect(second).toBeGreaterThan(first);

    const injected = await injectSignal(request, baseSignal({ eventType: "H5 Order Probe" }));

    // Both deliver; only one can pause an active cycle. Which one used to be
    // down to the query planner.
    const a = await deliveryFor(first, injected.event.id);
    const b = await deliveryFor(second, injected.event.id);
    expect(a!.payload.appliedEffect).toBe("gated:paused");
    expect(b!.payload.appliedEffect).toBe("noop:cycle_paused");
  });
});
