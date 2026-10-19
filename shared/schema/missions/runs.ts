import { pgTable, serial, text, integer, timestamp, decimal, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from '../auth.js';
import { pipelines } from '../pipelines/pipeline-core.js';
import { missions } from './core.js';
import { operationalCycles } from '../operational-cycles.js';

// ============================================================================
// MISSION RUNS TABLE
// ============================================================================

export const missionRunStatuses = ["active", "paused", "waiting_on_human", "waiting_on_file", "completed", "failed"] as const;
export type MissionRunStatus = (typeof missionRunStatuses)[number];

export type ResumeCondition = {
  type: "file" | "human_approval";
  filePattern?: string;
  folderPath?: string;
  approvalRequestIds?: number[];
  selectionList?: any[];
  pipelineExecutionId?: number;
  stepId?: number;
};

export const missionRuns = pgTable("mission_runs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id),
  missionId: integer("mission_id")
    .references(() => missions.id, { onDelete: "cascade" }),
  parentId: integer("parent_id")
    .references((): any => missionRuns.id, { onDelete: "set null" }),

  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  reasoningProtocol: text("reasoning_protocol").notNull().default("json_manifest"),

  // Pipeline sequence
  currentPipelineId: integer("current_pipeline_id").references(() => pipelines.id),
  pipelineSequence: jsonb("pipeline_sequence").$type<number[]>(),
  currentStepIndex: integer("current_step_index").default(0),

  // Durable state
  missionContext: jsonb("mission_context").default({}),
  pipelineExecutionId: integer("pipeline_execution_id"),
  lastCheckpointAt: timestamp("last_checkpoint_at").defaultNow(),
  resumeCondition: jsonb("resume_condition").$type<ResumeCondition>(),
  dynamicTrace: jsonb("dynamic_trace").default([]),

  isSuccess: boolean("is_success"),
  failureReason: text("failure_reason"),
  actualMetricValue: decimal("actual_metric_value", { precision: 10, scale: 2 }),
  metricType: text("metric_type"),
  contextCoreUrl: text("context_core_url"),
  entityCount: integer("entity_count"),
  relationshipCount: integer("relationship_count"),

  cycleId: integer("cycle_id").references(() => operationalCycles.id, { onDelete: "set null" }),

  isShadow: boolean("is_shadow").default(false).notNull(),
  costUsd: decimal("cost_usd", { precision: 10, scale: 4 }).default("0"),

  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  missionIdIdx: index("mission_runs_mission_id_idx").on(table.missionId),
  pipelineExecutionIdIdx: index("mission_runs_pipeline_execution_idx").on(table.pipelineExecutionId),
  cycleStatusIdx: index("idx_mission_runs_cycle_status").on(table.cycleId, table.status),
}));

export const insertMissionRunSchema = createInsertSchema(missionRuns, {
  name: z.string().min(1),
  status: z.enum(missionRunStatuses),
  parentId: z.number().int().positive().optional().nullable(),
  isSuccess: z.boolean().optional(),
  failureReason: z.string().optional().nullable(),
  actualMetricValue: z.number().optional().nullable(),
  metricType: z.string().optional().nullable(),
  contextCoreUrl: z.string().optional().nullable(),
  entityCount: z.number().int().optional().nullable(),
  relationshipCount: z.number().int().optional().nullable(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MissionRun = typeof missionRuns.$inferSelect;
export type InsertMissionRun = typeof missionRuns.$inferInsert;

// ============================================================================
// MISSION STEP ASSIGNMENTS TABLE (Local Runner - MCP)
// ============================================================================

export const missionStepAssignmentStatuses = ["pending", "claimed", "completed", "failed"] as const;
export type MissionStepAssignmentStatus = (typeof missionStepAssignmentStatuses)[number];

export const missionStepAssignments = pgTable("mission_step_assignments", {
  id: serial("id").primaryKey(),
  missionRunId: integer("mission_run_id")
    .references(() => missionRuns.id, { onDelete: "cascade" })
    .notNull(),
  pipelineExecutionId: integer("pipeline_execution_id")
    .notNull(),
  pipelineStepId: integer("pipeline_step_id")
    .notNull(),
  organizationId: integer("organization_id").references(() => orgs.id),
  status: text("status").notNull().default("pending"),
  claimedBy: text("claimed_by"),
  claimedAt: timestamp("claimed_at"),
  completedAt: timestamp("completed_at"),
  result: jsonb("result"),
  jobType: text("job_type").notNull(),
  jobConfig: jsonb("job_config"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  missionRunIdIdx: index("mission_step_assign_run_idx").on(table.missionRunId),
  pipelineExecutionIdIdx: index("mission_step_assign_execution_idx").on(table.pipelineExecutionId),
}));

export type MissionStepAssignment = typeof missionStepAssignments.$inferSelect;
export type InsertMissionStepAssignment = typeof missionStepAssignments.$inferInsert;

// ============================================================================
// MISSION RETROSPECTIVES TABLE
// ============================================================================

export const missionRetrospectives = pgTable("mission_retrospectives", {
  id: serial("id").primaryKey(),
  missionRunId: integer("mission_run_id")
    .references(() => missionRuns.id, { onDelete: "cascade" }),

  successScore: integer("success_score"),
  budgetEfficiency: decimal("budget_efficiency", { precision: 10, scale: 2 }),
  timeEfficiency: decimal("time_efficiency", { precision: 10, scale: 2 }),
  anomaliesEncountered: jsonb("anomalies_encountered").default([]),
  learnedContext: jsonb("learned_context").default([]),

  analyzedBy: text("analyzed_by"),
  organizationId: integer("organization_id").references(() => orgs.id),
  missionId: integer("mission_id").references(() => missions.id),
  embedding: text("embedding"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  missionRunIdIdx: index("mission_retro_run_idx").on(table.missionRunId),
  missionIdIdx: index("mission_retro_mission_idx").on(table.missionId),
}));

export const insertMissionRetrospectiveSchema = createInsertSchema(missionRetrospectives);
export type MissionRetrospective = typeof missionRetrospectives.$inferSelect;
export type InsertMissionRetrospective = typeof missionRetrospectives.$inferInsert;

// ============================================================================
// MISSION SHADOW RUNS TABLE
// ============================================================================

export const missionShadowRuns = pgTable("mission_shadow_runs", {
  id: serial("id").primaryKey(),
  parentRunId: integer("parent_run_id")
    .references(() => missionRuns.id, { onDelete: "cascade" })
    .notNull(),
  status: text("status").notNull().default("active"),
  modelId: text("model_id"),
  promptVersion: text("prompt_version"),
  isSuccess: boolean("is_success").default(false),
  actualMetricValue: decimal("actual_metric_value", { precision: 10, scale: 2 }),
  metricType: text("metric_type"),
  evalScore: integer("eval_score"),
  evalReasoning: text("eval_reasoning"),
  missionContext: jsonb("mission_context").default({}),
  derivedFromShadowId: integer("derived_from_shadow_id").references((): any => missionShadowRuns.id, { onDelete: "set null" }),
  ancestorShadowIds: jsonb("ancestor_shadow_ids").default([]),
  costUsd: decimal("cost_usd", { precision: 10, scale: 4 }).default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  parentRunIdIdx: index("mission_shadow_parent_idx").on(table.parentRunId),
}));

export const insertMissionShadowRunSchema = createInsertSchema(missionShadowRuns, {
  isSuccess: z.boolean().optional(),
  actualMetricValue: z.number().optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type MissionShadowRun = typeof missionShadowRuns.$inferSelect;
export type InsertMissionShadowRun = typeof missionShadowRuns.$inferInsert;



