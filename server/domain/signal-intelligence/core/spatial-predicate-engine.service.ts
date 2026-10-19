/**
 * Spatial Predicate Engine (GRIE spatial condition evaluator)
 *
 * Evaluates the four categories of spatial condition declared in
 * `shared/contracts/spatial-predicates.ts` against an event primitive's
 * telemetry:
 *
 *   1. Temporal & transition geofence triggers (ON_ENTER / ON_EXIT / ON_DWELL / ON_APPROACH)
 *   2. Topological & containment predicates (there / not_there / contains / intersects / k_ring)
 *   3. Eulerian flux & vector analytics (drift, Φ, velocity, centroid distance, parent zoom, neighbours)
 *   4. Relational & threshold operators applied to any of the above magnitudes
 *
 * Every predicate resolves to a discrete H3 cell-set membership test, so the
 * hot path is a `Set.has()` rather than spherical trigonometry or
 * point-in-polygon ray casting. Rasterised zones are memoised by geometry.
 */

import {
  latLngToCell,
  cellToLatLng,
  cellToParent,
  gridDisk,
  gridPathCells,
  greatCircleDistance,
  getResolution,
  polygonToCells,
  isValidCell,
  UNITS,
} from "h3-js";
import { fromHdop, errorEllipsePolygon, assessContainment } from "./positional-uncertainty.js";
import { createLogger } from "@server/utils/logger.js";
import {
  DEFAULT_SPATIAL_SCORING,
  normalizeGeofenceTrigger,
  normalizeOperator,
  normalizeSpatialFunction,
  normalizeSpatialPredicate,
  parseH3Resolution,
  requiredMatchCount,
  type ComparisonOperator,
  type SpatialCellGroup,
  type SpatialCondition,
  type SpatialConditionResult,
  type SpatialEvaluationSummary,
  type SpatialGeometry,
  type SpatialGroupResult,
  type SpatialPersistenceState,
  type SpatialScoringConfig,
} from "@shared/contracts/spatial-predicates.js";

const logger = createLogger("SpatialPredicateEngine");

const DEFAULT_RESOLUTION = 7;
const KM_PER_KNOT_HOUR = 1.852;

/**
 * Telemetry an event primitive carries for spatial evaluation. Every field is
 * optional: a signal with no coordinates simply cannot satisfy a spatial
 * condition, and the engine says so in the explanation rather than throwing.
 */
export interface SpatialObservation {
  /**
   * Per-tile metrics keyed by H3 index. Populated for area signals (density
   * rasters, congestion snapshots) and read by group aggregations such as
   * "Φ ≥ 0.7 in at least 3 tiles of this set".
   */
  cellMetrics?: Record<string, CellMetric>;
  /**
   * Identifies the tracked entity. Persistence counters are kept per subject,
   * so two vessels confirm their own transitions independently. Falls back to
   * a shared bucket when absent, which is only correct for single-asset feeds.
   */
  subjectId?: string | null;
  /** How the position was determined; drives the precision gate. */
  spatialSource?: string | null;
  /** Accuracy radius of the fix, in metres. */
  spatialPrecisionM?: number | null;
  /**
   * Horizontal Dilution of Precision (NMEA GGA), when the source reports it.
   * Enables the secondary Gaussian layer in the precision gate; absent, the
   * scalar radius is used exactly as before. Must be HDOP, never PDOP.
   */
  spatialHdop?: number | null;

  latitude?: number | null;
  longitude?: number | null;
  /** Pre-computed cell; derived from lat/lng when absent. */
  h3Index?: string | null;
  /** Cell occupied at the previous telemetry tick — drives ENTER/EXIT edges. */
  previousH3Index?: string | null;
  /** Minutes the asset has been inside its current zone. */
  dwellMinutes?: number | null;
  velocityKnots?: number | null;
  headingDegrees?: number | null;
  /** Approved mission trajectory position, for drift. */
  projectedLatitude?: number | null;
  projectedLongitude?: number | null;
  /** Risk / congestion density Φ in the occupied cell, 0-1. */
  fluxDensityPhi?: number | null;
}

/** Metrics measured for one H3 tile. */
export interface CellMetric {
  fluxDensityPhi?: number;
  velocityKnots?: number;
  driftKm?: number;
  dwellMinutes?: number;
  /** Event/signal count observed in the tile. */
  count?: number;
}

interface ResolvedZone {
  cells: Set<string>;
  resolution: number;
  centerLat?: number;
  centerLng?: number;
  label: string;
}

/** Mutable confirmation counters for one (condition, subject) pair. */
interface PersistenceEntry {
  hits: number;
  misses: number;
  latched: boolean;
  lastSeenMs: number;
  /** Changed since the last flush and needs writing back. */
  dirty?: boolean;
  /** Loaded from (or written to) durable storage at least once. */
  hydrated?: boolean;
}

/**
 * Durable backing for confirmation counters.
 *
 * Injected rather than imported so the engine stays usable — and testable —
 * with no database. When absent, the gate behaves exactly as it did before:
 * correct within a process, forgotten on restart.
 */
export interface PersistenceStore {
  load(
    organizationId: number,
    keys: Array<{ conditionKey: string; subjectId: string }>
  ): Promise<Array<{ conditionKey: string; subjectId: string; hits: number; misses: number; latched: boolean; lastSeenMs: number }>>;
  save(
    organizationId: number,
    rows: Array<{ conditionKey: string; subjectId: string; hits: number; misses: number; latched: boolean; lastSeenMs: number }>
  ): Promise<void>;
}

/**
 * Read-side backing for stored `spatial_regions` rows.
 *
 * Injected for the same reason as {@link PersistenceStore}: the engine has to
 * stay usable and testable with no database attached.
 */
export interface RegionStore {
  load(
    organizationId: number,
    regionIds: number[]
  ): Promise<Array<{ id: number; name: string; cells: string[] }>>;
}

/** A stored region, hydrated for synchronous lookup during evaluation. */
interface HydratedRegion {
  name: string;
  cells: string[];
  /** Coarsest and finest resolution actually present in `cells`. */
  minResolution: number;
  maxResolution: number;
}

export class SpatialPredicateEngineService {
  /** Memoises rasterised geometry; keyed by a stable digest of the geometry. */
  private zoneCache = new Map<string, ResolvedZone>();

  /** Confirmation counters for the iteration gate, keyed condition+subject. */
  private persistenceStore = new Map<string, PersistenceEntry>();

  /** Optional durable backing. Unset = in-memory only. */
  private durableStore: PersistenceStore | null = null;

  /** Stored regions loaded for the current evaluation pass, keyed by id. */
  private regionCache = new Map<number, HydratedRegion>();

  /** Optional read-side backing for `geometry.regionId`. Unset = inline only. */
  private regionStore: RegionStore | null = null;

  /** Attaches durable storage for confirmation counters. */
  public setPersistenceStore(store: PersistenceStore | null): void {
    this.durableStore = store;
  }

  /** Attaches the read side for stored regions. */
  public setRegionStore(store: RegionStore | null): void {
    this.regionStore = store;
  }

  /**
   * Loads every stored region referenced by `conditions` into memory.
   *
   * Must run before {@link evaluate}, which is synchronous by design — Stage 1
   * of the rule engine is an O(1) fast path and a database round trip inside a
   * predicate would defeat it. Mirrors `hydratePersistence`.
   */
  public async hydrateRegions(
    organizationId: number,
    conditions: SpatialCondition[]
  ): Promise<void> {
    if (!this.regionStore) return;

    const wanted = new Set<number>();
    for (const cond of conditions) {
      const id = cond.geometry?.regionId;
      // Already loaded is at least as fresh as the database for this pass.
      if (typeof id === "number" && !this.regionCache.has(id)) wanted.add(id);
    }
    if (!wanted.size) return;

    let rows: Array<{ id: number; name: string; cells: string[] }>;
    try {
      rows = await this.regionStore.load(organizationId, [...wanted]);
    } catch (err: any) {
      // A region that cannot be loaded must not silently become "no zone",
      // which would read as `outside` to an exclusion rule. Leaving it absent
      // makes resolveZone refuse the condition instead.
      logger.error(
        `[SpatialPredicateEngine] Could not load regions [${[...wanted].join(", ")}] ` +
          `for org ${organizationId}: ${err?.message ?? err}`
      );
      return;
    }

    for (const row of rows) {
      const cells = (row.cells ?? []).filter((c) => isValidCell(c));
      if (!cells.length) {
        logger.warn(
          `[SpatialPredicateEngine] Region ${row.id} ('${row.name}') has no valid H3 cells; ` +
            `conditions referencing it will not resolve.`
        );
        continue;
      }
      let min = Infinity;
      let max = -Infinity;
      for (const c of cells) {
        const res = getResolution(c);
        if (res < min) min = res;
        if (res > max) max = res;
      }
      this.regionCache.set(row.id, { name: row.name, cells, minResolution: min, maxResolution: max });
    }

    // Anything still missing was requested but not returned — a deleted region,
    // or one belonging to another org. Say so once rather than per predicate.
    for (const id of wanted) {
      if (!this.regionCache.has(id)) {
        logger.warn(
          `[SpatialPredicateEngine] Region ${id} was referenced by a rule but is not ` +
            `readable for org ${organizationId}; the condition will not resolve.`
        );
      }
    }
  }

  /** Drops hydrated regions. Used between evaluation passes and by tests. */
  public clearRegionCache(): void {
    this.regionCache.clear();
  }

  /**
   * Runs `fn` with confirmation counters isolated from live state.
   *
   * A dry run must not touch the gate: it evaluates the same conditionIds a
   * live rule uses, so without isolation testing a rule in the Rule Builder
   * would hydrate real counters, advance them, and flush them back — silently
   * resetting or advancing production confirmation progress for a real vessel.
   *
   * Swaps in a scratch map and detaches the durable store for the duration,
   * restoring both afterwards even if `fn` throws.
   */
  public async withIsolatedPersistence<T>(fn: () => Promise<T>): Promise<T> {
    const liveMap = this.persistenceStore;
    const liveStore = this.durableStore;
    this.persistenceStore = new Map();
    this.durableStore = null;
    try {
      return await fn();
    } finally {
      this.persistenceStore = liveMap;
      this.durableStore = liveStore;
    }
  }

  /**
   * Loads durable counters for the conditions about to be evaluated.
   *
   * Called by the rule engine BEFORE its synchronous evaluation pass. It has to
   * be a separate step because `evaluateCondition` is sync — the alternative,
   * making the whole predicate surface async, would put an await inside every
   * branch of the hot path for state that changes once per signal.
   *
   * Failure is non-fatal: a signal that cannot read its history still evaluates,
   * just without prior confirmation progress.
   */
  public async hydratePersistence(
    organizationId: number,
    conditions: SpatialCondition[],
    obs: SpatialObservation
  ): Promise<void> {
    if (!this.durableStore) return;

    const wanted = conditions
      .filter((c) => this.gateIsActive(c))
      .map((c) => ({
        cacheKey: this.persistenceKey(c, obs),
        conditionKey: this.conditionKey(c),
        subjectId: obs.subjectId ?? "__global__",
      }))
      // Anything already in memory is at least as fresh as the database.
      .filter((k) => !this.persistenceStore.get(k.cacheKey)?.hydrated);

    if (!wanted.length) return;

    try {
      const rows = await this.durableStore.load(
        organizationId,
        wanted.map(({ conditionKey, subjectId }) => ({ conditionKey, subjectId }))
      );
      const byKey = new Map(rows.map((r) => [`${r.conditionKey}::${r.subjectId}`, r]));

      for (const { cacheKey, conditionKey, subjectId } of wanted) {
        const row = byKey.get(`${conditionKey}::${subjectId}`);
        this.persistenceStore.set(cacheKey, {
          hits: row?.hits ?? 0,
          misses: row?.misses ?? 0,
          latched: row?.latched ?? false,
          lastSeenMs: row?.lastSeenMs ?? Date.now(),
          hydrated: true,
        });
      }
    } catch (err: any) {
      logger.warn(`[SpatialPredicateEngine] Could not hydrate persistence: ${err.message}`);
    }
  }

  /**
   * Writes back counters changed during evaluation.
   *
   * Fire-and-forget from the caller's perspective: a failed flush costs at most
   * the confirmation progress of one tick, which is strictly better than
   * failing the signal.
   */
  public async flushPersistence(organizationId: number): Promise<void> {
    if (!this.durableStore) return;

    const dirty: Array<{ key: string; entry: PersistenceEntry }> = [];
    for (const [key, entry] of this.persistenceStore) {
      if (entry.dirty) dirty.push({ key, entry });
    }
    if (!dirty.length) return;

    try {
      await this.durableStore.save(
        organizationId,
        dirty.map(({ key, entry }) => {
          const [conditionKey, subjectId] = this.splitKey(key);
          return {
            conditionKey,
            subjectId,
            hits: entry.hits,
            misses: entry.misses,
            latched: entry.latched,
            lastSeenMs: entry.lastSeenMs,
          };
        })
      );
      // Only clear the flag on success, so a failed write is retried next tick.
      for (const { entry } of dirty) entry.dirty = false;
    } catch (err: any) {
      logger.warn(`[SpatialPredicateEngine] Could not flush persistence: ${err.message}`);
    }
  }

  /** True when the condition configures a gate worth persisting. */
  private gateIsActive(cond: SpatialCondition): boolean {
    const cfg = cond.persistence;
    if (!cfg) return false;
    const required = Math.max(1, Math.floor(cfg.requiredConsecutiveHits ?? 1));
    const release = Math.max(1, Math.floor(cfg.releaseAfterMisses ?? 1));
    return required > 1 || release > 1;
  }

  // ==========================================================================
  // PUBLIC ENTRY POINT
  // ==========================================================================

  /**
   * Evaluates a set of spatial conditions and aggregates them into a single
   * 0-1 spatial score plus a per-condition trace.
   *
   * `matchStrategy` mirrors the branch semantics of the rule engine: "ALL"
   * requires every condition, "ANY" requires at least one.
   */
  public evaluate(
    conditions: SpatialCondition[],
    observation: SpatialObservation,
    matchStrategy: "ALL" | "ANY" = "ALL"
  ): SpatialEvaluationSummary {
    if (!conditions.length) {
      return { passed: true, spatialScore: 0, results: [] };
    }

    const results = conditions.map((cond) => this.evaluateCondition(cond, observation));

    const passed =
      matchStrategy === "ANY" ? results.some((r) => r.passed) : results.every((r) => r.passed);

    return { passed, spatialScore: this.aggregateScore(results), results };
  }

  /**
   * Weighted mean of condition scores. A failed `critical` condition zeroes the
   * aggregate outright — that is the point of marking one critical, and it must
   * not be dilutable by a crowd of passing low-value conditions.
   */
  private aggregateScore(results: SpatialConditionResult[]): number {
    if (!results.length) return 0;
    if (results.some((r) => r.critical && !r.passed)) return 0;

    const totalWeight = results.reduce((sum, r) => sum + r.weight, 0);
    if (totalWeight <= 0) return 0;

    const weighted = results.reduce((sum, r) => sum + r.score * r.weight, 0);
    return Number(Math.min(1, Math.max(0, weighted / totalWeight)).toFixed(4));
  }

  public evaluateCondition(
    cond: SpatialCondition,
    observation: SpatialObservation
  ): SpatialConditionResult {
    const raw = this.evaluateRaw(cond, observation);
    // The iteration gate sits above the predicate: it converts a noisy
    // instantaneous verdict into a confirmed one.
    return this.applyPersistence(cond, observation, raw);
  }

  /**
   * Nominal radius of an H3 cell at a resolution, in metres. Used to compare a
   * fix's accuracy against the granularity a predicate is asking about.
   */
  private cellRadiusM(resolution: number): number {
    const EDGE_KM = [
      1107.71, 418.68, 158.24, 59.81, 22.61, 8.54, 3.23, 1.22, 0.46, 0.174, 0.0658, 0.0249,
      0.00941, 0.00356, 0.00135, 0.000509,
    ];
    return EDGE_KM[Math.min(15, Math.max(0, resolution))] * 1000;
  }

  /**
   * Rejects a predicate whose geometry is finer than the fix it would be
   * tested against.
   *
   * WHY THIS MATTERS: ingestion places a signal at a country centroid when
   * nothing better is available (~500 km accuracy). Tested naively against a
   * 5 km harbour geofence, such a signal reads as unambiguously OUTSIDE — which
   * silently satisfies every `not_there` exclusion rule and raises a false
   * alert about an asset whose position is in fact unknown. "Unknown" and
   * "outside" are different answers and must not collapse into one.
   *
   * Returns null when the fix is precise enough to proceed.
   */
  private precisionGate(
    cond: SpatialCondition,
    obs: SpatialObservation,
    zone: ResolvedZone
  ): SpatialConditionResult | null {
    const precisionM = obs.spatialPrecisionM;
    if (precisionM == null || !Number.isFinite(precisionM)) return null;

    // Judge the fix against the zone's EXTENT, not one cell. A geofence painted
    // over 60 tiles is a large target and legitimately tolerates a coarser fix
    // than a single-tile berth does. Area grows with cell count, so the radius
    // grows with its square root.
    const cellRadius = this.cellRadiusM(zone.resolution);
    const extentRadius = cellRadius * Math.max(1, Math.sqrt(zone.cells.size));
    const tolerance = extentRadius * 2;
    if (precisionM <= tolerance) return null;

    // SECONDARY LAYER. The check above necessarily reasons from a radius, i.e.
    // the worst-case axis, so it rejects fixes whose error is long in one
    // direction but tight across the boundary that actually matters. Where the
    // source reported HDOP we can test the real error ellipse instead, and a
    // definitive verdict there is strictly more information than the radius had.
    //
    // It may only RESCUE a rejection — never overturn a pass. The scalar gate
    // above still runs first and unchanged.
    if (this.gaussianResolves(obs, zone)) return null;

    return this.fail(
      cond,
      `Fix is too coarse to evaluate: ±${this.km(precisionM)}km accuracy` +
        `${obs.spatialSource ? ` (source: ${obs.spatialSource})` : ""} against a ` +
        `${zone.cells.size}-tile Res ${zone.resolution} zone (±${this.km(tolerance)}km tolerance). ` +
        `Position is unknown at this granularity, not outside.`
    );
  }

  /**
   * Can the reported error ELLIPSE decide containment where the radius could not?
   *
   * Builds the 95% confidence ellipse from HDOP, converts it to cells at the
   * zone's own resolution, and asks whether it falls almost wholly inside or
   * almost wholly outside. Only a definitive answer counts — a straddling
   * ellipse leaves the original rejection standing, which is the behaviour that
   * keeps "unknown" from collapsing into "outside".
   *
   * Returns false whenever anything is missing or unparseable, so the caller's
   * existing rejection is preserved on every degraded path.
   */
  private gaussianResolves(obs: SpatialObservation, zone: ResolvedZone): boolean {
    const hdop = obs.spatialHdop;
    if (hdop == null || !Number.isFinite(hdop) || hdop <= 0) return false;
    if (obs.latitude == null || obs.longitude == null) return false;

    try {
      const cov = fromHdop(hdop);
      const polygon = errorEllipsePolygon(obs.latitude, obs.longitude, cov, 0.95, 24);
      const cells = polygonToCells(polygon, zone.resolution);
      if (cells.length === 0) return false;

      const { verdict } = assessContainment(cells, zone.cells);
      return verdict !== "indeterminate";
    } catch {
      // Degenerate geometry (poles, antimeridian) must not throw inside a gate.
      return false;
    }
  }

  /** Formats metres as km with one decimal, for explanations. */
  private km(metres: number): string {
    return (metres / 1000).toFixed(1);
  }

  /**
   * Rejects a magnitude assertion the fix is too coarse to support.
   *
   * The zone gate above judges a fix against a target region's extent. Flux
   * functions have no region to judge against — what bounds them is the
   * THRESHOLD being asserted. Claiming "drift >= 2km" from a fix accurate to
   * ±500km is not a measurement, it is the accuracy radius showing through, and
   * it reads as a confident breach.
   *
   * Only functions whose value is derived from position are gated.
   * `velocity_vector` and `isotropic_flux_density` are read straight off the
   * telemetry and carry their own accuracy; `equidistant_neighbors` is a
   * property of the tiling and is meaningful wherever the asset is.
   *
   * Returns null when the fix is precise enough, or when no threshold is given
   * to judge against.
   */
  private magnitudePrecisionGate(
    cond: SpatialCondition,
    obs: SpatialObservation,
    fn: ReturnType<typeof normalizeSpatialFunction>
  ): SpatialConditionResult | null {
    const precisionM = obs.spatialPrecisionM;
    if (precisionM == null || !Number.isFinite(precisionM)) return null;

    const source = obs.spatialSource ? ` (source: ${obs.spatialSource})` : "";

    // A parent-cell rollup asks "which sector is this in". A fix coarser than
    // the sector cannot answer, however plausible the returned resolution looks.
    if (fn === "h3_parent_zoom") {
      const targetRes = cond.geometry?.h3Resolution ?? 6;
      const tolerance = this.cellRadiusM(targetRes) * 2;
      if (precisionM <= tolerance) return null;
      return this.fail(
        cond,
        `Fix is too coarse to place the signal in a Res ${targetRes} sector: ` +
          `±${this.km(precisionM)}km accuracy${source} against a ±${this.km(tolerance)}km ` +
          `tolerance. The rollup would report a cell the signal is not known to occupy.`
      );
    }

    if (fn !== "spatial_drift" && fn !== "centroid_distance") return null;

    // Compare against the SMALLEST bound the rule cares about — for `between`
    // that is the lower one, and for a bare threshold the value itself. A fix
    // whose error is the size of the thing being asserted cannot assert it.
    const bounds = (Array.isArray(cond.value) ? cond.value : [cond.value])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!bounds.length) return null;

    const thresholdM = Math.min(...bounds) * 1000;
    if (precisionM < thresholdM) return null;

    return this.fail(
      cond,
      `Fix is too coarse to measure ${fn}: ±${this.km(precisionM)}km accuracy${source} ` +
        `against a ${this.km(thresholdM)}km threshold. Any value reported here is the ` +
        `accuracy radius, not a measured displacement.`
    );
  }

  private evaluateRaw(
    cond: SpatialCondition,
    observation: SpatialObservation
  ): SpatialConditionResult {
    try {
      // A condition targeting named tile sets is evaluated per group so the
      // trace can say which sector matched and by how many tiles.
      if (cond.geometry?.cellGroups?.length) {
        return this.evaluateAcrossGroups(cond, observation);
      }
      switch (cond.mode) {
        case "geofence_trigger":
          return this.evaluateGeofenceTrigger(cond, observation);
        case "topological":
          return this.evaluateTopological(cond, observation);
        case "flux_analytic":
          return this.evaluateFluxAnalytic(cond, observation);
        default:
          return this.fail(cond, `Unknown spatial condition mode '${cond.mode}'.`);
      }
    } catch (err: any) {
      logger.error(`[SpatialPredicateEngine] Condition evaluation failed: ${err.message}`);
      return this.fail(cond, `Spatial evaluation error: ${err.message}`);
    }
  }

  // ==========================================================================
  // ITERATION GATE (persistence / hysteresis)
  // ==========================================================================

  /**
   * Requires N consecutive passes before a condition reports true, and M
   * consecutive misses before it releases.
   *
   * Without a configured gate this is a pass-through, so existing rules keep
   * firing on the first tick exactly as before.
   */
  private applyPersistence(
    cond: SpatialCondition,
    obs: SpatialObservation,
    raw: SpatialConditionResult
  ): SpatialConditionResult {
    const cfg = cond.persistence;
    const required = Math.max(1, Math.floor(cfg?.requiredConsecutiveHits ?? 1));
    const releaseAfter = Math.max(1, Math.floor(cfg?.releaseAfterMisses ?? 1));

    // No gate configured — nothing to track, and no state to accumulate.
    if (!cfg || (required === 1 && releaseAfter === 1)) return raw;

    const key = this.persistenceKey(cond, obs);
    const now = Date.now();
    let entry = this.persistenceStore.get(key);

    // A stale entry is worse than none: progress assembled hours apart was
    // never really "consecutive".
    if (entry && cfg.windowMs && now - entry.lastSeenMs > cfg.windowMs) {
      entry = undefined;
    }
    if (!entry) entry = { hits: 0, misses: 0, latched: false, lastSeenMs: now };
    entry.lastSeenMs = now;

    if (raw.passed) {
      entry.hits += 1;
      entry.misses = 0;
      if (entry.hits >= required) entry.latched = true;
    } else {
      entry.misses += 1;
      entry.hits = 0;
      if (entry.misses >= releaseAfter) entry.latched = false;
    }
    // Counters moved, so this entry needs writing back on the next flush.
    entry.dirty = true;
    this.persistenceStore.set(key, entry);

    const pending = raw.passed && !entry.latched;
    const state: SpatialPersistenceState = {
      hits: entry.hits,
      misses: entry.misses,
      required,
      latched: entry.latched,
      pending,
    };

    // While confirming, optionally carry a fraction of the score so a signal
    // that is *about* to confirm can still influence ranking.
    const pendingFactor = cfg.pendingScoreFactor ?? 0;
    const score = entry.latched
      ? raw.score
      : pending
        ? Number((raw.score * pendingFactor).toFixed(4))
        : raw.score;

    const suffix = entry.latched
      ? raw.passed
        ? ` Confirmed over ${required} consecutive evaluation(s).`
        : ` Held latched: ${entry.misses}/${releaseAfter} misses toward release.`
      : pending
        ? ` Awaiting confirmation: ${entry.hits}/${required} consecutive hits.`
        : "";

    return {
      ...raw,
      passed: entry.latched,
      score,
      explanation: `${raw.explanation}${suffix}`,
      persistence: state,
    };
  }

  /**
   * Identity for a persistence counter. Falls back to a digest of the
   * condition's own shape when no explicit id is set, so two different
   * conditions in one rule never share a counter.
   */
  private persistenceKey(cond: SpatialCondition, obs: SpatialObservation): string {
    return `${this.conditionKey(cond)}::${obs.subjectId ?? "__global__"}`;
  }

  /**
   * Identity of the condition itself, without the subject.
   *
   * Falls back to a digest of the condition's shape when no explicit
   * `conditionId` is set, so two different conditions in one rule never share a
   * counter. An explicit id is strongly preferred: the derived key changes if
   * the geometry is edited, which silently resets confirmation progress.
   */
  private conditionKey(cond: SpatialCondition): string {
    return (
      cond.conditionId ??
      `${cond.mode}:${cond.trigger ?? cond.predicate ?? cond.fn ?? ""}:${cond.geometry ? this.geometryKey(cond.geometry) : ""}`
    );
  }

  /** Splits a cache key back into its condition and subject halves. */
  private splitKey(key: string): [string, string] {
    const idx = key.lastIndexOf("::");
    return idx === -1 ? [key, "__global__"] : [key.slice(0, idx), key.slice(idx + 2)];
  }

  /** Clears confirmation counters. Exposed for tests and for rule redeploys. */
  public resetPersistence(subjectId?: string): void {
    if (!subjectId) {
      this.persistenceStore.clear();
      return;
    }
    for (const key of [...this.persistenceStore.keys()]) {
      if (key.endsWith(`::${subjectId}`)) this.persistenceStore.delete(key);
    }
  }

  // ==========================================================================
  // HEX TILE GROUPS
  // ==========================================================================

  /**
   * Evaluates one condition against each named tile set, then combines the
   * group verdicts with the condition's `groupCombinator`.
   *
   * The condition's score becomes the weighted match ratio across groups, so a
   * set where 4 of 7 tiles breach scores higher than one where a single tile
   * does — grouping carries magnitude, not just a boolean.
   */
  private evaluateAcrossGroups(
    cond: SpatialCondition,
    obs: SpatialObservation
  ): SpatialConditionResult {
    const groups = cond.geometry!.cellGroups!;
    const combinator = cond.geometry!.groupCombinator ?? "any";

    const groupResults: SpatialGroupResult[] = groups.map((group) =>
      this.evaluateGroup(cond, group, obs)
    );

    const passed =
      combinator === "all"
        ? groupResults.every((g) => g.passed)
        : groupResults.some((g) => g.passed);

    const totalWeight = groupResults.reduce((s, g) => s + g.weight, 0) || 1;
    const weightedRatio =
      groupResults.reduce((s, g) => s + g.matchRatio * g.weight, 0) / totalWeight;

    const passingNames = groupResults.filter((g) => g.passed).map((g) => g.name);
    const explanation = passed
      ? `${passingNames.length} of ${groups.length} tile set(s) matched (${combinator.toUpperCase()}): ${passingNames.join(", ")}.`
      : `No tile set satisfied the condition under ${combinator.toUpperCase()} (${groupResults.map((g) => `${g.name} ${g.matchedCells.length}/${g.totalCells}`).join("; ")}).`;

    const scoring = cond.scoring ?? {};
    const passScore = scoring.passScore ?? DEFAULT_SPATIAL_SCORING.passScore;
    const failScore = scoring.failScore ?? DEFAULT_SPATIAL_SCORING.failScore;
    // Grade within the pass/fail band by how much of the set actually matched.
    const score = failScore + (passScore - failScore) * weightedRatio;

    return {
      passed,
      score: Number(Math.min(1, Math.max(0, score)).toFixed(4)),
      weight: scoring.weight ?? DEFAULT_SPATIAL_SCORING.weight,
      critical: scoring.critical ?? false,
      observed: Number(weightedRatio.toFixed(4)),
      unit: "match ratio",
      explanation,
      groups: groupResults,
    };
  }

  /**
   * Evaluates a condition against the tiles of one group.
   *
   * Two evaluation styles, chosen by what the signal carries:
   *  - Per-tile metrics present → test the condition against each tile and
   *    count how many satisfy it. This is what makes "at least K tiles" real.
   *  - Otherwise → treat the group as a zone and test the asset's own position
   *    against it, which is the meaningful reading for a moving entity.
   */
  private evaluateGroup(
    cond: SpatialCondition,
    group: SpatialCellGroup,
    obs: SpatialObservation
  ): SpatialGroupResult {
    const cells = group.cells.filter((c) => isValidCell(c));
    const total = cells.length;
    const weight = group.weight ?? 1;
    const aggregation = group.aggregation ?? "any";
    const required = requiredMatchCount({ ...group, cells });

    if (!total) {
      return {
        groupId: group.groupId,
        name: group.name,
        aggregation,
        passed: false,
        matchedCells: [],
        totalCells: 0,
        matchRatio: 0,
        weight,
        explanation: `Tile set '${group.name}' contains no valid H3 cells.`,
      };
    }

    const resolution = group.resolution ?? getResolution(cells[0]);
    const hasPerTileMetrics =
      obs.cellMetrics != null && cells.some((c) => obs.cellMetrics![c] != null);

    let matchedCells: string[];

    if (hasPerTileMetrics && cond.mode === "flux_analytic") {
      matchedCells = cells.filter((cell) => this.tileSatisfies(cond, obs.cellMetrics![cell]));
    } else {
      // Positional reading: which tiles of the set the asset actually occupies.
      const current = this.currentCell(obs, resolution);
      const zone: ResolvedZone = {
        cells: new Set(cells),
        resolution,
        centerLat: cond.geometry?.centerLat,
        centerLng: cond.geometry?.centerLng,
        label: group.name,
      };
      const single = this.evaluateAgainstZone(cond, obs, zone, current);
      matchedCells = single.passed && current ? [current] : [];

      // A positional test is inherently single-tile: the asset is in one cell.
      // Honour the group verdict from that test rather than a tile count, but
      // still report the ratio so the trace stays informative.
      return {
        groupId: group.groupId,
        name: group.name,
        aggregation,
        passed: single.passed,
        matchedCells,
        totalCells: total,
        matchRatio: single.passed ? 1 : 0,
        weight,
        explanation: `${group.name} (${total} tile${total === 1 ? "" : "s"}): ${single.explanation}`,
      };
    }

    const passed = matchedCells.length >= required;
    const matchRatio = matchedCells.length / total;

    return {
      groupId: group.groupId,
      name: group.name,
      aggregation,
      passed,
      matchedCells,
      totalCells: total,
      matchRatio: Number(matchRatio.toFixed(4)),
      weight,
      explanation: `${group.name}: ${matchedCells.length}/${total} tiles satisfied ${cond.fn ?? cond.predicate ?? cond.trigger} (needs ${required} for ${aggregation.toUpperCase()}).${group.note ? ` — ${group.note}` : ""}`,
    };
  }

  /** Tests a flux/vector condition against one tile's measured metrics. */
  private tileSatisfies(cond: SpatialCondition, metric: CellMetric | undefined): boolean {
    if (!metric) return false;
    const fn = normalizeSpatialFunction(cond.fn);
    const operator = normalizeOperator(cond.operator) ?? "greater_than_or_equal";

    let observed: number | undefined;
    switch (fn) {
      case "isotropic_flux_density":
        observed = metric.fluxDensityPhi;
        break;
      case "velocity_vector":
        observed = metric.velocityKnots;
        break;
      case "spatial_drift":
        observed = metric.driftKm;
        break;
      default:
        observed = metric.count;
        break;
    }

    if (observed == null || !Number.isFinite(observed)) return false;
    return this.compare(observed, operator, cond.value);
  }

  /**
   * Runs the mode-appropriate predicate against an explicitly supplied zone.
   * Shared by the grouped and ungrouped paths so both read identically.
   */
  private evaluateAgainstZone(
    cond: SpatialCondition,
    obs: SpatialObservation,
    zone: ResolvedZone,
    current: string | null
  ): { passed: boolean; explanation: string } {
    if (!current) {
      return { passed: false, explanation: "Signal carries no coordinates or H3 index." };
    }
    const scoped: SpatialCondition = {
      ...cond,
      geometry: {
        ...cond.geometry,
        cellGroups: undefined,
        h3Cells: [...zone.cells],
        h3Resolution: zone.resolution,
        regionName: zone.label,
      },
    };
    const result =
      scoped.mode === "geofence_trigger"
        ? this.evaluateGeofenceTrigger(scoped, obs)
        : scoped.mode === "topological"
          ? this.evaluateTopological(scoped, obs)
          : this.evaluateFluxAnalytic(scoped, obs);

    return { passed: result.passed, explanation: result.explanation };
  }

  // ==========================================================================
  // 1. GEOFENCE TRIGGERS
  // ==========================================================================

  private evaluateGeofenceTrigger(
    cond: SpatialCondition,
    obs: SpatialObservation
  ): SpatialConditionResult {
    const trigger = normalizeGeofenceTrigger(cond.trigger);
    if (!trigger) return this.fail(cond, `Unrecognised geofence trigger '${cond.trigger}'.`);

    const zone = this.resolveZone(cond.geometry);
    if (!zone) return this.fail(cond, "Geofence trigger has no resolvable target geometry.");

    const gated = this.precisionGate(cond, obs, zone);
    if (gated) return gated;

    const current = this.currentCell(obs, zone.resolution);
    if (!current) return this.fail(cond, "Signal carries no coordinates or H3 index.");

    const previous = this.normalizeCellTo(obs.previousH3Index, zone.resolution);
    const inNow = zone.cells.has(current);
    const inBefore = previous ? zone.cells.has(previous) : null;

    switch (trigger) {
      case "ON_ENTER": {
        // A first-ever fix inside the zone counts as an entry: there is no
        // prior cell to have been outside, but the asset is demonstrably in.
        const entered = inNow && inBefore !== true;
        return this.score(
          cond,
          entered,
          entered
            ? `Asset crossed into ${zone.label} (cell ${current}). Transient LOCATED_IN edge opened, dwell SLA timer started.`
            : inNow
              ? `Asset already inside ${zone.label} at previous tick — no entry edge.`
              : `Asset is outside ${zone.label}.`
        );
      }

      case "ON_EXIT": {
        const exited = inBefore === true && !inNow;
        return this.score(
          cond,
          exited,
          exited
            ? `Asset departed ${zone.label} (${previous} → ${current}). Transient edge evicted, exit vector logged.`
            : inBefore === null
              ? "No previous cell recorded — exit transition cannot be established."
              : `No exit transition for ${zone.label}.`
        );
      }

      case "ON_DWELL": {
        const sla = cond.dwellSlaMinutes ?? 120;
        const dwell = obs.dwellMinutes ?? 0;
        const breached = inNow && dwell > sla;
        return this.score(
          cond,
          breached,
          breached
            ? `Dwell SLA breached in ${zone.label}: T=${dwell}min > T_sla=${sla}min.`
            : inNow
              ? `Dwelling ${dwell}min inside ${zone.label}, within the ${sla}min SLA.`
              : `Asset is not inside ${zone.label}.`,
          {
            observed: dwell,
            unit: "min",
            // Ramp between the SLA and double the SLA so a marginal overrun
            // scores lower than a gross one.
            ramp: { value: dwell, floor: sla, ceiling: sla * 2 },
          }
        );
      }

      case "ON_APPROACH": {
        const bufferKm = cond.approachBufferKm ?? cond.geometry?.radiusKm ?? 10;
        const distanceKm = this.distanceToZoneKm(current, zone);
        // Approach is a pre-breach warning: inside the buffer but not yet in.
        const approaching = !inNow && distanceKm !== null && distanceKm < bufferKm;
        return this.score(
          cond,
          approaching,
          approaching
            ? `Asset within approach buffer of ${zone.label}: d=${distanceKm!.toFixed(2)}km < D_alert=${bufferKm}km. Pre-fetching regional tools.`
            : inNow
              ? `Asset has already breached ${zone.label} — approach window passed.`
              : `Asset is ${distanceKm === null ? "an unknown distance" : `${distanceKm.toFixed(2)}km`} from ${zone.label}, outside the ${bufferKm}km buffer.`,
          {
            observed: distanceKm ?? undefined,
            unit: "km",
            // Closer to the perimeter scores higher: invert the ramp.
            ramp:
              distanceKm === null
                ? undefined
                : { value: bufferKm - distanceKm, floor: 0, ceiling: bufferKm },
          }
        );
      }
    }
  }

  // ==========================================================================
  // 2. TOPOLOGICAL & CONTAINMENT PREDICATES
  // ==========================================================================

  private evaluateTopological(
    cond: SpatialCondition,
    obs: SpatialObservation
  ): SpatialConditionResult {
    const predicate = normalizeSpatialPredicate(cond.predicate);
    if (!predicate) return this.fail(cond, `Unrecognised spatial predicate '${cond.predicate}'.`);

    const zone = this.resolveZone(cond.geometry);
    if (!zone) return this.fail(cond, "Topological predicate has no resolvable target geometry.");

    const gated = this.precisionGate(cond, obs, zone);
    if (gated) return gated;

    const current = this.currentCell(obs, zone.resolution);
    if (!current) return this.fail(cond, "Signal carries no coordinates or H3 index.");

    switch (predicate) {
      case "there": {
        const inside = zone.cells.has(current);
        return this.score(
          cond,
          inside,
          inside
            ? `Centroid ${current} resides inside ${zone.label}.`
            : `Centroid ${current} is not within ${zone.label}.`
        );
      }

      case "not_there": {
        const outside = !zone.cells.has(current);
        return this.score(
          cond,
          outside,
          outside
            ? `Centroid ${current} is outside ${zone.label} — boundary/exclusion violation.`
            : `Centroid ${current} is inside ${zone.label}.`
        );
      }

      case "contains": {
        // Hierarchical containment: walk the observed cell up to the zone's
        // resolution and test the coarse parent. This is the O(1) bitwise
        // rollup rather than a geometric test.
        const parent = this.parentAt(current, zone.resolution);
        const contained = parent !== null && zone.cells.has(parent);
        return this.score(
          cond,
          contained,
          contained
            ? `${zone.label} (Res ${zone.resolution}) encompasses child cell ${current} via parent ${parent}.`
            : `${zone.label} does not encompass ${current}.`
        );
      }

      case "intersects": {
        // Trajectory crossing: the discrete path from the previous fix to the
        // current one. Falls back to heading projection when no prior fix
        // exists, so a first-tick signal can still be tested against a corridor.
        const path = this.trajectoryPath(obs, current, zone.resolution);
        const hit = path.find((cell) => zone.cells.has(cell));
        return this.score(
          cond,
          Boolean(hit),
          hit
            ? `Projected trajectory crosses ${zone.label} at cell ${hit} (${path.length}-cell path).`
            : `Trajectory (${path.length} cells) does not intersect ${zone.label}.`
        );
      }

      case "k_ring": {
        // Radial expansion around the zone centre. `k` wins when given;
        // otherwise a km radius is converted to a ring count.
        const origin = this.zoneOriginCell(zone, cond.geometry);
        if (!origin) return this.fail(cond, "k-ring predicate has no resolvable origin cell.");

        const k = this.resolveK(cond.geometry, zone.resolution);
        const disk = new Set(gridDisk(origin, k));
        const within = disk.has(current);
        const distanceKm = this.centroidDistanceKm(origin, current);
        return this.score(
          cond,
          within,
          within
            ? `Cell ${current} lies within the k=${k} ring of ${zone.label} (${disk.size} cells, d=${distanceKm.toFixed(2)}km).`
            : `Cell ${current} is outside the k=${k} ring of ${zone.label} (d=${distanceKm.toFixed(2)}km).`,
          { observed: distanceKm, unit: "km" }
        );
      }
    }
  }

  // ==========================================================================
  // 3. EULERIAN FLUX & VECTOR ANALYTICS
  // ==========================================================================

  private evaluateFluxAnalytic(
    cond: SpatialCondition,
    obs: SpatialObservation
  ): SpatialConditionResult {
    const fn = normalizeSpatialFunction(cond.fn);
    if (!fn) return this.fail(cond, `Unrecognised spatial function '${cond.fn}'.`);

    const measured = this.measure(fn, cond, obs);
    if (measured === null) {
      return this.fail(cond, `Signal lacks the telemetry required by ${fn}.`);
    }

    // Position-derived magnitudes need the same protection the zone predicates
    // get. Without it a country-centroid fix produces a large, confident drift
    // figure — the exact "unknown reported as fact" failure the zone gate
    // exists to prevent, in the function where the number looks most
    // authoritative.
    const gated = this.magnitudePrecisionGate(cond, obs, fn);
    if (gated) return gated;

    const { value, unit } = measured;
    const operator = normalizeOperator(cond.operator) ?? "greater_than_or_equal";
    const passed = this.compare(value, operator, cond.value);

    return this.score(
      cond,
      passed,
      `${fn} = ${value.toFixed(3)}${unit ? ` ${unit}` : ""} ${passed ? "satisfies" : "fails"} ${operator} ${this.describeThreshold(cond.value)}.`,
      {
        observed: value,
        unit,
        ramp: this.thresholdRamp(cond, value, operator),
      }
    );
  }

  /** Computes the scalar magnitude a flux/vector function yields. */
  private measure(
    fn: ReturnType<typeof normalizeSpatialFunction>,
    cond: SpatialCondition,
    obs: SpatialObservation
  ): { value: number; unit: string } | null {
    switch (fn) {
      case "spatial_drift": {
        // |P_actual - P_projected| — great-circle separation between the live
        // fix and the approved trajectory position.
        if (
          obs.latitude == null ||
          obs.longitude == null ||
          obs.projectedLatitude == null ||
          obs.projectedLongitude == null
        ) {
          return null;
        }
        const km = greatCircleDistance(
          [obs.latitude, obs.longitude],
          [obs.projectedLatitude, obs.projectedLongitude],
          UNITS.km
        );
        return { value: Number(km.toFixed(4)), unit: "km" };
      }

      case "isotropic_flux_density": {
        if (obs.fluxDensityPhi == null) return null;
        return { value: Number(obs.fluxDensityPhi), unit: "Φ" };
      }

      case "velocity_vector": {
        if (obs.velocityKnots == null) return null;
        return { value: Number(obs.velocityKnots), unit: "knots" };
      }

      case "centroid_distance": {
        const zone = this.resolveZone(cond.geometry);
        const current = this.currentCell(obs, zone?.resolution ?? DEFAULT_RESOLUTION);
        if (!zone || !current) return null;
        const origin = this.zoneOriginCell(zone, cond.geometry);
        if (!origin) return null;
        return { value: this.centroidDistanceKm(origin, current), unit: "km" };
      }

      case "h3_parent_zoom": {
        // Yields the resolution of the rolled-up parent, letting a rule assert
        // "this signal rolls up into a Res ≤ 6 strategic sector".
        const targetRes = cond.geometry?.h3Resolution ?? 6;
        const current = this.currentCell(obs, DEFAULT_RESOLUTION);
        if (!current) return null;
        const parent = this.parentAt(current, targetRes);
        if (!parent) return null;
        return { value: getResolution(parent), unit: "res" };
      }

      case "equidistant_neighbors": {
        const current = this.currentCell(obs, DEFAULT_RESOLUTION);
        if (!current) return null;
        // 6 for a normal hex, 5 at one of the 12 pentagons per resolution.
        return { value: gridDisk(current, 1).filter((c) => c !== current).length, unit: "cells" };
      }

      default:
        return null;
    }
  }

  // ==========================================================================
  // 4. RELATIONAL & THRESHOLD OPERATORS
  // ==========================================================================

  private compare(
    observed: number,
    operator: ComparisonOperator,
    threshold: SpatialCondition["value"]
  ): boolean {
    switch (operator) {
      case "equals":
        return observed === Number(threshold);
      case "not_equals":
        return observed !== Number(threshold);
      case "greater_than":
        return observed > Number(threshold);
      case "greater_than_or_equal":
        return observed >= Number(threshold);
      case "less_than":
        return observed < Number(threshold);
      case "less_than_or_equal":
        return observed <= Number(threshold);
      case "in":
        return Array.isArray(threshold) && threshold.map(Number).includes(observed);
      case "not_in":
        return Array.isArray(threshold) && !threshold.map(Number).includes(observed);
      case "contains":
        return String(observed).includes(String(threshold));
      case "between": {
        if (!Array.isArray(threshold) || threshold.length < 2) return false;
        // Accept the bounds in either order rather than silently failing when
        // an operator writes them high-first.
        const [a, b] = [Number(threshold[0]), Number(threshold[1])];
        const [min, max] = a <= b ? [a, b] : [b, a];
        return observed >= min && observed <= max;
      }
      default:
        return false;
    }
  }

  private describeThreshold(value: SpatialCondition["value"]): string {
    if (Array.isArray(value)) return `[${value.join(", ")}]`;
    return String(value ?? "—");
  }

  /**
   * Derives a scoring ramp from the condition's own threshold so magnitude
   * conditions grade continuously instead of snapping to 0/1. A drift rule of
   * "≥ 2km" scores 0 at 2km and 1 at 4km unless the author overrides the ramp.
   */
  private thresholdRamp(
    cond: SpatialCondition,
    observed: number,
    operator: ComparisonOperator
  ): { value: number; floor: number; ceiling: number } | undefined {
    const scoring = cond.scoring;
    if (scoring?.rampFloor != null && scoring?.rampCeiling != null) {
      return { value: observed, floor: scoring.rampFloor, ceiling: scoring.rampCeiling };
    }

    const threshold = Array.isArray(cond.value) ? Number(cond.value[0]) : Number(cond.value);
    if (!Number.isFinite(threshold)) return undefined;

    if (operator === "greater_than" || operator === "greater_than_or_equal") {
      const span = Math.abs(threshold) || 1;
      return { value: observed, floor: threshold, ceiling: threshold + span };
    }
    if (operator === "less_than" || operator === "less_than_or_equal") {
      // Lower is better: invert so that further below the threshold scores higher.
      const span = Math.abs(threshold) || 1;
      return { value: threshold - observed, floor: 0, ceiling: span };
    }
    return undefined;
  }

  // ==========================================================================
  // GEOMETRY RESOLUTION
  // ==========================================================================

  /**
   * Resolves a geometry declaration into a discrete H3 cell set, memoised.
   * Accepts an explicit cell set (from the map palette), a polygon ring, or a
   * centre + radius, in that order of precedence.
   */
  private resolveZone(geometry?: SpatialGeometry): ResolvedZone | null {
    if (!geometry) return null;

    const key = this.geometryKey(geometry);
    const cached = this.zoneCache.get(key);
    if (cached) return cached;

    let label = geometry.regionName || "target region";
    let resolution = parseH3Resolution(geometry.h3Resolution);
    let cells: string[] = [];

    if (typeof geometry.regionId === "number") {
      const region = this.regionCache.get(geometry.regionId);
      if (!region) {
        // Not hydrated, not readable, or empty. Refusing is the safe outcome:
        // returning a zone with no cells would read as `outside` and fire every
        // exclusion rule pointed at this region.
        logger.warn(
          `[SpatialPredicateEngine] Condition references region ${geometry.regionId}, ` +
            `which is not hydrated. Call hydrateRegions() before evaluate().`
        );
        return null;
      }

      if (region.minResolution !== region.maxResolution) {
        // spatial_regions stores MIXED-resolution sets on purpose — coarse
        // through the interior, fine at the boundary. ResolvedZone is
        // single-resolution, and every membership test below assumes that, so
        // collapsing the set to one resolution here would silently misplace
        // either the interior or the boundary. Three-valued containment
        // (spatial-containment.ts) is the correct reader for these; wiring it
        // through the predicate branches is a separate change.
        logger.warn(
          `[SpatialPredicateEngine] Region ${geometry.regionId} ('${region.name}') is ` +
            `mixed-resolution (res ${region.minResolution}-${region.maxResolution}). ` +
            `The single-resolution zone model cannot represent it without distorting ` +
            `the boundary, so the condition is refused rather than answered wrongly.`
        );
        return null;
      }

      cells = region.cells;
      resolution = region.maxResolution;
      label = geometry.regionName || region.name;
    } else if (geometry.h3Cells?.length) {
      cells = geometry.h3Cells.filter((c) => isValidCell(c));
      if (!cells.length) {
        logger.warn(`[SpatialPredicateEngine] Zone '${label}' declared only invalid H3 cells.`);
        return null;
      }
      // Trust the cells over the declared resolution — a mismatch between the
      // two would silently break every membership test.
      resolution = getResolution(cells[0]);
    } else if (geometry.polygon?.length) {
      try {
        cells = polygonToCells(geometry.polygon, resolution);
      } catch (err: any) {
        logger.error(`[SpatialPredicateEngine] Polygon rasterisation failed for '${label}': ${err.message}`);
        return null;
      }
    } else if (geometry.centerLat != null && geometry.centerLng != null) {
      const origin = latLngToCell(geometry.centerLat, geometry.centerLng, resolution);
      cells = gridDisk(origin, this.resolveK(geometry, resolution));
    }

    if (!cells.length) return null;

    const zone: ResolvedZone = {
      cells: new Set(cells),
      resolution,
      centerLat: geometry.centerLat ?? undefined,
      centerLng: geometry.centerLng ?? undefined,
      label,
    };
    this.zoneCache.set(key, zone);
    return zone;
  }

  private geometryKey(g: SpatialGeometry): string {
    return JSON.stringify([
      // First: a stored reference resolves to a different cell set per id, so
      // two conditions differing only by region would otherwise share a zone.
      g.regionId ?? null,
      g.regionName ?? "",
      g.h3Cells?.length ? [...g.h3Cells].sort() : null,
      g.polygon ?? null,
      g.centerLat ?? null,
      g.centerLng ?? null,
      g.h3Resolution ?? null,
      g.k ?? null,
      g.radiusKm ?? null,
    ]);
  }

  /** Converts a km radius into a k-ring count at the given resolution. */
  private resolveK(geometry: SpatialGeometry | undefined, resolution: number): number {
    if (geometry?.k != null) return Math.max(0, Math.floor(geometry.k));
    if (geometry?.radiusKm != null) {
      const edgeKm = this.approxEdgeLengthKm(resolution);
      return Math.max(0, Math.round(geometry.radiusKm / (edgeKm * 1.5)));
    }
    return 1;
  }

  /**
   * Approximate H3 edge length in km per resolution. Used only to translate a
   * user-supplied km radius into a ring count, where an approximation is fine.
   */
  private approxEdgeLengthKm(resolution: number): number {
    const EDGE_KM = [
      1107.71, 418.68, 158.24, 59.81, 22.61, 8.54, 3.23, 1.22, 0.46, 0.174, 0.0658, 0.0249,
      0.00941, 0.00356, 0.00135, 0.000509,
    ];
    return EDGE_KM[Math.min(15, Math.max(0, resolution))];
  }

  private currentCell(obs: SpatialObservation, resolution: number): string | null {
    if (obs.h3Index && isValidCell(obs.h3Index)) {
      return this.normalizeCellTo(obs.h3Index, resolution);
    }
    if (obs.latitude == null || obs.longitude == null) return null;
    return latLngToCell(obs.latitude, obs.longitude, resolution);
  }

  /**
   * Brings a cell to the zone's resolution so membership tests compare like
   * with like. A finer cell rolls up to its parent; a coarser one cannot be
   * refined without inventing precision, so it is returned unchanged and the
   * containment test handles it.
   */
  private normalizeCellTo(cell: string | null | undefined, resolution: number): string | null {
    if (!cell || !isValidCell(cell)) return null;
    const res = getResolution(cell);
    if (res === resolution) return cell;
    if (res > resolution) return cellToParent(cell, resolution);
    return cell;
  }

  private parentAt(cell: string, resolution: number): string | null {
    if (!isValidCell(cell)) return null;
    const res = getResolution(cell);
    if (resolution > res) return null;
    return resolution === res ? cell : cellToParent(cell, resolution);
  }

  private centroidDistanceKm(fromH3: string, toH3: string): number {
    return Number(
      greatCircleDistance(cellToLatLng(fromH3), cellToLatLng(toH3), UNITS.km).toFixed(4)
    );
  }

  /** Nearest great-circle distance in km from a cell to any cell of the zone. */
  private distanceToZoneKm(cell: string, zone: ResolvedZone): number | null {
    if (zone.centerLat != null && zone.centerLng != null) {
      return Number(
        greatCircleDistance(
          cellToLatLng(cell),
          [zone.centerLat, zone.centerLng],
          UNITS.km
        ).toFixed(4)
      );
    }
    let min: number | null = null;
    for (const zoneCell of zone.cells) {
      const d = this.centroidDistanceKm(cell, zoneCell);
      if (min === null || d < min) min = d;
    }
    return min;
  }

  private zoneOriginCell(zone: ResolvedZone, geometry?: SpatialGeometry): string | null {
    if (zone.centerLat != null && zone.centerLng != null) {
      return latLngToCell(zone.centerLat, zone.centerLng, zone.resolution);
    }
    if (geometry?.centerLat != null && geometry?.centerLng != null) {
      return latLngToCell(geometry.centerLat, geometry.centerLng, zone.resolution);
    }
    const first = zone.cells.values().next();
    return first.done ? null : first.value;
  }

  /**
   * Discrete cell path a trajectory traverses. Uses the real previous fix when
   * available; otherwise dead-reckons one hour ahead along the heading so a
   * first-tick signal can still be tested against a corridor.
   *
   * `gridPathCells` throws for cells that are far apart or across a pentagon;
   * the endpoints are the meaningful fallback in that case.
   */
  private trajectoryPath(obs: SpatialObservation, current: string, resolution: number): string[] {
    const previous = this.normalizeCellTo(obs.previousH3Index, resolution);

    if (previous && previous !== current) {
      try {
        return gridPathCells(previous, current);
      } catch {
        return [previous, current];
      }
    }

    if (
      obs.latitude != null &&
      obs.longitude != null &&
      obs.headingDegrees != null &&
      obs.velocityKnots != null &&
      obs.velocityKnots > 0
    ) {
      const distanceKm = obs.velocityKnots * KM_PER_KNOT_HOUR;
      const [projLat, projLng] = this.projectPosition(
        obs.latitude,
        obs.longitude,
        obs.headingDegrees,
        distanceKm
      );
      const projected = latLngToCell(projLat, projLng, resolution);
      if (projected !== current) {
        try {
          return gridPathCells(current, projected);
        } catch {
          return [current, projected];
        }
      }
    }

    return [current];
  }

  /** Great-circle forward projection along a bearing. */
  private projectPosition(
    lat: number,
    lng: number,
    headingDegrees: number,
    distanceKm: number
  ): [number, number] {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const toDeg = (r: number) => (r * 180) / Math.PI;

    const angular = distanceKm / R;
    const bearing = toRad(headingDegrees);
    const lat1 = toRad(lat);
    const lng1 = toRad(lng);

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
      );

    return [toDeg(lat2), ((toDeg(lng2) + 540) % 360) - 180];
  }

  // ==========================================================================
  // SCORING
  // ==========================================================================

  /**
   * Builds a result, applying the condition's scoring policy. When a ramp is
   * supplied the score grades linearly across it; otherwise it is the flat
   * pass/fail score.
   */
  private score(
    cond: SpatialCondition,
    passed: boolean,
    explanation: string,
    extra?: {
      observed?: number;
      unit?: string;
      ramp?: { value: number; floor: number; ceiling: number };
    }
  ): SpatialConditionResult {
    const scoring: SpatialScoringConfig = cond.scoring ?? {};
    const passScore = scoring.passScore ?? DEFAULT_SPATIAL_SCORING.passScore;
    const failScore = scoring.failScore ?? DEFAULT_SPATIAL_SCORING.failScore;

    let value = passed ? passScore : failScore;

    if (passed && extra?.ramp) {
      const graded = this.rampScore(extra.ramp.value, extra.ramp.floor, extra.ramp.ceiling);
      // The ramp grades *within* the passing band: floor of the band is the
      // fail score, top of the band is the full pass score.
      value = failScore + (passScore - failScore) * graded;
    }

    return {
      passed,
      score: Number(Math.min(1, Math.max(0, value)).toFixed(4)),
      weight: scoring.weight ?? DEFAULT_SPATIAL_SCORING.weight,
      critical: scoring.critical ?? false,
      observed: extra?.observed,
      unit: extra?.unit,
      explanation,
    };
  }

  private rampScore(value: number, floor: number, ceiling: number): number {
    if (!Number.isFinite(value)) return 0;
    if (ceiling === floor) return value >= ceiling ? 1 : 0;
    const t = (value - floor) / (ceiling - floor);
    return Math.min(1, Math.max(0, t));
  }

  private fail(cond: SpatialCondition, explanation: string): SpatialConditionResult {
    const scoring: SpatialScoringConfig = cond.scoring ?? {};
    return {
      passed: false,
      score: scoring.failScore ?? DEFAULT_SPATIAL_SCORING.failScore,
      weight: scoring.weight ?? DEFAULT_SPATIAL_SCORING.weight,
      critical: scoring.critical ?? false,
      explanation,
    };
  }

  /** Test seam: clears memoised geometry. */
  public clearCache(): void {
    this.zoneCache.clear();
  }
}

export const spatialPredicateEngine = new SpatialPredicateEngineService();
