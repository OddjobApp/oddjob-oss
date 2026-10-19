import { pgTable, serial, text, integer, timestamp, decimal, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from '../auth.js';
import { governorPolicies } from '../governor.js';
import { schedules } from '../schedules.js';

// ============================================================================
// JSONB COLUMN TYPES
// ============================================================================

export interface MissionBlackboard {
    // Sync
    syncStatus?: { lastSyncAt?: string; error?: string };
    // Deliverables
    expected_deliverables?: Array<{ id: string; description: string; status?: string }>;
    // Auto-context (knowledge enrichment)
    autoContext?: { entities: Array<{ id: string; name: string; type: string; [key: string]: unknown }>; [key: string]: unknown };
    // Outcome tracking
    outcome?: string;
    keyLearnings?: string[];
    // Plan
    plan?: { steps: Array<{ tool: string; arguments?: Record<string, unknown>; [key: string]: unknown }> };
    // Arbitrary extension â€” intentionally open so existing writes keep working
    [key: string]: unknown;
}

/**
 * Structured, machine-readable self-description of a mission's capability. Powers
 * agent discovery (the `discover_capabilities` tool) so a natural-language request
 * can be matched to the right mission. Auto-backfilled from the mission's
 * description/objective/deliverables via an LLM pass; may be human-edited.
 */
export interface CapabilityContract {
    purpose: string;
    whenToUse: string;
    inputs: Array<{ name: string; type: string; required: boolean; description?: string }>;
    outputs: Array<{ name: string; type: string; description?: string }>;
    examples?: string[];
    costClass?: "low" | "medium" | "high";
    generatedBy?: "auto" | "human";
    generatedAt?: string;
}

export const missionTypes = ["supervisor_led", "governed", "manual", "mission_based", "rescue"] as const;
export type MissionType = (typeof missionTypes)[number];

export const missionStatuses = ["active", "paused", "failed", "completed", "draft"] as const;
export type MissionStatus = (typeof missionStatuses)[number];

/**
 * Every strategy `mission-execution.service.ts` dispatches on.
 *
 * `llm_compiler` was dispatchable long before it appeared here — the column is
 * plain text, so an undocumented value still routed. Keep this list and that
 * dispatch chain in step: a value missing here is invisible to callers, and a
 * value here with no branch falls through to the pre-planned path.
 */
export const executionStrategies = [
    "pre_planned",
    "dynamic_autonomous",
    "rolling_wave",
    "human_driven",
    "parallel_fan_out",
    "reactive",
    "llm_compiler",
] as const;
export type ExecutionStrategy = (typeof executionStrategies)[number];

/**
 * Guards the execution path. The `execution_strategy` column is untyped text
 * with a `pre_planned` default, so without this an unrecognized value (a typo, a
 * removed strategy, a hand-edited row) silently skips every orchestrator branch
 * and runs as pre-planned — the mission appears to work while doing something
 * the caller never asked for.
 */
export function isExecutionStrategy(value: unknown): value is ExecutionStrategy {
    return typeof value === "string" && (executionStrategies as readonly string[]).includes(value);
}

// ============================================================================
// MISSIONS TABLE (Core)
// ============================================================================

export const missions = pgTable("missions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("supervisor_led"),
  organizationId: integer("organization_id").references(() => orgs.id),
  parentId: integer("parent_id").references((): any => missions.id, { onDelete: "set null" }),

  // Mission Context
  objective: text("objective"),

  // Structured self-description for agent discovery (purpose/whenToUse/inputs/
  // outputs). Auto-backfilled from description via LLM; read by discover_capabilities.
  capabilityContract: jsonb("capability_contract").$type<CapabilityContract>(),

  blackboard: jsonb("blackboard").$type<MissionBlackboard>().default({}).notNull(),

  // Resource Limits (Safety)
  budgetLimitUsd: decimal("budget_limit_usd", { precision: 10, scale: 2 }).default("5.00"),
  currentSpendUsd: decimal("current_spend_usd", { precision: 10, scale: 2 }).default("0.00"),
  governorPolicyId: integer("governor_policy_id").references(() => governorPolicies.id),
  status: text("status").notNull().default("active"),

  // Scheduling
  isScheduled: boolean("is_scheduled").default(false).notNull(),
  scheduleId: integer("schedule_id").references(() => schedules.id, { onDelete: "set null" }),

  /**
   * Secret behind POST /api/webhooks/trigger/mission/:id, mirroring
   * pipelines.triggerCredentialId. The route is public by design, and until
   * this existed the handler read `x-api-key`, checked only that it was
   * non-empty, and launched the mission — any string started anyone's mission.
   */
  triggerCredentialId: integer("trigger_credential_id"), // For secured webhooks

  // Dynamic Mission Execution. Values are validated at dispatch by
  // isExecutionStrategy(); see `executionStrategies` above for the full list.
  executionStrategy: text("execution_strategy").notNull().default("pre_planned"),
  reasoningProtocol: text("reasoning_protocol").notNull().default("json_manifest"),
  dynamicCycleBudgetLimitUsd: decimal("dynamic_cycle_budget_limit_usd", { precision: 10, scale: 2 }).default("5.00"),
  hilStrictness: text("hil_strictness").default("moderate"),
  hilNotificationChannels: jsonb("hil_notification_channels").default(['inbox']),

  // Autoresearch Benchmarking
  targetMetric: jsonb("target_metric"),
  humanSteeringNudge: text("human_steering_nudge"),
  isShadowMode: boolean("is_shadow_mode").default(false).notNull(),
  autoSynthesis: boolean("auto_synthesis").default(false).notNull(),
  recursiveOptimization: boolean("recursive_optimization").default(false).notNull(),
  evaluationConsensusThreshold: integer("evaluation_consensus_threshold").default(2).notNull(),

  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),

  // Lifecycle State
  isDraft: boolean("is_draft").default(false).notNull(),
  workflowBlueprint: jsonb("workflow_blueprint"),
  
  // Knowledge Assets (TrustGraph)
  contextCoreUrl: text("context_core_url"),
  entityCount: integer("entity_count"),
  relationshipCount: integer("relationship_count"),
  
  // Software Development Context (Phase 13)
  workspacePath: text("workspace_path"),
  vcsConfig: jsonb("vcs_config").default({}).notNull(), // { branch: string, remote: string, stack: string[] }
  isXRayIndexed: boolean("is_xray_indexed").default(false).notNull(),

  // Template lineage â€” set when the mission was instantiated from a
  // mission_templates row. Drives the post-run template revision proposals
  // (see template-revision.service.ts).
  sourceTemplateId: integer("source_template_id"),

  // External ticket traceability (e.g., Jira key for DORA metrics)
  externalTicketId: text("external_ticket_id"),
}, (table) => [
  index("idx_missions_organization_id").on(table.organizationId),
  index("idx_missions_deleted_at").on(table.deletedAt),
  index("idx_missions_source_template_id").on(table.sourceTemplateId),
  index("idx_missions_ticket").on(table.externalTicketId),
]);

export type Mission = typeof missions.$inferSelect;
export type InsertMission = typeof missions.$inferInsert;

export const insertMissionSchema = createInsertSchema(missions, {
  name: z.string().min(1),
  type: z.enum(missionTypes),
  isScheduled: z.boolean().optional(),
  scheduleId: z.number().int().positive().optional().nullable(),
  executionStrategy: z.string().optional(),
  reasoningProtocol: z.string().optional(),
  dynamicCycleBudgetLimitUsd: z.coerce.number().min(0).optional(),
  hilStrictness: z.enum(["lenient", "moderate", "strict"]).optional(),
  hilNotificationChannels: z.array(z.string()).optional(),
  targetMetric: z.record(z.any()).optional().nullable(),
  humanSteeringNudge: z.string().optional().nullable(),
  isShadowMode: z.boolean().optional(),
  autoSynthesis: z.boolean().optional(),
  recursiveOptimization: z.boolean().optional(),
  evaluationConsensusThreshold: z.number().int().min(1).optional(),
  workspacePath: z.string().optional().nullable(),
  vcsConfig: z.record(z.any()).optional(),
  isXRayIndexed: z.boolean().optional(),
  isDraft: z.boolean().optional(),
  workflowBlueprint: z.record(z.any()).optional().nullable(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const missionMemberRoles = ["primary_strategist", "member", "critic", "gatekeeper", "observer"] as const;
export type MissionMemberRole = (typeof missionMemberRoles)[number];

// ============================================================================
// MISSION MEMBERS TABLE
// ============================================================================

export const missionMembers = pgTable("mission_members", {
  id: serial("id").primaryKey(),
  missionId: integer("mission_id")
    .references(() => missions.id, { onDelete: "cascade" })
    .notNull(),

  entityType: text("entity_type").notNull(), // 'pipeline', 'job'
  entityId: integer("entity_id").notNull(),

  role: text("role").notNull().default("member"),
  status: text("status").notNull().default("active"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_mission_members_mission_id").on(table.missionId),
  index("idx_mission_members_entity").on(table.entityType, table.entityId),
]);

export const insertMissionMemberSchema = createInsertSchema(missionMembers, {
  role: z.enum(missionMemberRoles),
  entityType: z.enum(["pipeline", "job"]),
}).omit({
  id: true,
  createdAt: true,
});

export type MissionMember = typeof missionMembers.$inferSelect;
export type InsertMissionMember = typeof missionMembers.$inferInsert;

// ============================================================================
// MISSION BLACKBOARD HISTORY TABLE
// ============================================================================

export const missionBlackboardHistory = pgTable("mission_blackboard_history", {
  id: serial("id").primaryKey(),
  missionId: integer("mission_id")
    .references(() => missions.id, { onDelete: "cascade" })
    .notNull(),
  missionRunId: integer("mission_run_id"),

  // The state of the blackboard at this point in time
  blackboard: jsonb("blackboard").notNull(),

  // Who made the change?
  changedBy: text("changed_by").notNull(),
  changeReason: text("change_reason"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_blackboard_history_mission_id").on(table.missionId),
]);

export type MissionBlackboardHistory = typeof missionBlackboardHistory.$inferSelect;



