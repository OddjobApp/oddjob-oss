import { test, expect } from "@playwright/test";
import {
  closeSignalPool,
  createIsolatedCycle,
  createSignalFixtures,
  createSubscription,
  type SignalFixtures,
} from "./helpers/signal-fixtures.js";
import { baseSignal, injectSignal } from "./helpers/signal-inject.js";
import {
  auditsForEvent,
  conditionState,
  waitForAudits,
  waitForConditionState,
  waitForRuleOutcome,
} from "./helpers/signal-assert.js";
import {
  deleteRule,
  dryRun,
  ensureSuite,
  evaluateCondition,
  putRule,
  soleTrace,
} from "./helpers/signal-rules.js";
import { H3_RES, ZONE_ROTTERDAM, pointAtBearing, pointInside } from "./helpers/signal-geo.js";
import { gridDisk, latLngToCell } from "h3-js";

/**
 * Scenarios 8, 12, 13 and 14: the rule criteria themselves.
 *
 * Most of the matrix runs through the dry-run endpoint, which returns the full
 * per-condition trace. Two families cannot be verified that way and are driven
 * live instead:
 *
 *  - Semantic graph. The dry-run route passes `links = []` unconditionally, so
 *    every graph operator degenerates. They need a real signal whose causal
 *    mapping produced real links.
 *  - The persistence gate. Dry runs deliberately execute inside
 *    `withIsolatedPersistence`, so counters never accumulate across them — that
 *    isolation is itself a feature under test here.
 */

let fx: SignalFixtures;

test.beforeAll(async ({ request }) => {
  fx = await createSignalFixtures();
  await ensureSuite(request);
});

test.afterAll(async () => {
  await closeSignalPool();
});

const sample = (overrides: Record<string, unknown> = {}) => ({
  eventType: "Port Congestion",
  targetSector: "Logistics",
  jurisdiction: "NL",
  severity: "High",
  confidenceScore: 0.9,
  ...overrides,
});

// ---------------------------------------------------------------------------
// SCENARIO 8 — crisp operators
// ---------------------------------------------------------------------------

test.describe("Scenario 8 — crisp criteria, including ordinal severity", () => {
  const crisp = (field: string, operator: string, value: unknown) => ({ field, operator, value });

  /**
   * The highest-consequence crisp case.
   *
   * `severity` holds ordered words, not numbers. Compared with `Number()` a
   * severity test becomes `NaN >= NaN` — permanently false — and the Rule
   * Builder offers severity alongside `>=`, so this is reachable straight from
   * the UI and fails silently.
   */
  test("severity compares by rank, not by Number()", async ({ request }) => {
    const above = await evaluateCondition(
      request,
      "s8-sev-critical",
      crisp("severity", "greater_than_or_equal", "High"),
      sample({ severity: "Critical" }),
    );
    expect(above.matched, "Critical outranks High").toBe(true);

    const equal = await evaluateCondition(
      request,
      "s8-sev-high",
      crisp("severity", "greater_than_or_equal", "High"),
      sample({ severity: "High" }),
    );
    expect(equal.matched).toBe(true);

    const below = await evaluateCondition(
      request,
      "s8-sev-medium",
      crisp("severity", "greater_than_or_equal", "High"),
      sample({ severity: "Medium" }),
    );
    expect(below.matched, "Medium is below High").toBe(false);

    // Feeds emit inconsistent casing; the rank lookup is case-insensitive.
    const lowercase = await evaluateCondition(
      request,
      "s8-sev-lower",
      crisp("severity", "greater_than_or_equal", "high"),
      sample({ severity: "CRITICAL" }),
    );
    expect(lowercase.matched).toBe(true);
  });

  /**
   * The Rule Builder emits display symbols. A UI-authored ">=" previously fell
   * through to `default: return false`, so the rule could never match and
   * nothing said why.
   */
  test("display symbols and canonical operator names behave identically", async ({ request }) => {
    const bySymbol = await evaluateCondition(
      request,
      "s8-symbol",
      crisp("confidenceScore", ">=", 0.8),
      sample({ confidenceScore: 0.9 }),
    );
    const byName = await evaluateCondition(
      request,
      "s8-name",
      crisp("confidenceScore", "greater_than_or_equal", 0.8),
      sample({ confidenceScore: 0.9 }),
    );
    expect(bySymbol.matched).toBe(true);
    expect(bySymbol.matched).toBe(byName.matched);

    const belowSymbol = await evaluateCondition(
      request,
      "s8-symbol-below",
      crisp("confidenceScore", ">=", 0.8),
      sample({ confidenceScore: 0.5 }),
    );
    expect(belowSymbol.matched).toBe(false);
  });

  test("numeric comparison operators bound correctly", async ({ request }) => {
    const cases: Array<[string, unknown, number, boolean]> = [
      ["greater_than", 0.8, 0.9, true],
      ["greater_than", 0.9, 0.9, false],
      ["less_than", 0.8, 0.5, true],
      ["less_than_or_equal", 0.5, 0.5, true],
      ["equals", 0.5, 0.5, true],
      ["not_equals", 0.5, 0.5, false],
    ];

    for (const [operator, threshold, actual, expected] of cases) {
      const result = await evaluateCondition(
        request,
        `s8-num-${operator}-${actual}-${threshold}`,
        crisp("confidenceScore", operator, threshold),
        sample({ confidenceScore: actual }),
      );
      expect(result.matched, `${actual} ${operator} ${threshold}`).toBe(expected);
    }
  });

  test("between accepts its bounds in either order", async ({ request }) => {
    const inRange = await evaluateCondition(
      request,
      "s8-between",
      crisp("confidenceScore", "between", [0.5, 0.95]),
      sample({ confidenceScore: 0.9 }),
    );
    expect(inRange.matched).toBe(true);

    // Written high-first, as an operator reasonably might. Silently failing
    // here would make a correct-looking rule inert.
    const reversed = await evaluateCondition(
      request,
      "s8-between-reversed",
      crisp("confidenceScore", "between", [0.95, 0.5]),
      sample({ confidenceScore: 0.9 }),
    );
    expect(reversed.matched).toBe(true);

    const outside = await evaluateCondition(
      request,
      "s8-between-out",
      crisp("confidenceScore", "between", [0.5, 0.8]),
      sample({ confidenceScore: 0.9 }),
    );
    expect(outside.matched).toBe(false);
  });

  test("set and substring operators work on string fields", async ({ request }) => {
    const inSet = await evaluateCondition(
      request,
      "s8-in",
      crisp("targetSector", "in", ["Logistics", "Energy"]),
      sample(),
    );
    expect(inSet.matched).toBe(true);

    const notInSet = await evaluateCondition(
      request,
      "s8-not-in",
      crisp("targetSector", "not_in", ["Logistics", "Energy"]),
      sample(),
    );
    expect(notInSet.matched).toBe(false);

    const contains = await evaluateCondition(
      request,
      "s8-contains",
      crisp("eventType", "contains", "Congestion"),
      sample(),
    );
    expect(contains.matched).toBe(true);
  });

  test("an unrecognised operator cannot match", async ({ request }) => {
    const result = await evaluateCondition(
      request,
      "s8-bogus",
      crisp("confidenceScore", "approximately", 0.9),
      sample({ confidenceScore: 0.9 }),
    );
    expect(
      result.matched,
      "an operator the engine cannot interpret must fail closed, not open",
    ).toBe(false);
  });

  /**
   * Everything above is a dry run. This is the one that proves an authored rule
   * reaches the live engine and leaves a record.
   */
  test("a live signal fires a matching rule and writes an audit", async ({ request }) => {
    await putRule(request, {
      ruleId: "s8-live",
      ruleName: "S8 live crisp rule",
      enabled: true,
      priorityWeight: 50,
      ifBranch: {
        branchId: "s8-live-if",
        branchName: "IF",
        matchStrategy: "ALL",
        conditions: [
          { field: "eventType", operator: "equals", value: "S8 Live Probe" },
          { field: "severity", operator: ">=", value: "High" },
        ],
        thenAction: { deliveryMode: "context_only" },
      },
    });

    const matching = await injectSignal(
      request,
      baseSignal({ eventType: "S8 Live Probe", severity: "Critical" }),
    );
    // Waited for by rule id, not by count: other rules in the suite also
    // evaluate against this signal, so "at least one audit exists" can be
    // satisfied by a different rule before this one has been written.
    const audits = await waitForAudits(matching.event.id, 1, 20_000, (rows) =>
      rows.some((r) => r.rule_id === "s8-live"),
    );
    const audit = audits.find((a) => a.rule_id === "s8-live");
    expect(audit, "the authored rule must appear in the execution audit").toBeDefined();
    expect(audit!.matched_branch).toBe("s8-live-if");
    expect(audit!.disposition).toBe("context_only");
    expect(audit!.master_priority_score).toBeGreaterThan(0);

    // A signal failing the severity half is recorded as a no_match — the rule
    // ran and rejected it. Asserting an ABSENCE here would no longer separate
    // "evaluated and rejected" from "never evaluated", which is the distinction
    // the outcome column exists to make.
    const nonMatching = await injectSignal(
      request,
      baseSignal({ eventType: "S8 Live Probe", severity: "Low" }),
    );
    const rejected = await waitForRuleOutcome(nonMatching.event.id, "s8-live");
    expect(rejected.outcome).toBe("no_match");
    expect(rejected.failureReason).toBeNull();

    await deleteRule(request, "s8-live");
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 12 — flux analytics, cell groups, scoring
// ---------------------------------------------------------------------------

test.describe("Scenario 12 — flux analytics and grouped tile aggregation", () => {
  const precise = { spatialSource: "telemetry", spatialPrecisionM: 10 };
  const centre = pointInside(ZONE_ROTTERDAM);

  test("spatial_drift measures divergence from the approved trajectory and grades it", async ({
    request,
  }) => {
    const condition = {
      type: "spatial",
      mode: "flux_analytic",
      fn: "spatial_drift",
      operator: "greater_than_or_equal",
      value: 2,
      conditionId: "s12-drift",
    };

    const onCourse = pointAtBearing(centre.latitude, centre.longitude, 0, 0.5);
    const within = await evaluateCondition(request, "s12-drift-ok", condition, {
      ...centre,
      projectedLatitude: onCourse.latitude,
      projectedLongitude: onCourse.longitude,
      ...precise,
    });
    expect(within.matched).toBe(false);

    const drifted3 = pointAtBearing(centre.latitude, centre.longitude, 0, 3);
    const marginal = await evaluateCondition(request, "s12-drift-3", condition, {
      ...centre,
      projectedLatitude: drifted3.latitude,
      projectedLongitude: drifted3.longitude,
      ...precise,
    });

    const drifted8 = pointAtBearing(centre.latitude, centre.longitude, 0, 8);
    const gross = await evaluateCondition(request, "s12-drift-8", condition, {
      ...centre,
      projectedLatitude: drifted8.latitude,
      projectedLongitude: drifted8.longitude,
      ...precise,
    });

    expect(marginal.matched).toBe(true);
    expect(gross.matched).toBe(true);
    expect(soleTrace(marginal).unit).toBe("km");
    expect(soleTrace(marginal).observed).toBeCloseTo(3, 0);
    // The derived ramp runs from the threshold to twice it, so an 8km drift
    // must outrank a 3km one. Equal scores would mean magnitude is discarded.
    expect(soleTrace(gross).score).toBeGreaterThan(soleTrace(marginal).score);
  });

  test("scalar flux functions compare against their thresholds", async ({ request }) => {
    const phi = {
      type: "spatial",
      mode: "flux_analytic",
      fn: "isotropic_flux_density",
      operator: "greater_than_or_equal",
      value: 0.7,
      conditionId: "s12-phi",
    };
    expect(
      (await evaluateCondition(request, "s12-phi-hi", phi, { ...centre, fluxDensityPhi: 0.85, ...precise }))
        .matched,
    ).toBe(true);
    expect(
      (await evaluateCondition(request, "s12-phi-lo", phi, { ...centre, fluxDensityPhi: 0.3, ...precise }))
        .matched,
    ).toBe(false);

    // A stopped vessel in a shipping lane: "less than" is the interesting side.
    const velocity = {
      type: "spatial",
      mode: "flux_analytic",
      fn: "velocity_vector",
      operator: "less_than_or_equal",
      value: 3,
      conditionId: "s12-velocity",
    };
    expect(
      (await evaluateCondition(request, "s12-vel-slow", velocity, { ...centre, velocityKnots: 1.2, ...precise }))
        .matched,
    ).toBe(true);
    expect(
      (await evaluateCondition(request, "s12-vel-fast", velocity, { ...centre, velocityKnots: 18, ...precise }))
        .matched,
    ).toBe(false);

    // Telemetry the function needs is absent: the condition must fail with an
    // explanation, not throw and not silently pass.
    const missing = await evaluateCondition(request, "s12-vel-missing", velocity, {
      ...centre,
      ...precise,
    });
    expect(missing.matched).toBe(false);
    expect(soleTrace(missing).explanation).toContain("lacks the telemetry");
  });

  test("centroid_distance ranges over a zone centre", async ({ request }) => {
    const condition = {
      type: "spatial",
      mode: "flux_analytic",
      fn: "centroid_distance",
      operator: "between",
      value: [10, 50],
      geometry: {
        regionName: ZONE_ROTTERDAM.name,
        centerLat: ZONE_ROTTERDAM.centerLat,
        centerLng: ZONE_ROTTERDAM.centerLng,
        h3Resolution: H3_RES,
        k: 2,
      },
      conditionId: "s12-centroid",
    };

    const inBand = pointAtBearing(centre.latitude, centre.longitude, 90, 25);
    expect((await evaluateCondition(request, "s12-cd-in", condition, { ...inBand, ...precise })).matched).toBe(
      true,
    );

    const tooClose = pointAtBearing(centre.latitude, centre.longitude, 90, 2);
    expect((await evaluateCondition(request, "s12-cd-near", condition, { ...tooClose, ...precise })).matched).toBe(
      false,
    );

    const tooFar = pointAtBearing(centre.latitude, centre.longitude, 90, 300);
    expect((await evaluateCondition(request, "s12-cd-far", condition, { ...tooFar, ...precise })).matched).toBe(
      false,
    );
  });

  test("h3_parent_zoom asserts the strategic sector a signal rolls up into", async ({ request }) => {
    const condition = {
      type: "spatial",
      mode: "flux_analytic",
      fn: "h3_parent_zoom",
      operator: "less_than_or_equal",
      value: 6,
      geometry: { h3Resolution: 6 },
      conditionId: "s12-zoom",
    };

    const result = await evaluateCondition(request, "s12-zoom", condition, { ...centre, ...precise });
    expect(result.matched).toBe(true);
    expect(soleTrace(result).observed).toBe(6);
    expect(soleTrace(result).unit).toBe("res");
  });

  /**
   * NAMING: this measures the H3 grid, not the signal.
   *
   * `equidistant_neighbors` returns `gridDisk(cell, 1).length - 1` — 6 for a
   * hexagon, 5 at one of the 12 pentagons per resolution. That is a constant
   * property of the tiling at a given position, not an observation about
   * traffic, risk or anything else the signal carries. Two completely different
   * signals in the same cell always score identically, and the value can only
   * ever be 5 or 6.
   *
   * It is worth keeping as a pentagon detector — pentagon cells distort
   * distance and area calculations and are genuinely worth branching on — but a
   * rule written expecting it to say something about the signal will be
   * disappointed.
   */
  test("equidistant_neighbors reports grid topology (5 at a pentagon, 6 elsewhere)", async ({
    request,
  }) => {
    const condition = {
      type: "spatial",
      mode: "flux_analytic",
      fn: "equidistant_neighbors",
      operator: "equals",
      value: 6,
      conditionId: "s12-neighbors",
    };

    const hexagon = await evaluateCondition(request, "s12-neigh-hex", condition, {
      ...centre,
      ...precise,
    });
    expect(hexagon.matched).toBe(true);
    expect(soleTrace(hexagon).observed).toBe(6);

    // A known Res-7 pentagon cell, addressed directly by index.
    const pentagonCell = "870800000ffffff";
    const pentagon = await evaluateCondition(request, "s12-neigh-pent", condition, {
      h3Index: pentagonCell,
      ...precise,
    });
    expect(soleTrace(pentagon).observed).toBe(5);
    expect(pentagon.matched, "a pentagon has 5 neighbours, so `equals 6` must fail").toBe(false);
  });

  test("cell groups aggregate per tile and grade the match ratio", async ({ request }) => {
    const cells = gridDisk(latLngToCell(centre.latitude, centre.longitude, H3_RES), 1); // 7 tiles
    expect(cells).toHaveLength(7);

    /** Marks the first `n` tiles as breaching Φ, the rest as quiet. */
    const metricsFor = (n: number) =>
      Object.fromEntries(cells.map((c, i) => [c, { fluxDensityPhi: i < n ? 0.9 : 0.1 }]));

    const groupCondition = (aggregation: string, atLeastK?: number) => ({
      type: "spatial",
      mode: "flux_analytic",
      fn: "isotropic_flux_density",
      operator: "greater_than_or_equal",
      value: 0.7,
      geometry: {
        regionName: "Rotterdam tiles",
        cellGroups: [
          {
            groupId: "grp_rotterdam",
            name: "Rotterdam tiles",
            cells,
            resolution: H3_RES,
            aggregation,
            ...(atLeastK ? { atLeastK } : {}),
          },
        ],
      },
      conditionId: `s12-group-${aggregation}-${atLeastK ?? 0}`,
    });

    // "any": a single breaching tile is enough.
    const any1 = await evaluateCondition(request, "s12-grp-any", groupCondition("any"), {
      ...centre,
      cellMetrics: metricsFor(1),
      ...precise,
    });
    expect(any1.matched).toBe(true);

    // "at_least" with k=3: two tiles is not enough, three is. The enum value is
    // `at_least`, not `at_least_k` — the k lives in `atLeastK`.
    const k3 = groupCondition("at_least", 3);
    const twoTiles = await evaluateCondition(request, "s12-grp-k3-2", k3, {
      ...centre,
      cellMetrics: metricsFor(2),
      ...precise,
    });
    const threeTiles = await evaluateCondition(request, "s12-grp-k3-3", k3, {
      ...centre,
      cellMetrics: metricsFor(3),
      ...precise,
    });
    expect(twoTiles.matched).toBe(false);
    expect(threeTiles.matched).toBe(true);
    expect(soleTrace(threeTiles).groups?.[0].matchedCells).toHaveLength(3);

    // "all": every tile must breach.
    const all = groupCondition("all");
    expect(
      (await evaluateCondition(request, "s12-grp-all-6", all, { ...centre, cellMetrics: metricsFor(6), ...precise }))
        .matched,
    ).toBe(false);
    expect(
      (await evaluateCondition(request, "s12-grp-all-7", all, { ...centre, cellMetrics: metricsFor(7), ...precise }))
        .matched,
    ).toBe(true);

    // Grouping carries magnitude, not just a boolean: 4 of 7 breaching must
    // score above 1 of 7, or the aggregation is discarding severity.
    const few = await evaluateCondition(request, "s12-grp-ratio-1", groupCondition("any"), {
      ...centre,
      cellMetrics: metricsFor(1),
      ...precise,
    });
    const many = await evaluateCondition(request, "s12-grp-ratio-4", groupCondition("any"), {
      ...centre,
      cellMetrics: metricsFor(4),
      ...precise,
    });
    expect(soleTrace(many).score).toBeGreaterThan(soleTrace(few).score);
    expect(soleTrace(many).groups?.[0].matchRatio).toBeCloseTo(4 / 7, 2);
  });

  test("a failing critical condition zeroes the aggregate score", async ({ request }) => {
    const passing = (id: string) => ({
      type: "spatial",
      mode: "topological",
      predicate: "there",
      geometry: {
        regionName: ZONE_ROTTERDAM.name,
        h3Cells: ZONE_ROTTERDAM.cells,
        h3Resolution: H3_RES,
      },
      conditionId: id,
    });

    const failingCritical = {
      type: "spatial",
      mode: "flux_analytic",
      fn: "velocity_vector",
      operator: "greater_than_or_equal",
      value: 100,
      scoring: { critical: true },
      conditionId: "s12-critical",
    };

    await putRule(request, {
      ruleId: "s12-critical-rule",
      ruleName: "S12 critical",
      enabled: true,
      ifBranch: {
        branchId: "s12-critical-if",
        branchName: "IF",
        // ANY, so the branch can still pass on the three healthy conditions —
        // isolating the effect on the SCORE from the effect on the verdict.
        matchStrategy: "ANY",
        conditions: [passing("s12-c1"), passing("s12-c2"), passing("s12-c3"), failingCritical],
        thenAction: { deliveryMode: "context_only" },
      },
    });

    const result = await dryRun(request, "s12-critical-rule", {
      ...sample(),
      ...centre,
      velocityKnots: 2,
      ...precise,
    });

    expect(result.matched, "three passing conditions under ANY still match").toBe(true);
    expect(
      result.spatialScore,
      "a failed critical condition must not be dilutable by a crowd of passing ones",
    ).toBe(0);

    await deleteRule(request, "s12-critical-rule");
  });

  /**
   * The spatial term has to actually reach the Master Priority Score.
   *
   * MAUF takes its surprise term from `fuzzyScores["spatial_score"]`, falling
   * back to a constant 0.15. If the fallback were always taken, every
   * Rule-Builder-authored spatial rule would price identically — so two rules
   * differing only in spatial outcome must produce different scores.
   *
   * SCOPE: this asserts the term is WIRED, not that the weighting is right. The
   * MAUF coefficients (0.35 severity, 0.20 sentiment, 0.20 blast radius, 0.15
   * surprise, 0.10 credibility) are a hand-chosen prior with no calibration
   * behind them — there is no dataset of operator-ranked signals anywhere in the
   * repository, and nothing that would fail if they were reordered. Treat
   * `masterPriorityScore` as a reproducible ranking heuristic, not a measured
   * utility. Validating the weights needs labelled outcomes, which is a
   * different piece of work from this suite.
   */
  test("the spatial score moves the Master Priority Score (wiring, not calibration)", async ({
    request,
  }) => {
    const geometry = {
      regionName: ZONE_ROTTERDAM.name,
      h3Cells: ZONE_ROTTERDAM.cells,
      h3Resolution: H3_RES,
    };
    const inZone = {
      type: "spatial",
      mode: "topological",
      predicate: "there",
      geometry,
      conditionId: "s12-mauf",
    };

    await putRule(request, {
      ruleId: "s12-mauf-rule",
      ruleName: "S12 MAUF",
      enabled: true,
      ifBranch: {
        branchId: "s12-mauf-if",
        branchName: "IF",
        matchStrategy: "ANY",
        conditions: [inZone],
        thenAction: { deliveryMode: "context_only" },
      },
    });

    const high = await dryRun(request, "s12-mauf-rule", { ...sample(), ...centre, ...precise });
    const low = await dryRun(request, "s12-mauf-rule", {
      ...sample(),
      ...pointAtBearing(centre.latitude, centre.longitude, 90, 300),
      ...precise,
    });

    expect(high.spatialScore).toBeGreaterThan(low.spatialScore ?? 0);
    expect(
      high.masterPriorityScore,
      "identical severity and confidence, different spatial outcome — the score must differ",
    ).toBeGreaterThan(low.masterPriorityScore);

    await deleteRule(request, "s12-mauf-rule");
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 13 — the persistence (hysteresis) gate
// ---------------------------------------------------------------------------

/**
 * Confirmation counters only accumulate on the LIVE path. Dry runs execute
 * inside `withIsolatedPersistence`, which is what stops an operator pressing
 * "test" in the Rule Builder from advancing or resetting real gate state for a
 * tracked vessel — asserted at the end of this block.
 */
test.describe("Scenario 13 — the iteration gate confirms before it fires", () => {
  const CONDITION_ID = "s13-gate";
  const SUBJECT = "VESSEL-GATE";
  const OTHER_SUBJECT = "VESSEL-OTHER";

  test.beforeAll(async ({ request }) => {
    await putRule(request, {
      ruleId: "s13-gate-rule",
      ruleName: "S13 persistence gate",
      enabled: true,
      ifBranch: {
        branchId: "s13-if",
        branchName: "IF",
        matchStrategy: "ALL",
        conditions: [
          { field: "eventType", operator: "equals", value: "S13 Gate Probe" },
          {
            type: "spatial",
            mode: "topological",
            predicate: "there",
            geometry: {
              regionName: ZONE_ROTTERDAM.name,
              h3Cells: ZONE_ROTTERDAM.cells,
              h3Resolution: H3_RES,
            },
            conditionId: CONDITION_ID,
            persistence: { requiredConsecutiveHits: 3, releaseAfterMisses: 2, pendingScoreFactor: 0.5 },
          },
        ],
        thenAction: { deliveryMode: "context_only" },
      },
    });
  });

  test.afterAll(async ({ request }) => {
    await deleteRule(request, "s13-gate-rule");
  });

  async function gateTick(
    request: Parameters<typeof injectSignal>[0],
    subjectId: string,
    position: { latitude: number; longitude: number },
  ) {
    return injectSignal(
      request,
      baseSignal({ eventType: "S13 Gate Probe", subjectId, ...position }),
    );
  }

  test("requires three consecutive hits before it latches", async ({ request }) => {
    const inside = pointInside(ZONE_ROTTERDAM);

    await gateTick(request, SUBJECT, inside);
    const after1 = await waitForConditionState(
      CONDITION_ID,
      SUBJECT,
      (s) => s?.hits === 1,
      "the first hit to be recorded",
    );
    expect(after1!.latched, "one hit is not a confirmation").toBe(false);

    await gateTick(request, SUBJECT, inside);
    const after2 = await waitForConditionState(CONDITION_ID, SUBJECT, (s) => s?.hits === 2, "two hits");
    expect(after2!.latched).toBe(false);

    await gateTick(request, SUBJECT, inside);
    const after3 = await waitForConditionState(
      CONDITION_ID,
      SUBJECT,
      (s) => s?.latched === true,
      "the gate to latch on the third consecutive hit",
    );
    expect(after3!.hits).toBe(3);
    expect(after3!.latched).toBe(true);
  });

  test("keeps counters per subject, so one vessel cannot confirm another", async ({ request }) => {
    const inside = pointInside(ZONE_ROTTERDAM);
    await gateTick(request, OTHER_SUBJECT, inside);

    const other = await waitForConditionState(
      CONDITION_ID,
      OTHER_SUBJECT,
      (s) => s?.hits === 1,
      "the second subject's own first hit",
    );
    expect(other!.latched, "a fresh subject starts unconfirmed regardless of its peers").toBe(false);

    // The already-latched subject is untouched by the other vessel's traffic.
    const original = await conditionState(CONDITION_ID, SUBJECT);
    expect(original!.latched).toBe(true);
    expect(original!.hits).toBe(3);
  });

  test("holds the latch through one miss and releases on the second", async ({ request }) => {
    const outside = pointAtBearing(ZONE_ROTTERDAM.centerLat, ZONE_ROTTERDAM.centerLng, 90, 300);

    await gateTick(request, SUBJECT, outside);
    const oneMiss = await waitForConditionState(
      CONDITION_ID,
      SUBJECT,
      (s) => s?.misses === 1,
      "one miss against the latch",
    );
    expect(oneMiss!.latched, "a single miss must not release a confirmed condition").toBe(true);

    await gateTick(request, SUBJECT, outside);
    const released = await waitForConditionState(
      CONDITION_ID,
      SUBJECT,
      (s) => s?.misses === 2,
      "the second miss to release the latch",
    );
    expect(released!.latched).toBe(false);
  });

  /**
   * Pressing "test" in the Rule Builder must not touch production gate state.
   * Without `withIsolatedPersistence` a dry run would hydrate the real counter,
   * advance it and flush it back — silently confirming, or resetting, a real
   * vessel's progress.
   */
  test("a dry run does not move the live counter", async ({ request }) => {
    const inside = pointInside(ZONE_ROTTERDAM);
    await gateTick(request, SUBJECT, inside);
    const before = await waitForConditionState(
      CONDITION_ID,
      SUBJECT,
      (s) => s?.hits === 1,
      "a known live counter value to test isolation against",
    );

    for (let i = 0; i < 5; i++) {
      await dryRun(request, "s13-gate-rule", {
        ...sample({ eventType: "S13 Gate Probe" }),
        ...inside,
        subjectId: SUBJECT,
        spatialSource: "telemetry",
        spatialPrecisionM: 10,
      });
    }

    const after = await conditionState(CONDITION_ID, SUBJECT);
    expect(after!.hits, "five dry runs must leave the live counter exactly where it was").toBe(
      before!.hits,
    );
    expect(after!.latched).toBe(before!.latched);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 14 — semantic graph and temporal criteria
// ---------------------------------------------------------------------------

test.describe("Scenario 14 — semantic graph criteria", () => {
  /**
   * Driven live, not through the dry run: the evaluate route passes
   * `links = []` unconditionally, so every graph operator would degenerate to
   * its empty-input answer and the test would assert nothing.
   *
   * Each case authors a pair of rules — one expected to match, one not — and
   * reads back the OUTCOME recorded for each.
   *
   * This used to infer "did not match" from the absence of an audit row, with a
   * priority-weight trick to guarantee ordering. Audits are now written for
   * every evaluation (`matched` / `no_match` / `error`), so absence no longer
   * means what it did — and the outcome column makes the inference unnecessary:
   * a `no_match` row is positive evidence the rule ran and rejected the signal,
   * which is strictly better than reasoning about evaluation order.
   */
  async function graphCase(
    request: any,
    label: string,
    matching: Record<string, unknown>,
    nonMatching: Record<string, unknown>,
    eventType: string,
  ) {
    const gate = { field: "eventType", operator: "equals", value: eventType };

    await putRule(request, {
      ruleId: `${label}-no`,
      ruleName: `${label} (expected miss)`,
      enabled: true,
      priorityWeight: 90,
      ifBranch: {
        branchId: `${label}-no-if`,
        branchName: "IF",
        matchStrategy: "ALL",
        conditions: [gate, nonMatching],
        thenAction: { deliveryMode: "context_only" },
      },
    });
    await putRule(request, {
      ruleId: `${label}-yes`,
      ruleName: `${label} (expected match)`,
      enabled: true,
      priorityWeight: 10,
      ifBranch: {
        branchId: `${label}-yes-if`,
        branchName: "IF",
        matchStrategy: "ALL",
        conditions: [gate, matching],
        thenAction: { deliveryMode: "context_only" },
      },
    });

    const injected = await injectSignal(request, baseSignal({ eventType }));
    const yes = await waitForRuleOutcome(injected.event.id, `${label}-yes`);
    const no = await waitForRuleOutcome(injected.event.id, `${label}-no`);

    await deleteRule(request, `${label}-yes`);
    await deleteRule(request, `${label}-no`);

    // Both rules definitely ran; `matched`/`missed` now report their verdicts
    // rather than the presence or absence of a row.
    expect(no.outcome, "the expected-miss rule must have evaluated cleanly").not.toBe("error");
    return {
      injected,
      matched: yes.outcome === "matched",
      missed: no.outcome === "matched",
    };
  }

  test("a Logistics signal links to exactly the seeded suppliers", async ({ request }) => {
    const injected = await injectSignal(request, baseSignal({ eventType: "S14 Degree Probe" }));
    expect(
      injected.links,
      "the semantic-graph operators are all defined on this degree",
    ).toHaveLength(fx.graph.logisticsLinkCount);
    expect(injected.links.map((l) => l.targetEntityId)).toContain(fx.graph.primaryEntityId);
  });

  test("NEIGHBORHOOD_DENSITY thresholds on the causal degree", async ({ request }) => {
    const result = await graphCase(
      request,
      "s14-density",
      { type: "semantic_graph", graphOperator: "NEIGHBORHOOD_DENSITY", threshold: 3 },
      { type: "semantic_graph", graphOperator: "NEIGHBORHOOD_DENSITY", threshold: 9 },
      "S14 Density Probe",
    );
    expect(result.matched, "4 links clears a threshold of 3").toBe(true);
    expect(result.missed, "4 links does not clear a threshold of 9").toBe(false);
  });

  /**
   * NAMING: this operator is not a Fiedler cut.
   *
   * A Fiedler cut is derived from algebraic connectivity — the second-smallest
   * eigenvalue of the graph Laplacian and its eigenvector — and identifies where
   * a graph is most easily severed. What is implemented is
   * `min(1, links.length / 10)`: a linearly normalised DEGREE COUNT of the
   * signal's direct causal links. It reads no graph topology beyond that count,
   * so it cannot distinguish a hub whose removal partitions the network from
   * four unrelated leaves.
   *
   * The assertion below pins the arithmetic exactly, so this reads as the degree
   * heuristic it is rather than as spectral graph analysis.
   */
  test("FIEDLER_CUT_IMPACT is a normalised degree count, not a spectral cut", async ({
    request,
  }) => {
    // Four links => min(1, 4/10) = exactly 0.4. Bracketing the threshold either
    // side of that value proves the figure is degree/10 and nothing else.
    const atValue = await graphCase(
      request,
      "s14-fiedler",
      { type: "semantic_graph", graphOperator: "FIEDLER_CUT_IMPACT", threshold: 0.4 },
      { type: "semantic_graph", graphOperator: "FIEDLER_CUT_IMPACT", threshold: 0.5 },
      "S14 Fiedler Probe",
    );
    expect(atValue.matched, "degree 4 yields exactly 0.4, which meets a 0.4 threshold").toBe(true);
    expect(atValue.missed, "and falls short of 0.5").toBe(false);
  });

  test("CAUSAL_PATH_EXISTS resolves a real linked entity", async ({ request }) => {
    const result = await graphCase(
      request,
      "s14-path",
      {
        type: "semantic_graph",
        graphOperator: "CAUSAL_PATH_EXISTS",
        targetEntityId: fx.graph.primaryEntityId,
        maxHops: 3,
      },
      {
        type: "semantic_graph",
        graphOperator: "CAUSAL_PATH_EXISTS",
        targetEntityId: fx.graph.secondaryEntityId,
        maxHops: 3,
      },
      "S14 Path Probe",
    );
    expect(result.matched, "the linked supplier is reachable").toBe(true);
    expect(result.missed, "an entity with no link to this signal is not").toBe(false);
  });

  test("ONTOLOGY_IS_A matches on sector and event type", async ({ request }) => {
    const result = await graphCase(
      request,
      "s14-ontology",
      { type: "semantic_graph", graphOperator: "ONTOLOGY_IS_A", targetEntityId: "logistics" },
      { type: "semantic_graph", graphOperator: "ONTOLOGY_IS_A", targetEntityId: "pharmaceutical" },
      "S14 Ontology Probe",
    );
    expect(result.matched).toBe(true);
    expect(result.missed).toBe(false);
  });
});

test.describe("Scenario 14 — temporal criteria", () => {
  const temporal = (extra: Record<string, unknown>) => ({ type: "temporal_velocity", ...extra });

  /**
   * NOTE ON COVERAGE: the dry-run route stamps `createdAt: new Date()` on its
   * sample event and offers no way to override it, so every dry-run signal is
   * zero minutes old. That pins the age-based operators to one point on their
   * curve — the fresh end.
   *
   * These tests therefore verify that the operators are wired and evaluated,
   * not that the decay curve is correct at 90 minutes. The curve itself is
   * arithmetic and belongs in a unit test; asserting it here would need the
   * dry-run route to accept a caller-supplied timestamp.
   */
  test("MAX_SIGNAL_AGE admits a fresh signal", async ({ request }) => {
    const fresh = await evaluateCondition(
      request,
      "s14-age-ok",
      temporal({ temporalOperator: "MAX_SIGNAL_AGE", maxAgeMinutes: 60 }),
      sample(),
    );
    expect(fresh.matched).toBe(true);

    // A zero-minute window still admits a zero-age signal — `ageMinutes <=
    // maxAge` is inclusive, and a dry-run sample is evaluated in the same
    // millisecond it is stamped. Documented rather than asserted the other way,
    // because the intuitive "0 admits nothing" is simply not what this does.
    const zeroWindow = await evaluateCondition(
      request,
      "s14-age-zero",
      temporal({ temporalOperator: "MAX_SIGNAL_AGE", maxAgeMinutes: 0 }),
      sample(),
    );
    expect(zeroWindow.matched).toBe(true);
  });

  test("RECENCY_DECAY_FLOOR evaluates the half-life curve at the fresh end", async ({ request }) => {
    const aboveFloor = await evaluateCondition(
      request,
      "s14-decay-ok",
      temporal({ temporalOperator: "RECENCY_DECAY_FLOOR", minRecencyDecayFloor: 0.3 }),
      sample(),
    );
    expect(aboveFloor.matched, "a zero-age signal decays to exactly 1.0").toBe(true);

    // exp(-0/120) is exactly 1, so even a floor of 1 is met. The schema caps
    // the floor at 1, so there is no reachable failing case for a zero-age
    // sample — another consequence of the fixed dry-run timestamp.
    const atCeiling = await evaluateCondition(
      request,
      "s14-decay-floor1",
      temporal({ temporalOperator: "RECENCY_DECAY_FLOOR", minRecencyDecayFloor: 1 }),
      sample(),
    );
    expect(atCeiling.matched).toBe(true);
  });

  test("TIME_PARTING_WINDOW gates on day of week and hour", async ({ request }) => {
    const now = new Date();
    const today = now.getDay() === 0 ? 7 : now.getDay();
    const tomorrow = (today % 7) + 1;
    const hour = now.getHours();

    const open = await evaluateCondition(
      request,
      "s14-timepart-open",
      temporal({
        temporalOperator: "TIME_PARTING_WINDOW",
        timeParting: { daysOfWeek: [today], startHour: 0, endHour: 23 },
      }),
      sample(),
    );
    expect(open.matched).toBe(true);

    const wrongDay = await evaluateCondition(
      request,
      "s14-timepart-day",
      temporal({
        temporalOperator: "TIME_PARTING_WINDOW",
        timeParting: { daysOfWeek: [tomorrow], startHour: 0, endHour: 23 },
      }),
      sample(),
    );
    expect(wrongDay.matched).toBe(false);

    // A window that starts after the current hour cannot be open now.
    if (hour < 23) {
      const notYet = await evaluateCondition(
        request,
        "s14-timepart-hour",
        temporal({
          temporalOperator: "TIME_PARTING_WINDOW",
          timeParting: { daysOfWeek: [today], startHour: hour + 1, endHour: 23 },
        }),
        sample(),
      );
      expect(notYet.matched).toBe(false);
    }
  });

  /**
   * FREQUENCY_SPIKE now counts. It used to `return true` unconditionally, with
   * both config fields accepted and ignored.
   *
   * Only the negative half is exercised here: the dry run does not persist its
   * sample event, so a spike cannot be manufactured from this endpoint. The
   * positive cases — a real burst, and a burst from a DIFFERENT subject failing
   * to count toward this one — are in `signal-spatial-hardening.spec.ts` (H4),
   * which drives live signals.
   */
  test("FREQUENCY_SPIKE fails an unreachable count instead of passing regardless", async ({
    request,
  }) => {
    const result = await evaluateCondition(
      request,
      "s14-frequency",
      temporal({
        temporalOperator: "FREQUENCY_SPIKE",
        frequencyWindowMinutes: 5,
        minFrequencyCount: 100_000,
      }),
      sample(),
    );
    expect(
      result.matched,
      "a threshold no window could reach must fail — this assertion passed for " +
        "the wrong reason while the operator was a stub",
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fuzzy AI dispatch — deliberately not an assertion about a model's judgement
// ---------------------------------------------------------------------------

test.describe("Scenario 8b — fuzzy AI conditions are dispatched and thresholded", () => {
  /**
   * No assertion is made about the score the evaluator returns: that would be a
   * flaky test of a language model rather than of Oddjob. What is verified is
   * the wiring — that a fuzzy condition reaches the evaluator, that its score is
   * recorded under the metric name, and that the threshold decides the verdict.
   */
  test("records the metric and applies the threshold", async ({ request }) => {
    const result = await evaluateCondition(
      request,
      "s8b-fuzzy",
      {
        type: "fuzzy_ai_eval",
        metric: "escalation_risk",
        promptDirective: "Rate how likely this congestion is to escalate, 0 to 1.",
        operator: "greater_than_or_equal",
        fuzzyThreshold: 0,
      },
      sample(),
    );

    expect(
      Object.keys(result.fuzzyScores),
      "the metric must appear in the score map under its own name",
    ).toContain("escalation_risk");

    const score = result.fuzzyScores.escalation_risk;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    // A threshold of 0 is satisfiable by any score in range, so the verdict is
    // determined by the wiring rather than by the model's opinion.
    expect(result.matched).toBe(true);

    /**
     * The threshold comparison itself, without pinning the model.
     *
     * The schema caps `fuzzyThreshold` at 1, so there is no threshold that is
     * unsatisfiable by construction. Instead the verdict at a threshold of 1 is
     * checked for CONSISTENCY with the score the evaluator actually returned:
     * whatever it judged, `matched` must equal `score >= 1`. That is a real
     * assertion about the comparison and is stable across any score.
     */
    const atCeiling = await evaluateCondition(
      request,
      "s8b-fuzzy-ceiling",
      {
        type: "fuzzy_ai_eval",
        metric: "escalation_risk",
        promptDirective: "Rate how likely this congestion is to escalate, 0 to 1.",
        operator: "greater_than_or_equal",
        fuzzyThreshold: 1,
      },
      sample(),
    );
    const ceilingScore = atCeiling.fuzzyScores.escalation_risk;
    expect(
      atCeiling.matched,
      `score ${ceilingScore} against a threshold of 1 must decide the verdict`,
    ).toBe(ceilingScore >= 1);
  });
});
