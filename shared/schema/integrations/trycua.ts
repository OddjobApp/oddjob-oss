import { sql } from "drizzle-orm";
import {
    index,
    integer,
    boolean,
    jsonb,
    pgTable,
    serial,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";
import { orgs } from "../auth.js";

export const trycuaSessions = pgTable("trycua_sessions", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull().default("mock"),
    providerSessionId: text("provider_session_id"),
    os: text("os").notNull().default("linux"),
    sandboxName: text("sandbox_name"),
    status: text("status").notNull().default("provisioning"),
    missionRunId: integer("mission_run_id"),
    jobId: integer("job_id"),
    actionCount: integer("action_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    terminatedAt: timestamp("terminated_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    orgStatusIdx: index("idx_trycua_sessions_org_status").on(table.organizationId, table.status),
    userTimeIdx: index("idx_trycua_sessions_user_time").on(table.userId, table.createdAt),
    expiresIdx: index("idx_trycua_sessions_expires").on(table.expiresAt),
}));

export const trycuaSessionEvents = pgTable("trycua_session_events", {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
        .notNull()
        .references(() => trycuaSessions.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    eventType: text("event_type").notNull(),
    action: text("action"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    success: boolean("success").notNull().default(true),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    sessionTimeIdx: index("idx_trycua_events_session_time").on(table.sessionId, table.createdAt),
    orgTimeIdx: index("idx_trycua_events_org_time").on(table.organizationId, table.createdAt),
}));

export const trycuaComputerUseTasks = pgTable("trycua_computer_use_tasks", {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
        .notNull()
        .references(() => trycuaSessions.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    status: text("status").notNull().default("queued"),
    task: text("task").notNull(),
    maxSteps: integer("max_steps").notNull().default(5),
    stepCount: integer("step_count").notNull().default(0),
    requireConfirmation: boolean("require_confirmation").notNull().default(true),
    allowSensitive: boolean("allow_sensitive").notNull().default(false),
    needsConfirmation: boolean("needs_confirmation").notNull().default(false),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    error: text("error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    orgStatusIdx: index("idx_trycua_tasks_org_status").on(table.organizationId, table.status),
    sessionTimeIdx: index("idx_trycua_tasks_session_time").on(table.sessionId, table.createdAt),
    userTimeIdx: index("idx_trycua_tasks_user_time").on(table.userId, table.createdAt),
}));

export const trycuaComputerUseTaskSteps = pgTable("trycua_computer_use_task_steps", {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
        .notNull()
        .references(() => trycuaComputerUseTasks.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
        .notNull()
        .references(() => trycuaSessions.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    stepNumber: integer("step_number").notNull(),
    phase: text("phase").notNull(),
    status: text("status").notNull(),
    decision: text("decision"),
    action: text("action"),
    observation: jsonb("observation").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    plan: jsonb("plan").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    // Unique: a step number is allocated by the task counter's own UPDATE ...
    // RETURNING, and the database is what makes two concurrent recordings unable
    // to claim the same number. Migration 0129 skips the constraint where
    // duplicates already exist rather than failing the boot.
    taskStepIdx: uniqueIndex("idx_trycua_task_steps_task_step_unq").on(table.taskId, table.stepNumber),
    sessionTimeIdx: index("idx_trycua_task_steps_session_time").on(table.sessionId, table.createdAt),
    orgTimeIdx: index("idx_trycua_task_steps_org_time").on(table.organizationId, table.createdAt),
}));

export type TrycuaSessionRow = typeof trycuaSessions.$inferSelect;
export type InsertTrycuaSession = typeof trycuaSessions.$inferInsert;
export type TrycuaSessionEventRow = typeof trycuaSessionEvents.$inferSelect;
export type TrycuaComputerUseTaskRow = typeof trycuaComputerUseTasks.$inferSelect;
export type InsertTrycuaComputerUseTask = typeof trycuaComputerUseTasks.$inferInsert;
export type TrycuaComputerUseTaskStepRow = typeof trycuaComputerUseTaskSteps.$inferSelect;
export type InsertTrycuaComputerUseTaskStep = typeof trycuaComputerUseTaskSteps.$inferInsert;

/**
 * A person's actions in the desktop's browser, captured over CDP during a takeover (or a
 * manual recording). Raw material for a skill; values typed into password and one-time
 * code fields are never stored.
 */
export const computerUseRecordings = pgTable("computer_use_recordings", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    taskId: uuid("task_id").references(() => trycuaComputerUseTasks.id, { onDelete: "set null" }),
    /** recording | stopped | discarded | converted */
    status: text("status").notNull().default("recording"),
    /** manual | takeover */
    trigger: text("trigger").notNull().default("manual"),
    startUrl: text("start_url"),
    steps: jsonb("steps").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
    stepCount: integer("step_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    orgTimeIdx: index("idx_computer_use_recordings_org_time").on(table.organizationId, table.createdAt),
}));

/**
 * A reusable computer-use skill: replayable browser steps with named inputs and secret
 * slots, plus a written procedure the Gemini loop follows when a step no longer matches.
 * Created as a draft from a recording; only `active` skills are matched and replayed.
 */
export const computerUseSkills = pgTable("computer_use_skills", {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** Lowercased hostname the skill runs on, e.g. "www.linkedin.com". */
    site: text("site"),
    /** The task text it was recorded for; matched against new goals. */
    goalExample: text("goal_example"),
    inputs: jsonb("inputs").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
    steps: jsonb("steps").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
    procedure: text("procedure").notNull().default(""),
    /** draft | active | archived */
    status: text("status").notNull().default("draft"),
    riskClass: text("risk_class").notNull().default("medium"),
    sourceRecordingId: uuid("source_recording_id").references(() => computerUseRecordings.id, { onDelete: "set null" }),
    createdBy: text("created_by").notNull(),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    successCount: integer("success_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    orgStatusSiteIdx: index("idx_computer_use_skills_org_status_site").on(table.organizationId, table.status, table.site),
}));

export type ComputerUseRecordingRow = typeof computerUseRecordings.$inferSelect;
export type ComputerUseSkillRow = typeof computerUseSkills.$inferSelect;

/**
 * Reflexion self-healing episodic memory buffer.
 *
 * Implements Noah Shinn's Reflexion loop for Playwright/CUA replay.
 * Stores episodic verbal critiques, DOM failure signatures, and proposed remediations
 * when candidate locators drift, timeout, or become occluded by modals/overlays.
 */
export const computerUseReflexionBuffer = pgTable("computer_use_reflexion_buffer", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
        .references(() => computerUseSkills.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    site: text("site").notNull(),
    failureCategory: text("failure_category").notNull(), // 'locator_timeout' | 'modal_blocked' | 'element_detached' | 'validation_error' | 'auth_gate' | 'unknown'
    domFailureSignature: text("dom_failure_signature").notNull(),
    verbalCritique: text("verbal_critique").notNull(),
    proposedRemediation: jsonb("proposed_remediation").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    trialCount: integer("trial_count").notNull().default(1),
    succeededOnNextTrial: boolean("succeeded_on_next_trial"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
    skillStepIdx: index("idx_reflexion_skill_step").on(table.skillId, table.stepIndex),
    siteSigIdx: index("idx_reflexion_site_sig").on(table.site, table.domFailureSignature),
    orgSiteIdx: index("idx_reflexion_org_site").on(table.organizationId, table.site),
}));

export type ComputerUseReflexionBufferRow = typeof computerUseReflexionBuffer.$inferSelect;
export type InsertComputerUseReflexionBuffer = typeof computerUseReflexionBuffer.$inferInsert;

