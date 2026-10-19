/**
 * Spatial Predicate Contract (shared frontend + backend)
 *
 * Canonical vocabulary for the H3 spatial condition surface of the GRIE rule
 * engine. The Rule Builder emits these shapes and
 * `spatial-predicate-engine.service.ts` consumes them, so this file is the
 * single source of truth for operator names.
 *
 * WHY THIS EXISTS: the Rule Builder used to emit display symbols (">=", "in")
 * while `CrispCondition` in the rule engine only accepted spelled-out names
 * ("greater_than_or_equal"). Anything built in the UI fell through the engine's
 * `default: return false` and silently never matched. `normalizeOperator()`
 * below maps both spellings onto one canonical set so the two halves agree.
 */

// ============================================================================
// 1. TEMPORAL & TRANSITION GEOFENCE TRIGGERS (state-machine edges)
// ============================================================================

export const GEOFENCE_TRIGGERS = ["ON_ENTER", "ON_EXIT", "ON_DWELL", "ON_APPROACH"] as const;
export type GeofenceTrigger = (typeof GEOFENCE_TRIGGERS)[number];

/** UI aliases → canonical trigger. */
export const GEOFENCE_TRIGGER_ALIASES: Record<string, GeofenceTrigger> = {
  enter: "ON_ENTER",
  on_enter: "ON_ENTER",
  exit: "ON_EXIT",
  on_exit: "ON_EXIT",
  dwell: "ON_DWELL",
  on_dwell: "ON_DWELL",
  proximity: "ON_APPROACH",
  approach: "ON_APPROACH",
  on_approach: "ON_APPROACH",
};

export interface GeofenceTriggerMeta {
  trigger: GeofenceTrigger;
  label: string;
  description: string;
  /** Which extra config field the UI must collect for this trigger. */
  requires?: "dwellSlaMinutes" | "approachBufferKm";
}

export const GEOFENCE_TRIGGER_CATALOG: GeofenceTriggerMeta[] = [
  {
    trigger: "ON_ENTER",
    label: "On Enter",
    description:
      "Fires the moment an asset crosses into the target geofence or H3 sector. Opens a transient (Asset)-[LOCATED_IN]->(Zone) edge and starts the dwell SLA timer.",
  },
  {
    trigger: "ON_EXIT",
    label: "On Exit",
    description:
      "Fires when an asset leaves the boundary. Evicts the transient spatial edge and records the exit velocity vector.",
  },
  {
    trigger: "ON_DWELL",
    label: "On Dwell (SLA)",
    description:
      "Fires when an entity remains inside the region longer than the SLA duration (T > T_sla). Detects congestion, idling and loitering.",
    requires: "dwellSlaMinutes",
  },
  {
    trigger: "ON_APPROACH",
    label: "On Approach (Proximity)",
    description:
      "Fires when an entity closes within a buffer distance (d < D_alert) of the perimeter, before the boundary is actually breached.",
    requires: "approachBufferKm",
  },
];

// ============================================================================
// 2. TOPOLOGICAL & CONTAINMENT PREDICATES ("there" / "not there")
// ============================================================================

export const SPATIAL_PREDICATES = [
  "there",
  "not_there",
  "contains",
  "intersects",
  "k_ring",
] as const;
export type SpatialPredicate = (typeof SPATIAL_PREDICATES)[number];

/** Synonyms accepted from the UI / imported rule JSON → canonical predicate. */
export const SPATIAL_PREDICATE_ALIASES: Record<string, SpatialPredicate> = {
  there: "there",
  in: "there",
  inside: "there",
  located_in: "there",
  within: "there",
  not_there: "not_there",
  not_in: "not_there",
  outside: "not_there",
  contains: "contains",
  encompasses: "contains",
  intersects: "intersects",
  crosses: "intersects",
  k_ring: "k_ring",
  within_radius: "k_ring",
};

export interface SpatialPredicateMeta {
  predicate: SpatialPredicate;
  label: string;
  syntax: string;
  description: string;
}

export const SPATIAL_PREDICATE_CATALOG: SpatialPredicateMeta[] = [
  {
    predicate: "there",
    label: "There / Located In",
    syntax: "in, located_in, inside",
    description:
      "True when the entity centroid resolves to a cell inside the selected H3 sector set or polygon boundary.",
  },
  {
    predicate: "not_there",
    label: "Not There / Outside",
    syntax: "not_in, outside",
    description:
      "True when the entity is outside the boundary — corridor deviations, exclusion zones, black-zone violations.",
  },
  {
    predicate: "contains",
    label: "Contains",
    syntax: "contains",
    description:
      "True when the parent zone or coarse H3 cluster encompasses the entity's cell, tested by hierarchical parent rollup.",
  },
  {
    predicate: "intersects",
    label: "Intersects / Crosses",
    syntax: "intersects, crosses",
    description:
      "True when a linear path or projected trajectory vector touches any cell of the protected geofence.",
  },
  {
    predicate: "k_ring",
    label: "K-Ring / Within Radius",
    syntax: "k=0,1,2,3 | radius_km",
    description:
      "Radial expansion around an origin cell selecting all contiguous k-ring concentric neighbours.",
  },
];

// ============================================================================
// 3. EULERIAN FLUX & VECTOR ANALYTICS
// ============================================================================

export const SPATIAL_FUNCTIONS = [
  "spatial_drift",
  "isotropic_flux_density",
  "velocity_vector",
  "centroid_distance",
  "h3_parent_zoom",
  "equidistant_neighbors",
] as const;
export type SpatialFunction = (typeof SPATIAL_FUNCTIONS)[number];

export const SPATIAL_FUNCTION_ALIASES: Record<string, SpatialFunction> = {
  spatial_drift: "spatial_drift",
  drift: "spatial_drift",
  isotropic_flux_density: "isotropic_flux_density",
  flux_density: "isotropic_flux_density",
  phi: "isotropic_flux_density",
  velocity_vector: "velocity_vector",
  speed_limit: "velocity_vector",
  speed: "velocity_vector",
  centroid_distance: "centroid_distance",
  distance: "centroid_distance",
  h3_parent_zoom: "h3_parent_zoom",
  h3_to_parent: "h3_parent_zoom",
  equidistant_neighbors: "equidistant_neighbors",
  grid_disk: "equidistant_neighbors",
};

export interface SpatialFunctionMeta {
  fn: SpatialFunction;
  label: string;
  contract: string;
  description: string;
  /** Unit of the value this function yields, for UI display next to thresholds. */
  unit: string;
}

export const SPATIAL_FUNCTION_CATALOG: SpatialFunctionMeta[] = [
  {
    fn: "spatial_drift",
    label: "Spatial Drift",
    contract: "drift = |P_actual - P_projected|",
    description:
      "Positional deviation between live telemetry and the approved mission trajectory.",
    unit: "km",
  },
  {
    fn: "isotropic_flux_density",
    label: "Isotropic Flux Density (Φ)",
    contract: "∇ · (Φ v)",
    description:
      "Congestion / risk / signal concentration across uniform 6-neighbour cells with no directional bias.",
    unit: "Φ (0-1)",
  },
  {
    fn: "velocity_vector",
    label: "Velocity Vector / Speed Limit",
    contract: "|v| ≥ v_limit",
    description: "Speed, heading and ETA acceleration within speed-regulated zones.",
    unit: "knots",
  },
  {
    fn: "centroid_distance",
    label: "Centroid Distance",
    contract: "greatCircleDistance(fromH3, toH3)",
    description: "Geodesic great-circle distance between two cell centroids.",
    unit: "km",
  },
  {
    fn: "h3_parent_zoom",
    label: "H3 Parent Zoom",
    contract: "cellToParent(h3Index, res)",
    description:
      "O(1) bitwise hierarchical rollup of dense Res 9/8 cells into macro Res 7/6 strategic sectors.",
    unit: "res",
  },
  {
    fn: "equidistant_neighbors",
    label: "Equidistant Neighbours",
    contract: "gridDisk(cell, 1)",
    description:
      "The adjacent ring of cells with uniform centroid spacing (6, or 5 at a pentagon).",
    unit: "cells",
  },
];

// ============================================================================
// 4. RELATIONAL & THRESHOLD OPERATORS
// ============================================================================

export const COMPARISON_OPERATORS = [
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "in",
  "not_in",
  "contains",
  "between",
] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

/**
 * Display symbols and legacy spellings → canonical operator.
 * The Rule Builder shows symbols; the engine switches on canonical names.
 */
export const COMPARISON_OPERATOR_ALIASES: Record<string, ComparisonOperator> = {
  "=": "equals",
  "==": "equals",
  "===": "equals",
  equals: "equals",
  is: "equals",
  "!=": "not_equals",
  "!==": "not_equals",
  "<>": "not_equals",
  not_equals: "not_equals",
  is_not: "not_equals",
  ">": "greater_than",
  greater_than: "greater_than",
  ">=": "greater_than_or_equal",
  "≥": "greater_than_or_equal",
  greater_than_or_equal: "greater_than_or_equal",
  // Plural spelling: the Rule Builder's operator dropdown emitted this value,
  // which normalised to null and made every rule using it permanently unable to
  // match. The control now emits the canonical name, but rules already saved
  // with the plural have to keep working.
  greater_than_or_equals: "greater_than_or_equal",
  gte: "greater_than_or_equal",
  "<": "less_than",
  less_than: "less_than",
  "<=": "less_than_or_equal",
  "≤": "less_than_or_equal",
  less_than_or_equal: "less_than_or_equal",
  less_than_or_equals: "less_than_or_equal",
  lte: "less_than_or_equal",
  in: "in",
  any_of: "in",
  not_in: "not_in",
  none_of: "not_in",
  contains: "contains",
  includes: "contains",
  between: "between",
  range: "between",
};

/**
 * Maps any accepted spelling of a comparison operator onto its canonical name.
 * Returns `null` for anything unrecognised so callers can fail loudly rather
 * than silently evaluating to false.
 */
export function normalizeOperator(op: string | undefined | null): ComparisonOperator | null {
  if (!op) return null;
  const key = String(op).trim().toLowerCase();
  return COMPARISON_OPERATOR_ALIASES[key] ?? null;
}

export function normalizeSpatialPredicate(p: string | undefined | null): SpatialPredicate | null {
  if (!p) return null;
  return SPATIAL_PREDICATE_ALIASES[String(p).trim().toLowerCase()] ?? null;
}

export function normalizeGeofenceTrigger(t: string | undefined | null): GeofenceTrigger | null {
  if (!t) return null;
  const key = String(t).trim();
  if ((GEOFENCE_TRIGGERS as readonly string[]).includes(key)) return key as GeofenceTrigger;
  return GEOFENCE_TRIGGER_ALIASES[key.toLowerCase()] ?? null;
}

export function normalizeSpatialFunction(f: string | undefined | null): SpatialFunction | null {
  if (!f) return null;
  return SPATIAL_FUNCTION_ALIASES[String(f).trim().toLowerCase()] ?? null;
}

/**
 * Parses the H3 resolution out of either a number or a UI label such as
 * "Res 7 (~5km)". Falls back to 7 (≈5 km district level), the platform default.
 */
export function parseH3Resolution(val: string | number | undefined | null): number {
  if (typeof val === "number") {
    return Number.isInteger(val) && val >= 0 && val <= 15 ? val : 7;
  }
  if (!val) return 7;
  const s = String(val);
  const match = s.match(/res\s*(\d+)/i) ?? s.match(/^\s*(\d+)/);
  if (match) {
    const parsed = parseInt(match[1], 10);
    if (parsed >= 0 && parsed <= 15) return parsed;
  }
  return 7;
}

// ============================================================================
// CONDITION SHAPES
// ============================================================================

/** How a spatial condition contributes to the Master Priority Score. */
export interface SpatialScoringConfig {
  /**
   * Relative weight of this condition inside the spatial score aggregate.
   * Defaults to 1. Weights are normalised across conditions, so absolute
   * magnitude does not matter — only the ratio between them.
   */
  weight?: number;
  /**
   * Score awarded when the predicate passes. Range 0-1. Defaults to 1.
   */
  passScore?: number;
  /**
   * Score awarded when the predicate fails. Range 0-1. Defaults to 0.
   * Non-zero lets a near-miss still carry partial priority.
   */
  failScore?: number;
  /**
   * When set on a magnitude condition, the score ramps linearly between
   * `rampFloor` and `rampCeiling` instead of being a binary pass/fail —
   * e.g. drift of 4 km against a 2 km floor / 10 km ceiling scores 0.25.
   */
  rampFloor?: number;
  rampCeiling?: number;
  /** Marks the condition as required: failing it zeroes the whole spatial score. */
  critical?: boolean;
}

export const DEFAULT_SPATIAL_SCORING: Required<
  Pick<SpatialScoringConfig, "weight" | "passScore" | "failScore">
> = {
  weight: 1,
  passScore: 1,
  failScore: 0,
};

// ============================================================================
// HEX TILE GROUPS
// ============================================================================

/**
 * How membership/threshold is decided across the tiles of a group.
 *
 * For a single moving asset only `any` is meaningful — it is in one cell at a
 * time. The others matter for per-tile metrics (flux density, drift, counts),
 * where a rule wants "Φ ≥ 0.7 in at least 3 tiles of the Harbour Approaches set".
 */
export const GROUP_AGGREGATIONS = ["any", "all", "majority", "at_least"] as const;
export type GroupAggregation = (typeof GROUP_AGGREGATIONS)[number];

export interface GroupAggregationMeta {
  aggregation: GroupAggregation;
  label: string;
  description: string;
}

export const GROUP_AGGREGATION_CATALOG: GroupAggregationMeta[] = [
  {
    aggregation: "any",
    label: "Any tile",
    description: "Satisfied when at least one tile in the set matches. The default for asset containment.",
  },
  {
    aggregation: "all",
    label: "Every tile",
    description: "Satisfied only when every tile in the set matches — use for saturation conditions.",
  },
  {
    aggregation: "majority",
    label: "Majority of tiles",
    description: "Satisfied when more than half the tiles in the set match.",
  },
  {
    aggregation: "at_least",
    label: "At least K tiles",
    description: "Satisfied when at least K tiles match. K is set per group.",
  },
];

/**
 * A named, reusable set of H3 tiles a condition is applied to. A group may hold
 * a single tile or many; grouping is what lets one condition speak about a
 * whole sector rather than a lone cell.
 */
export interface SpatialCellGroup {
  groupId: string;
  name: string;
  /** H3 indexes in the set. One or many. */
  cells: string[];
  /** Resolution the cells are expressed at. Derived from the cells when absent. */
  resolution?: number;
  /** How per-tile results combine into the group's verdict. Defaults to "any". */
  aggregation?: GroupAggregation;
  /** Required tile count when `aggregation` is "at_least". */
  atLeastK?: number;
  /** Relative weight of this group when a condition targets several. */
  weight?: number;
  /** Optional UI colour token so map and rule text stay visually linked. */
  colorToken?: string;
  /** Free-text operator note carried into the audit explanation. */
  note?: string;
}

/** How several groups on one condition combine. */
export const GROUP_COMBINATORS = ["any", "all"] as const;
export type GroupCombinator = (typeof GROUP_COMBINATORS)[number];

/** Per-group evaluation trace. */
export interface SpatialGroupResult {
  groupId: string;
  name: string;
  aggregation: GroupAggregation;
  passed: boolean;
  /** Tiles that matched, and the total considered. */
  matchedCells: string[];
  totalCells: number;
  /** 0-1 fraction of tiles that matched, before aggregation is applied. */
  matchRatio: number;
  weight: number;
  explanation: string;
}

// ============================================================================
// PERSISTENCE / ITERATION GATE
// ============================================================================

/**
 * Requires a condition to hold across repeated evaluations before it counts.
 *
 * WHY: a raw geofence edge flaps. GPS jitter puts an asset a few metres either
 * side of a boundary and ON_ENTER/ON_EXIT fire alternately every tick. Counting
 * N consecutive confirmations turns that noise into one clean transition, and
 * `releaseAfterMisses` adds hysteresis so it does not immediately un-latch on a
 * single stray fix.
 *
 * This is per-subject state: two vessels are tracked independently.
 */
export interface SpatialPersistenceConfig {
  /**
   * Consecutive passing evaluations required before the condition reports true.
   * 1 (default) = fire immediately, preserving today's behaviour.
   */
  requiredConsecutiveHits?: number;
  /**
   * Consecutive failures required before a latched condition releases.
   * Defaults to 1. Raising it debounces the trailing edge.
   */
  releaseAfterMisses?: number;
  /**
   * Discard accumulated progress when no evaluation is seen for this long (ms).
   * Stops a count assembled hours apart from ever "confirming".
   */
  windowMs?: number;
  /**
   * Score multiplier applied while the condition is still confirming. Lets a
   * partially-confirmed condition carry some priority instead of none.
   * Defaults to 0.
   */
  pendingScoreFactor?: number;
}

/** Confirmation progress reported back to the caller and the UI. */
export interface SpatialPersistenceState {
  /** Consecutive passes accumulated so far. */
  hits: number;
  /** Consecutive misses since the last pass. */
  misses: number;
  /** How many hits are needed to confirm. */
  required: number;
  /** True once confirmed and not yet released. */
  latched: boolean;
  /** True when the raw predicate passed but confirmation is still pending. */
  pending: boolean;
}

/** Geometry a spatial condition is evaluated against. */
export interface SpatialGeometry {
  /**
   * Named tile sets this condition applies to. When present these take
   * precedence over `h3Cells`, and each group is evaluated and scored
   * separately so the trace explains which sector matched.
   */
  cellGroups?: SpatialCellGroup[];
  /** How multiple groups combine. Defaults to "any". */
  groupCombinator?: GroupCombinator;

  /**
   * Reference to a stored `spatial_regions` row, resolved at evaluation time.
   *
   * Takes precedence over every inline field below: a rule that names a durable
   * region means the region's cell set, not a copy of it frozen into the rule.
   * Editing the region's boundary then changes every rule that references it,
   * which is the entire reason for storing areas rather than inlining them.
   *
   * The referenced region must be hydrated before the synchronous evaluation
   * pass — see `SpatialPredicateEngineService.hydrateRegions`.
   */
  regionId?: number;
  /** Human label, e.g. "Pacific Maritime Hub (Port of LA / Long Beach)". */
  regionName?: string;
  /** Explicit H3 cell set — the fast O(1) path, produced by the map palette. */
  h3Cells?: string[];
  /** H3 resolution the cell set is expressed at. */
  h3Resolution?: number;
  /** Centre point, used for k-ring / radius and approach-buffer geometry. */
  centerLat?: number;
  centerLng?: number;
  /** k-ring radius in cells (0-3+) for `k_ring`. */
  k?: number;
  /** Radius in km — alternative to `k` for `k_ring` and `ON_APPROACH`. */
  radiusKm?: number;
  /** Polygon ring [[lat, lng], ...] rasterised to cells when no set is given. */
  polygon?: Array<[number, number]>;
}

/**
 * A spatial rule condition. One shape covers all four categories; `mode`
 * selects which arm of the engine evaluates it.
 */
export interface SpatialCondition {
  type: "spatial";
  mode: "geofence_trigger" | "topological" | "flux_analytic";

  /** mode: "geofence_trigger" */
  trigger?: GeofenceTrigger;
  dwellSlaMinutes?: number;
  approachBufferKm?: number;

  /** mode: "topological" */
  predicate?: SpatialPredicate;

  /** mode: "flux_analytic" */
  fn?: SpatialFunction;
  operator?: ComparisonOperator | string;
  /** Scalar threshold, or [min, max] for `between`, or string[] for in/not_in. */
  value?: number | string | Array<number | string>;

  geometry?: SpatialGeometry;
  scoring?: SpatialScoringConfig;
  /** Iteration gate: how many confirmations before this condition counts. */
  persistence?: SpatialPersistenceConfig;
  /**
   * Stable id for this condition. Required for `persistence` to accumulate
   * against the right condition across evaluations; auto-derived when absent.
   */
  conditionId?: string;
  /** Optional display label carried through from the Rule Builder. */
  label?: string;
}

/** Per-condition evaluation trace, surfaced in the audit record and the UI. */
export interface SpatialConditionResult {
  passed: boolean;
  /** Normalised 0-1 contribution before weighting. */
  score: number;
  weight: number;
  critical: boolean;
  /** Raw measured value, when the condition measured something numeric. */
  observed?: number;
  unit?: string;
  /** Human-readable explanation of why it passed or failed. */
  explanation: string;
  /** Per-group breakdown when the condition targeted named tile sets. */
  groups?: SpatialGroupResult[];
  /** Confirmation progress when an iteration gate is configured. */
  persistence?: SpatialPersistenceState;
}

/**
 * Builds a stable group id. Exported so the Rule Builder and any importer
 * generate ids the same way.
 */
export function makeCellGroupId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `grp_${slug || "tiles"}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Resolves how many tiles must match for a group to pass.
 * Centralised so the engine and the UI preview agree exactly.
 */
export function requiredMatchCount(group: SpatialCellGroup): number {
  const total = group.cells.length;
  switch (group.aggregation ?? "any") {
    case "all":
      return total;
    case "majority":
      return Math.floor(total / 2) + 1;
    case "at_least":
      return Math.min(total, Math.max(1, group.atLeastK ?? 1));
    case "any":
    default:
      return 1;
  }
}

export interface SpatialEvaluationSummary {
  passed: boolean;
  /** Weighted aggregate across conditions, 0-1. */
  spatialScore: number;
  results: SpatialConditionResult[];
}
