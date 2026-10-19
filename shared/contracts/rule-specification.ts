/**
 * Rule Specification Contract (shared frontend + backend)
 *
 * Zod schemas for the GRIE rule payload the Rule Builder authors and
 * `subscription-rule-engine.service.ts` executes.
 *
 * WHY ZOD HERE: the specification is stored as opaque `jsonb`. Without a schema
 * at the write boundary, a malformed rule is accepted silently and only fails
 * much later inside evaluation — against live signals, where a rule that never
 * matches is indistinguishable from one that correctly declines to.
 *
 * Shared so the builder can validate before submitting and show the same errors
 * the API would return.
 */

import { z } from "zod";
import {
  COMPARISON_OPERATORS,
  GEOFENCE_TRIGGERS,
  GROUP_AGGREGATIONS,
  SPATIAL_FUNCTIONS,
  SPATIAL_PREDICATES,
} from "./spatial-predicates.js";

export const RULE_DELIVERY_MODES = ["context_only", "replan", "trigger", "gate", "notify"] as const;
export const ruleDeliveryModeSchema = z.enum(RULE_DELIVERY_MODES);

// ---------------------------------------------------------------------------
// CONDITIONS
// ---------------------------------------------------------------------------

/**
 * Crisp field comparison. `operator` accepts display symbols as well as
 * canonical names — `normalizeOperator` collapses them at evaluation time, and
 * rejecting ">=" here would break every rule the builder produces.
 */
export const crispConditionSchema = z.object({
  type: z.literal("crisp").optional(),
  field: z.string().min(1, "field is required"),
  operator: z.string().min(1, "operator is required"),
  value: z.unknown(),
});

export const fuzzyAiConditionSchema = z.object({
  type: z.literal("fuzzy_ai_eval"),
  metric: z.string().min(1),
  promptDirective: z.string().min(1, "a fuzzy condition needs a prompt directive"),
  operator: z.enum(["greater_than_or_equal", "less_than_or_equal"]),
  fuzzyThreshold: z.number().min(0).max(1),
});

export const semanticGraphConditionSchema = z.object({
  type: z.literal("semantic_graph"),
  graphOperator: z.enum([
    "CAUSAL_PATH_EXISTS",
    "GRAPH_COMMUNITY_MEMBER",
    "FIEDLER_CUT_IMPACT",
    "ONTOLOGY_IS_A",
    "NEIGHBORHOOD_DENSITY",
  ]),
  targetEntityId: z.string().optional(),
  maxHops: z.number().int().min(1).max(10).optional(),
  threshold: z.number().optional(),
});

export const temporalConditionSchema = z.object({
  type: z.literal("temporal_velocity"),
  temporalOperator: z.enum([
    "MAX_SIGNAL_AGE",
    "FREQUENCY_SPIKE",
    "TIME_PARTING_WINDOW",
    "RECENCY_DECAY_FLOOR",
  ]),
  maxAgeMinutes: z.number().min(0).optional(),
  frequencyWindowMinutes: z.number().min(0).optional(),
  minFrequencyCount: z.number().int().min(1).optional(),
  timeParting: z
    .object({
      daysOfWeek: z.array(z.number().int().min(1).max(7)).optional(),
      startHour: z.number().int().min(0).max(23).optional(),
      endHour: z.number().int().min(0).max(23).optional(),
      timezone: z.string().optional(),
    })
    .optional(),
  minRecencyDecayFloor: z.number().min(0).max(1).optional(),
});

const cellGroupSchema = z.object({
  groupId: z.string().min(1),
  name: z.string().min(1),
  cells: z.array(z.string()),
  resolution: z.number().int().min(0).max(15).optional(),
  aggregation: z.enum(GROUP_AGGREGATIONS).optional(),
  atLeastK: z.number().int().min(1).optional(),
  weight: z.number().min(0).optional(),
  colorToken: z.string().optional(),
  note: z.string().optional(),
});

const spatialGeometrySchema = z.object({
  regionName: z.string().optional(),
  cellGroups: z.array(cellGroupSchema).optional(),
  groupCombinator: z.enum(["any", "all"]).optional(),
  h3Cells: z.array(z.string()).optional(),
  h3Resolution: z.number().int().min(0).max(15).optional(),
  centerLat: z.number().min(-90).max(90).optional(),
  centerLng: z.number().min(-180).max(180).optional(),
  k: z.number().int().min(0).max(20).optional(),
  radiusKm: z.number().min(0).optional(),
  polygon: z.array(z.tuple([z.number(), z.number()])).optional(),
});

export const spatialConditionSchema = z
  .object({
    type: z.literal("spatial"),
    mode: z.enum(["geofence_trigger", "topological", "flux_analytic"]),
    trigger: z.enum(GEOFENCE_TRIGGERS).optional(),
    dwellSlaMinutes: z.number().min(0).optional(),
    approachBufferKm: z.number().min(0).optional(),
    predicate: z.enum(SPATIAL_PREDICATES).optional(),
    fn: z.enum(SPATIAL_FUNCTIONS).optional(),
    operator: z.string().optional(),
    value: z.union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))]).optional(),
    geometry: spatialGeometrySchema.optional(),
    scoring: z
      .object({
        weight: z.number().min(0).optional(),
        passScore: z.number().min(0).max(1).optional(),
        failScore: z.number().min(0).max(1).optional(),
        rampFloor: z.number().optional(),
        rampCeiling: z.number().optional(),
        critical: z.boolean().optional(),
      })
      .optional(),
    persistence: z
      .object({
        requiredConsecutiveHits: z.number().int().min(1).optional(),
        releaseAfterMisses: z.number().int().min(1).optional(),
        windowMs: z.number().optional(),
        pendingScoreFactor: z.number().min(0).max(1).optional(),
      })
      .optional(),
    conditionId: z.string().optional(),
    label: z.string().optional(),
  })
  // Each mode needs its own discriminating field. Without these checks a
  // half-configured condition saves cleanly and then silently never matches.
  .superRefine((cond, ctx) => {
    if (cond.mode === "geofence_trigger" && !cond.trigger) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trigger"],
        message: "a geofence_trigger condition requires a trigger",
      });
    }
    if (cond.mode === "topological" && !cond.predicate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["predicate"],
        message: "a topological condition requires a predicate",
      });
    }
    if (cond.mode === "flux_analytic") {
      if (!cond.fn) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fn"],
          message: "a flux_analytic condition requires a spatial function",
        });
      }
      if (cond.value === undefined || cond.value === null || cond.value === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "a flux_analytic condition requires a threshold value",
        });
      }
    }
    // `between` needs two bounds; one bound would compare against undefined.
    if (cond.operator === "between" && (!Array.isArray(cond.value) || cond.value.length < 2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "the 'between' operator requires a [min, max] pair",
      });
    }
    // Most spatial conditions are meaningless without a target region: a
    // geofence with nothing to cross, or a containment test with nothing to be
    // contained by, can never match.
    //
    // Four flux functions are the exception. `spatial_drift` compares the fix
    // against the approved trajectory, `isotropic_flux_density` and
    // `velocity_vector` read a scalar off the observation, and
    // `equidistant_neighbors` counts the neighbours of the occupied cell — all
    // measure the signal itself and never consult a zone. Requiring geometry
    // from them rejected rules the engine implements perfectly well, so
    // "drift > 2km" could not be saved from the Rule Builder at all.
    //
    // `centroid_distance` is deliberately NOT exempt: it measures distance to a
    // zone origin and returns null without one.
    const GEOMETRY_FREE_FUNCTIONS = new Set([
      "spatial_drift",
      "isotropic_flux_density",
      "velocity_vector",
      "equidistant_neighbors",
      // Reads only geometry.h3Resolution (default 6); never a cell set.
      "h3_parent_zoom",
    ]);
    const measuresObservationOnly =
      cond.mode === "flux_analytic" && !!cond.fn && GEOMETRY_FREE_FUNCTIONS.has(cond.fn);

    const geo = cond.geometry;
    const hasCells =
      (geo?.h3Cells?.length ?? 0) > 0 ||
      (geo?.cellGroups?.some((g) => g.cells.length > 0) ?? false) ||
      (geo?.polygon?.length ?? 0) > 0 ||
      (geo?.centerLat != null && geo?.centerLng != null);
    if (!hasCells && !measuresObservationOnly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["geometry"],
        message: "a spatial condition requires target geometry (tiles, polygon, or a centre point)",
      });
    }
  });

export const conditionSchema = z.union([
  spatialConditionSchema,
  fuzzyAiConditionSchema,
  semanticGraphConditionSchema,
  temporalConditionSchema,
  crispConditionSchema,
]);

// ---------------------------------------------------------------------------
// BRANCHES & RULE
// ---------------------------------------------------------------------------

export const thenActionSchema = z.object({
  deliveryMode: ruleDeliveryModeSchema,
  receiverBinding: z
    .object({
      targetType: z.string().min(1),
      targetId: z.union([z.string(), z.number()]),
      recipientName: z.string().optional(),
    })
    .optional(),
  missionBlueprint: z
    .object({
      blueprintName: z.string().min(1),
      assignedAgentRole: z.string().min(1),
      executionStyle: z.string().optional(),
      fuzzyGoalDirective: z.string().optional(),
    })
    .optional(),
});

export const ruleBranchSchema = z.object({
  branchId: z.string().min(1),
  branchName: z.string().min(1),
  matchStrategy: z.enum(["ALL", "ANY"]),
  conditions: z.array(conditionSchema),
  thenAction: thenActionSchema,
});

export const ruleSpecificationSchema = z.object({
  ruleId: z.string().min(1).max(128),
  ruleName: z.string().min(1).max(256),
  enabled: z.boolean().default(true),
  priorityWeight: z.number().int().min(0).max(100).optional(),
  ifBranch: ruleBranchSchema,
  elseIfBranches: z.array(ruleBranchSchema).optional(),
  elseBranch: z
    .object({
      thenAction: z.object({
        deliveryMode: ruleDeliveryModeSchema,
        logReason: z.string(),
      }),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// SUITES
// ---------------------------------------------------------------------------

export const EXECUTION_POLICIES = ["HIGHEST_PRIORITY_MAUF", "FIRST_MATCH", "ALL_MATCHES"] as const;

export const ruleSuiteCreateSchema = z.object({
  // Slug-shaped: it appears in URLs and must stay stable across renames.
  suiteId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/, "suiteId may contain only letters, numbers, hyphens and underscores"),
  suiteName: z.string().min(1).max(256),
  category: z.string().max(128).optional(),
  version: z.string().max(32).optional(),
  owner: z.string().max(128).optional(),
  description: z.string().max(2000).optional(),
  executionPolicy: z.enum(EXECUTION_POLICIES).optional(),
  enabled: z.boolean().optional(),
});

export const ruleSuiteUpdateSchema = ruleSuiteCreateSchema.partial().omit({ suiteId: true });

export const ruleSpecificationUpdateSchema = z.object({
  ruleName: z.string().min(1).max(256).optional(),
  enabled: z.boolean().optional(),
  priorityWeight: z.number().int().min(0).max(100).optional(),
});

export type RuleSpecificationInput = z.input<typeof ruleSpecificationSchema>;
export type RuleSpecificationParsed = z.output<typeof ruleSpecificationSchema>;
export type RuleSuiteCreateInput = z.input<typeof ruleSuiteCreateSchema>;
