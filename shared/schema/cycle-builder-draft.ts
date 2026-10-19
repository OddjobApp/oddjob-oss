import { z } from "zod";

export const CYCLE_BUILDER_SCHEMA_VERSION = "1.0.0" as const;

const stableIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Expected a stable identifier");

const nonEmptyNameSchema = z.string().trim().min(1).max(255);

export const cyclePhaseTypeSchema = z.enum(["mission", "prediction", "milestone"]);
export type CyclePhaseType = z.infer<typeof cyclePhaseTypeSchema>;

export const cycleTimeUnitSchema = z.enum([
  "milliseconds",
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
]);
export type CycleTimeUnit = z.infer<typeof cycleTimeUnitSchema>;

export const cycleDurationSchema = z.object({
  value: z.number().finite().nonnegative(),
  unit: cycleTimeUnitSchema,
});

export const cycleOffsetSchema = z.object({
  direction: z.enum(["plus", "minus"]).default("plus"),
  value: z.number().finite().nonnegative(),
  unit: cycleTimeUnitSchema,
});

export const cycleBuilderTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({
    type: z.literal("schedule"),
    cron: z.string().trim().min(1),
    timezone: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("interval"),
    every: cycleDurationSchema.refine((duration) => duration.value > 0, {
      message: "Interval duration must be greater than zero",
    }),
  }),
  z.object({
    type: z.literal("webhook"),
    eventType: z.string().trim().min(1),
  }),
]);

export const cycleNotificationEventSchema = z.enum([
  "phase_blocked",
  "mission_failed",
  "approval_required",
  "schedule_breach",
  "budget_breach",
  "cycle_paused",
  "cycle_completed",
]);

export const cycleNotificationPolicySchema = z.object({
  enabled: z.boolean().default(false),
  ownerUserId: stableIdSchema.optional(),
  offlineEscalation: z.object({
    enabled: z.boolean().default(false),
    channels: z.array(z.enum(["slack", "agentmail"])).min(1).max(2).default(["slack", "agentmail"]),
    eventTypes: z.array(cycleNotificationEventSchema).min(1).default([
      "phase_blocked",
      "mission_failed",
      "approval_required",
      "schedule_breach",
      "budget_breach",
    ]),
    minimumSeverity: z.enum(["low", "medium", "high", "critical"]).default("high"),
    acknowledgementWindowMinutes: z.number().int().min(1).max(43_200).default(60),
    escalationUserId: stableIdSchema.optional(),
    deliveryMode: z.enum(["policy_governed", "approval_required"]).default("policy_governed"),
    includeEvidenceSummary: z.boolean().default(false),
  }).default({}),
});

export const cycleInputSchema = z.object({
  id: stableIdSchema,
  key: nonEmptyNameSchema,
  label: nonEmptyNameSchema,
  description: z.string().max(2_000).optional(),
  valueType: z.enum(["string", "number", "boolean", "object", "array", "file", "url"]),
  required: z.boolean().default(true),
  defaultValue: z.unknown().optional(),
});

export const cycleResourceSchema = z.object({
  id: stableIdSchema,
  key: nonEmptyNameSchema,
  label: nonEmptyNameSchema,
  description: z.string().max(2_000).optional(),
  type: z.enum([
    "text",
    "url_list",
    "dataset",
    "credential",
    "number",
    "integration",
    "form_agent",
    "workbench_app",
    "pipeline_output",
  ]),
  required: z.boolean().default(true),
  binding: z
    .object({
      provider: z.string().trim().min(1).optional(),
      referenceId: z.string().trim().min(1).optional(),
    })
    .optional(),
});

export const phasePortSchema = z.object({
  key: nonEmptyNameSchema,
  label: nonEmptyNameSchema.optional(),
  valueType: z.enum(["string", "number", "boolean", "object", "array", "file", "url", "any"]),
  required: z.boolean().default(true),
  description: z.string().max(2_000).optional(),
});

const phaseBaseSchema = z.object({
  id: stableIdSchema,
  name: nonEmptyNameSchema,
  objective: z.string().trim().min(1).max(10_000),
  groupId: stableIdSchema.optional(),
  ownerAgentId: stableIdSchema.optional(),
  capabilityId: stableIdSchema.optional(),
  estimatedDuration: cycleDurationSchema,
  scheduledStart: cycleDurationSchema.optional(),
  inputs: z.array(phasePortSchema).default([]),
  outputs: z.array(phasePortSchema).default([]),
  timeout: cycleDurationSchema.optional(),
  retryPolicy: z
    .object({
      maxAttempts: z.number().int().min(1).max(100).default(1),
      backoff: cycleDurationSchema.optional(),
    })
    .optional(),
  budgetLimitUsd: z.number().finite().nonnegative().optional(),
  appStep: z
    .object({
      appId: z.union([z.number().int().positive(), stableIdSchema]),
      appName: nonEmptyNameSchema,
      deploymentId: z.number().int().positive().optional(),
      releaseRef: nonEmptyNameSchema.optional(),
      isPublished: z.literal(true).optional(),
      launchHref: z.string().trim().min(1).optional(),
      mode: z.enum(["open_and_wait", "run_headless", "review_output"]).default("open_and_wait"),
      outputPortKey: nonEmptyNameSchema.optional(),
    })
    .optional(),
  tools: z.array(z.string().trim().min(1)).default([]),
  permissions: z.array(z.string().trim().min(1)).default([]),
  config: z.record(z.unknown()).default({}),
});

export const missionPhaseSchema = phaseBaseSchema.extend({
  type: z.literal("mission"),
  failurePolicy: z.enum(["fail_cycle", "continue", "branch", "manual_intervention"]).default("fail_cycle"),
});

export const predictionPhaseSchema = phaseBaseSchema.extend({
  type: z.literal("prediction"),
  prediction: z.object({
    target: z.string().trim().min(1),
    confidenceThreshold: z.number().min(0).max(1).optional(),
    lowConfidenceBehavior: z.enum(["continue", "branch", "manual_review"]).default("manual_review"),
  }),
});

export const milestonePhaseSchema = phaseBaseSchema.extend({
  type: z.literal("milestone"),
  estimatedDuration: z.object({
    value: z.literal(0),
    unit: cycleTimeUnitSchema,
  }),
  milestone: z.object({
    pauseForApproval: z.boolean().default(false),
    approverPolicyId: stableIdSchema.optional(),
    evidenceRequired: z.array(z.string().trim().min(1)).default([]),
    timeoutBehavior: z.enum(["fail_cycle", "continue", "branch", "escalate"]).default("escalate"),
  }),
});

export const cyclePhaseSchema = z.discriminatedUnion("type", [
  missionPhaseSchema,
  predictionPhaseSchema,
  milestonePhaseSchema,
]);
export type CyclePhase = z.infer<typeof cyclePhaseSchema>;

export const cycleStageGroupSchema = z.object({
  id: stableIdSchema,
  name: nonEmptyNameSchema,
  description: z.string().max(2_000).optional(),
  orchestrationHint: z.enum(["parallel", "sequential", "gated", "mixed"]).default("mixed"),
  order: z.number().int().nonnegative(),
});

export const dependencyTypeSchema = z.enum([
  "finish_to_start",
  "start_to_start",
  "finish_to_finish",
  "start_to_finish",
]);

export const cycleDependencyEdgeSchema = z.object({
  id: stableIdSchema,
  sourcePhaseId: stableIdSchema,
  targetPhaseId: stableIdSchema,
  type: dependencyTypeSchema.default("finish_to_start"),
  offset: cycleOffsetSchema.optional(),
});

export const cycleOutcomeEdgeSchema = z.object({
  id: stableIdSchema,
  sourcePhaseId: stableIdSchema,
  targetPhaseId: stableIdSchema,
  outcome: z.enum(["success", "failure", "approved", "rejected", "condition"]),
  condition: z.string().trim().min(1).optional(),
});

export const dataEndpointSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cycle_input"),
    inputId: stableIdSchema,
  }),
  z.object({
    kind: z.literal("resource"),
    resourceId: stableIdSchema,
  }),
  z.object({
    kind: z.literal("phase_output"),
    phaseId: stableIdSchema,
    portKey: nonEmptyNameSchema,
  }),
]);

export const cycleDataEdgeSchema = z.object({
  id: stableIdSchema,
  source: dataEndpointSchema,
  target: z.object({
    phaseId: stableIdSchema,
    portKey: nonEmptyNameSchema,
  }),
  transform: z.string().trim().min(1).optional(),
});

export const cycleBuilderViewStateSchema = z.object({
  activeView: z.enum(["timeline", "flow", "data", "definition"]).default("timeline"),
  phasePositions: z
    .record(
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
      }),
    )
    .default({}),
  collapsedGroupIds: z.array(stableIdSchema).default([]),
  timelineUnit: cycleTimeUnitSchema.default("hours"),
});

export const cycleBuilderDraftSchema = z
  .object({
    schemaVersion: z.literal(CYCLE_BUILDER_SCHEMA_VERSION),
    id: stableIdSchema,
    organizationId: z.number().int().positive(),
    ownerUserId: stableIdSchema,
    source: z
      .object({
        type: z.enum(["blank", "prompt", "template", "duplicate", "edit"]),
        sourceId: stableIdSchema.optional(),
      })
      .default({ type: "blank" }),
    sourceRevision: z
      .object({
        cycleId: z.number().int().positive(),
        updatedAt: z.string().datetime(),
        status: z.string().trim().min(1),
      })
      .optional(),
    cycle: z.object({
      name: nonEmptyNameSchema,
      description: z.string().max(5_000).optional(),
      objective: z.string().trim().min(1).max(10_000),
      timezone: z.string().trim().min(1).default("UTC"),
      trigger: cycleBuilderTriggerSchema.default({ type: "manual" }),
      priority: z.number().int().min(0).max(10).default(5),
      budgetLimitUsd: z.number().finite().nonnegative().optional(),
      tokenLimit: z.number().int().nonnegative().optional(),
      requiresApproval: z.boolean().default(false),
      scheduling: z
        .object({
          mode: z.enum(["once", "yearly", "monthly", "weekly", "daily", "hourly", "on_complete"]).default("once"),
          enabled: z.boolean().default(false),
          anchorAt: z.string().datetime().nullable().optional(),
          nextRunAt: z.string().datetime().nullable().optional(),
          timezone: z.string().trim().min(1).default("UTC"),
          overlapPolicy: z.enum(["skip", "buffer_one", "allow_all"]).default("skip"),
          pauseOnFailure: z.boolean().default(true),
          catchupWindowSeconds: z.number().int().nonnegative().default(86_400),
          cooldownMinutes: z.number().int().nonnegative().default(1),
          maxConsecutiveRuns: z.number().int().positive().default(25),
          ganttResetAt: z.string().datetime().nullable().optional(),
        })
        .optional(),
      followUpCycleTemplateId: z.number().int().positive().nullable().optional(),
      timeUnit: z.enum(["ms", "s", "m", "h", "d", "w", "M"]).default("d"),
      resourceAnswers: z.record(z.record(z.string())).default({}),
      changeReason: z.string().trim().max(2_000).optional(),
      tags: z.array(z.string().trim().min(1)).default([]),
      notificationPolicy: cycleNotificationPolicySchema.optional(),
    }),
    groups: z.array(cycleStageGroupSchema).default([]),
    phases: z.array(cyclePhaseSchema).min(1),
    dependencyEdges: z.array(cycleDependencyEdgeSchema).default([]),
    outcomeEdges: z.array(cycleOutcomeEdgeSchema).default([]),
    dataEdges: z.array(cycleDataEdgeSchema).default([]),
    inputs: z.array(cycleInputSchema).default([]),
    resources: z.array(cycleResourceSchema).default([]),
    view: cycleBuilderViewStateSchema.default({}),
    readiness: z
      .object({
        validation: z.enum(["unchecked", "invalid", "valid"]).default("unchecked"),
        test: z.enum(["not_run", "failed", "passed"]).default("not_run"),
        lastTestedAt: z.string().datetime().optional(),
      })
      .default({}),
  })
  .superRefine((draft, context) => {
    const ensureUnique = (values: string[], path: (string | number)[], label: string) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate ${label}: ${value}`,
            path: [...path, index, "id"],
          });
        }
        seen.add(value);
      });
    };

    ensureUnique(draft.groups.map((group) => group.id), ["groups"], "group id");
    ensureUnique(draft.phases.map((phase) => phase.id), ["phases"], "phase id");
    ensureUnique(draft.inputs.map((input) => input.id), ["inputs"], "input id");
    ensureUnique(draft.resources.map((resource) => resource.id), ["resources"], "resource id");
    ensureUnique(
      [...draft.dependencyEdges, ...draft.outcomeEdges, ...draft.dataEdges].map((edge) => edge.id),
      ["edges"],
      "edge id",
    );

    const phaseIds = new Set(draft.phases.map((phase) => phase.id));
    const groupIds = new Set(draft.groups.map((group) => group.id));
    const inputIds = new Set(draft.inputs.map((input) => input.id));
    const resourceIds = new Set(draft.resources.map((resource) => resource.id));
    const phaseById = new Map(draft.phases.map((phase) => [phase.id, phase]));

    draft.phases.forEach((phase, index) => {
      if (phase.groupId && !groupIds.has(phase.groupId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown group: ${phase.groupId}`,
          path: ["phases", index, "groupId"],
        });
      }

      const portKeys = phase.inputs.map((port) => port.key);
      if (new Set(portKeys).size !== portKeys.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Phase input keys must be unique",
          path: ["phases", index, "inputs"],
        });
      }
    });

    const validatePhaseEdge = (
      edge: { sourcePhaseId: string; targetPhaseId: string },
      path: "dependencyEdges" | "outcomeEdges",
      index: number,
    ) => {
      if (!phaseIds.has(edge.sourcePhaseId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown source phase: ${edge.sourcePhaseId}`,
          path: [path, index, "sourcePhaseId"],
        });
      }
      if (!phaseIds.has(edge.targetPhaseId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown target phase: ${edge.targetPhaseId}`,
          path: [path, index, "targetPhaseId"],
        });
      }
      if (edge.sourcePhaseId === edge.targetPhaseId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A phase cannot connect to itself",
          path: [path, index],
        });
      }
    };

    draft.dependencyEdges.forEach((edge, index) =>
      validatePhaseEdge(edge, "dependencyEdges", index),
    );

    const dependencyTargets = new Map<string, string[]>();
    draft.dependencyEdges.forEach((edge) => {
      if (!phaseIds.has(edge.sourcePhaseId) || !phaseIds.has(edge.targetPhaseId)) return;
      const targets = dependencyTargets.get(edge.sourcePhaseId) ?? [];
      targets.push(edge.targetPhaseId);
      dependencyTargets.set(edge.sourcePhaseId, targets);
    });
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasDependencyCycle = (phaseId: string): boolean => {
      if (visiting.has(phaseId)) return true;
      if (visited.has(phaseId)) return false;
      visiting.add(phaseId);
      for (const targetId of dependencyTargets.get(phaseId) ?? []) {
        if (hasDependencyCycle(targetId)) return true;
      }
      visiting.delete(phaseId);
      visited.add(phaseId);
      return false;
    };
    if (draft.phases.some((phase) => hasDependencyCycle(phase.id))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dependency edges must form an acyclic graph",
        path: ["dependencyEdges"],
      });
    }

    draft.outcomeEdges.forEach((edge, index) => {
      validatePhaseEdge(edge, "outcomeEdges", index);
      if (edge.outcome === "condition" && !edge.condition) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Conditional outcome edges require a condition",
          path: ["outcomeEdges", index, "condition"],
        });
      }
    });

    draft.dataEdges.forEach((edge, index) => {
      if (edge.source.kind === "cycle_input" && !inputIds.has(edge.source.inputId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown Cycle input: ${edge.source.inputId}`,
          path: ["dataEdges", index, "source", "inputId"],
        });
      }
      if (edge.source.kind === "resource" && !resourceIds.has(edge.source.resourceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown resource: ${edge.source.resourceId}`,
          path: ["dataEdges", index, "source", "resourceId"],
        });
      }
      if (edge.source.kind === "phase_output") {
        const phaseOutputSource = edge.source;
        const sourcePhase = phaseById.get(phaseOutputSource.phaseId);
        if (!sourcePhase) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown source phase: ${phaseOutputSource.phaseId}`,
            path: ["dataEdges", index, "source", "phaseId"],
          });
        } else if (!sourcePhase.outputs.some((port) => port.key === phaseOutputSource.portKey)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Unknown source output: ${phaseOutputSource.portKey}`,
            path: ["dataEdges", index, "source", "portKey"],
          });
        }
      }

      const targetPhase = phaseById.get(edge.target.phaseId);
      if (!targetPhase) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown target phase: ${edge.target.phaseId}`,
          path: ["dataEdges", index, "target", "phaseId"],
        });
      } else if (!targetPhase.inputs.some((port) => port.key === edge.target.portKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown target input: ${edge.target.portKey}`,
          path: ["dataEdges", index, "target", "portKey"],
        });
      }
    });
  });

export type CycleBuilderDraft = z.infer<typeof cycleBuilderDraftSchema>;
