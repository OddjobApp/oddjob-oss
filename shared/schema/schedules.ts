import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    integer,
    timestamp,
    boolean,
    jsonb,
    uniqueIndex,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';
import { jobs } from './jobs/table.js'; // Import directly from table to avoid circularity

// ============================================================================
// SCHEDULES TABLE
// ============================================================================

export const schedules = pgTable(
    "schedules",
    {
        id: serial("schedule_id").primaryKey(),
        name: text("name").notNull(),
        description: text("description"),
        pattern: integer("pattern").notNull(), // One of schedulePatterns
        timezone: text("timezone"),
        patternString: jsonb("pattern_string")
            .default(sql`'{}'::jsonb`)
            .notNull(),
        patternLabel: text("pattern_label"),
        // Harpy V3
        calendarId: integer("calendar_id"),
        onHolidayBehavior: text("on_holiday_behavior"), // skip, move_next, move_prev
        isActive: boolean("is_active").default(true).notNull(),
        organizationId: integer("organization_id").references(() => orgs.id),
        createdBy: text("created_by"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        orgNameUnique: uniqueIndex("schedules_org_name_unique").on(
            table.organizationId,
            table.name
        ),
    })
);

export const insertScheduleSchema = createInsertSchema(schedules).omit({
    id: true,
    createdAt: true,
}).extend({
    name: z.string().min(1, "Schedule name is required"),
    pattern: z.number().int().min(1).max(4),
    patternString: z.any(),
});

export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type Schedule = typeof schedules.$inferSelect;

// ============================================================================
// SCHEDULED JOBS TABLE
// ============================================================================

export const triggerTypes = ["Schedule", "Manual", "Webhook", "API"] as const;
export type TriggerType = (typeof triggerTypes)[number];

export const scheduledJobs = pgTable(
    "scheduled_jobs",
    {
        id: serial("scheduled_job_id").primaryKey(),
        name: text("name").notNull(),
        // Either jobId OR pipelineId should be set (not both)
        jobId: integer("job_id")
            .references(() => jobs.id, { onDelete: "cascade" }),
        pipelineId: integer("pipeline_id"), // NEW: For scheduling pipelines directly
        missionId: integer("mission_id"), // NEW: For scheduling missions/activities
        scheduleId: integer("schedule_id").references(() => schedules.id, {
            onDelete: "set null",
        }),
        priority: integer("priority").default(2).notNull(),
        isActive: boolean("is_active").default(true).notNull(),
        alertOnFailure: boolean("alert_on_failure").default(true).notNull(),
        alertOnSuccess: boolean("alert_on_success").default(false).notNull(),
        alertOnDelay: boolean("alert_on_delay").default(true).notNull(),
        delayThreshold: integer("delay_threshold").default(15).notNull(), // minutes
        maxConcurrentRuns: integer("max_concurrent_runs").default(1).notNull(),
        queueTimeout: integer("queue_timeout").default(60).notNull(), // seconds
        triggerType: text("trigger_type").default("Schedule").notNull(),
        triggerCredentialId: integer("trigger_credential_id"), // For secured webhooks
        // Retry Configuration (NEW)
        maxRetries: integer("max_retries").default(0).notNull(), // 0 = no retries
        retryDelaySeconds: integer("retry_delay_seconds").default(60).notNull(), // Delay between retries
        // Harpy V3
        catchupPolicy: text("catchup_policy"),
        parameterValues: jsonb("parameter_values"),
        slaMinutes: integer("sla_minutes"),
        escalationPolicy: jsonb("escalation_policy"),
        organizationId: integer("organization_id").references(() => orgs.id),
        createdBy: text("created_by"),
        createdByUserId: text("created_by_user_id"),
        ownerUserId: text("owner_user_id"),
        ownerOrgId: integer("owner_org_id"),
        labels: jsonb("labels")
            .default(sql`'{}'::jsonb`)
            .notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        orgNameUnique: uniqueIndex("scheduled_jobs_org_name_unique").on(
            table.organizationId,
            table.name
        ),
    })
);

export const insertScheduledJobSchema = createInsertSchema(scheduledJobs).omit({
    id: true,
    createdAt: true,
}).extend({
    name: z.string().min(1, "Scheduled job name is required"),
    jobId: z.number().int().positive().optional().nullable(),
    pipelineId: z.number().int().positive().optional().nullable(),
    missionId: z.number().int().positive().optional().nullable(),
    scheduleId: z.number().int().positive().optional().nullable(),
    priority: z.number().int().min(1).max(3).optional(),
    triggerType: z.enum(triggerTypes).optional(),
    triggerCredentialId: z.number().int().positive().optional().nullable(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    retryDelaySeconds: z.number().int().min(10).max(3600).optional(),
    labels: z.any().optional(),
});

export type InsertScheduledJob = z.infer<typeof insertScheduledJobSchema>;
export type ScheduledJob = typeof scheduledJobs.$inferSelect;

// ============================================================================
// SCHEDULE TRIGGERS TABLE
// ============================================================================

export const scheduleTriggers = pgTable("schedule_triggers", {
    id: serial("trigger_id").primaryKey(),
    scheduledJobId: integer("scheduled_job_id")
        .notNull()
        .references(() => scheduledJobs.id, { onDelete: "cascade" }),
    nextFireAt: timestamp("next_fire_at").notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
});

export const insertScheduleTriggerSchema = createInsertSchema(scheduleTriggers).omit({
    id: true,
    computedAt: true,
}).extend({
    scheduledJobId: z.number().int().positive(),
    nextFireAt: z.date(),
});

export type InsertScheduleTrigger = z.infer<typeof insertScheduleTriggerSchema>;
export type ScheduleTrigger = typeof scheduleTriggers.$inferSelect;

// ============================================================================
// RUN LOCKS TABLE
// ============================================================================

export const runLocks = pgTable("run_locks", {
    scheduledJobId: integer("scheduled_job_id")
        .primaryKey()
        .references(() => scheduledJobs.id, { onDelete: "cascade" }),
    inProgress: integer("in_progress").default(0).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRunLockSchema = createInsertSchema(runLocks).omit({
    updatedAt: true,
}).extend({
    scheduledJobId: z.number().int().positive(),
});

export type InsertRunLock = z.infer<typeof insertRunLockSchema>;
export type RunLock = typeof runLocks.$inferSelect;

// ============================================================================
// SCHEDULE EXECUTION HISTORY TABLE
// ============================================================================

export const scheduleExecutionStatuses = [
    "running",
    "completed",
    "failed",
    "retrying",
    "cancelled",
] as const;
export type ScheduleExecutionStatus = (typeof scheduleExecutionStatuses)[number];

export const scheduleExecutionHistory = pgTable("schedule_execution_history", {
    id: serial("id").primaryKey(),
    scheduledJobId: integer("scheduled_job_id")
        .notNull()
        .references(() => scheduledJobs.id, { onDelete: "cascade" }),
    triggerId: integer("trigger_id")
        .references(() => scheduleTriggers.id, { onDelete: "set null" }),
    status: text("status").notNull().default("running"), // running, completed, failed, retrying, cancelled
    scheduledFor: timestamp("scheduled_for").notNull(), // When it was scheduled to run
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    durationMs: integer("duration_ms"), // Execution duration in milliseconds
    retryCount: integer("retry_count").default(0).notNull(),
    error: text("error"), // Error message if failed
    errorDetails: jsonb("error_details"), // Full error stack/details
    result: jsonb("result"), // Execution result (success output or summary)
    executionType: text("execution_type").notNull().default("job"), // "job" or "pipeline"
    jobRunId: integer("job_run_id"), // Reference to job execution if type=job
    pipelineRunId: integer("pipeline_run_id"), // Reference to pipeline execution if type=pipeline
    organizationId: integer("organization_id").references(() => orgs.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    scheduledJobIdx: index("schedule_exec_scheduled_job_idx").on(table.scheduledJobId),
    statusIdx: index("schedule_exec_status_idx").on(table.status),
    scheduledForIdx: index("schedule_exec_scheduled_for_idx").on(table.scheduledFor),
}));

export const insertScheduleExecutionHistorySchema = createInsertSchema(scheduleExecutionHistory).omit({
    id: true,
    createdAt: true,
}).extend({
    scheduledJobId: z.number().int().positive(),
    status: z.enum(scheduleExecutionStatuses).optional(),
    scheduledFor: z.date(),
    executionType: z.enum(["job", "pipeline"]).optional(),
});

export type InsertScheduleExecutionHistory = z.infer<typeof insertScheduleExecutionHistorySchema>;
export type ScheduleExecutionHistory = typeof scheduleExecutionHistory.$inferSelect;



