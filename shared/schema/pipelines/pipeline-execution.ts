import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    boolean,
    timestamp,
    integer,
    jsonb,
    varchar,
    decimal,
    index,
} from "drizzle-orm/pg-core";
import { z } from "zod";
import { pipelines } from './pipeline-core.js';
import { pipelineSteps } from './pipeline-steps.js';
import { jobs } from '../jobs/table.js';
import { orgs, users } from '../auth.js';
import { missions } from '../missions/core.js';
import { missionRuns } from '../missions/runs.js';

export const pipelineExecutionStatuses = [
    "running",
    "completed",
    "failed",
    "cancelled",
    "timeout",
    "waiting_async",
    "waiting_external_input",
] as const;
export type PipelineExecutionStatus = (typeof pipelineExecutionStatuses)[number];

export const pipelineExecutions = pgTable("pipeline_executions", {
    id: serial("id").primaryKey(),
    runUuid: text("run_uuid")
        .default(sql`gen_random_uuid()`)
        .notNull(), // UUID type, will be handled by drizzle
    pipelineId: integer("pipeline_id")
        .notNull()
        .references(() => pipelines.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // One of pipelineExecutionStatuses
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    cancelledAt: timestamp("cancelled_at"), // Harpy V3
    error: text("error"),
    organizationId: integer("organization_id").references(() => orgs.id),
    createdBy: text("created_by").notNull(),
    // Slice 22: Rerun support
    startStepId: integer("start_step_id"), // Step ID to start rerun from (null for normal execution)
    // Loopbane Protocols: Doomsday Clock
    ttl: integer("ttl"), // Time to live in seconds (nullable)
    // Distributed Tracing
    traceId: varchar("trace_id", { length: 32 }),
    samplingRate: decimal("sampling_rate", { precision: 3, scale: 2 }).default("1.00"),
    traceSource: varchar("trace_source", { length: 20 }), // 'manual' | 'schedule' | 'webhook' | 'api'
    lastHeartbeat: timestamp("last_heartbeat"),
    // Hierarchical Execution (Supervisor Pattern)
    parentExecutionId: integer("parent_execution_id"),
    // Mission Integration
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "set null" }),
    missionRunId: integer("mission_run_id").references(() => missionRuns.id, { onDelete: "set null" }),
    // Optimistic Locking (Slice 25 Hardening)
    version: integer("version").default(1).notNull(),
    // Durable State Snapshotting
    contextSnapshot: jsonb("context_snapshot"),
    isShadow: boolean("is_shadow").default(false).notNull(),
    // Dynamic ETC tracking
    estimatedTimeRemainingMs: integer("estimated_time_remaining_ms"),
    lastEtcCalculationAt: timestamp("last_etc_calculation_at"),
    // Workflow lifecycle: which release/deployment this run was started under.
    // Plain integers, no FK — an FK to workflow_releases would pull the
    // workflows schema into the pipelines module's import cycle.
    workflowReleaseId: integer("workflow_release_id"),
    workflowDeploymentId: integer("workflow_deployment_id"),
    deletedAt: timestamp("deleted_at"),
}, (table) => ({
    statusIdx: index("pipeline_executions_status_idx").on(table.status),
    pipelineIdIdx: index("pipeline_executions_pipeline_id_idx").on(table.pipelineId),
    orgIdIdx: index("pipeline_executions_org_id_idx").on(table.organizationId),
    workflowReleaseIdIdx: index("pipeline_executions_workflow_release_idx").on(table.workflowReleaseId),
    missionIdIdx: index("pipeline_executions_mission_id_idx").on(table.missionId),
    startedAtIdx: index("pipeline_executions_started_at_idx").on(table.startedAt),
}));

export type PipelineExecution = typeof pipelineExecutions.$inferSelect;

export const pipelineStepExecutions = pgTable("pipeline_step_executions", {
    id: serial("id").primaryKey(),
    pipelineExecutionId: integer("pipeline_execution_id")
        .notNull()
        .references(() => pipelineExecutions.id, { onDelete: "cascade" }),
    pipelineStepId: integer("pipeline_step_id")
        .notNull()
        .references(() => pipelineSteps.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
        .references(() => jobs.id),
    stepOrder: integer("step_order").notNull(),
    // Harpy V3 Extensions
    runGroup: text("run_group"),
    idempotencyKey: text("idempotency_key"),
    traceId: text("trace_id"),
    outputUri: text("output_uri"),
    errorUri: text("error_uri"),

    outputName: text("output_name"),
    output: text("output"),
    error: text("error"),
    status: text("status").notNull(), // "success", "failure", "running", "queued", "waiting_delay", "waiting_external_input", "skipped", "cancelled", "retrying"
    executedAt: timestamp("executed_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    cancelledAt: timestamp("cancelled_at"),
    // Distributed Tracing Span Hierarchy
    spanId: varchar("span_id", { length: 16 }),
    parentSpanId: varchar("parent_span_id", { length: 16 }),
    traceFlags: varchar("trace_flags", { length: 2 }).default("01"),
    // Auto-Retry Tracking
    retryCount: integer("retry_count").default(0),
    parentStepExecutionId: integer("parent_step_execution_id"), // Links to original execution if this is a retry
    // Schema Tracking
    outputSchema: jsonb("output_schema"), // Inferred JSON schema of the output
    // Data Quality Observability
    executionStats: jsonb("execution_stats"), // Stores HygieneResult stats (inputCount, droppedCount, etc.)
    // Optimistic Locking (Slice 25 Hardening)
    version: integer("version").default(1).notNull(),
    // Durable Execution (Sleep & Resume)
    sleepUntil: timestamp("sleep_until"), // When to wake up
    suspensionMetadata: jsonb("suspension_metadata"), // Reason for suspension
    // Job Dependency Graph
    dependencyStatus: varchar("dependency_status", { length: 20 }), // 'pending', 'resolved', 'blocked'
    dependencyResolutionTime: timestamp("dependency_resolution_time"),
    diff: jsonb("diff"), // Reactive Intelligence: Semantic changes from previous run
    deletedAt: timestamp("deleted_at"),
}, (table) => ({
    executionIdIdx: index("step_executions_execution_id_idx").on(table.pipelineExecutionId),
    stepIdIdx: index("step_executions_step_id_idx").on(table.pipelineStepId),
    jobIdIdx: index("step_executions_job_id_idx").on(table.jobId),
    statusIdx: index("step_executions_status_idx").on(table.status),
}));

export type PipelineStepExecution = typeof pipelineStepExecutions.$inferSelect;

export const aiUsageLogs = pgTable("ai_usage_logs", {
    id: serial("id").primaryKey(),
    pipelineId: integer("pipeline_id").references(() => pipelines.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }), // UUID, not integer
    executionId: integer("execution_id").references(() => pipelineExecutions.id, { onDelete: "set null" }),
    stepExecutionId: integer("step_execution_id").references(() => pipelineStepExecutions.id, { onDelete: "set null" }),

    // Provider Details
    provider: text("provider").notNull(), // 'openai', 'anthropic', 'google'
    model: text("model").notNull(),

    // Token Metrics (separate prompt/completion for visibility)
    promptTokens: integer("prompt_tokens").default(0).notNull(),
    completionTokens: integer("completion_tokens").default(0).notNull(),
    totalTokens: integer("total_tokens").default(0).notNull(),

    // Financials
    costUsd: decimal("cost_usd", { precision: 10, scale: 6 }).notNull(),

    // Organization context for filtering
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    // Indexes for common queries
    pipelineIdCreatedAtIdx: index("ai_usage_logs_pipeline_created_idx").on(table.pipelineId, table.createdAt),
    organizationIdCreatedAtIdx: index("ai_usage_logs_org_created_idx").on(table.organizationId, table.createdAt),
    userIdCreatedAtIdx: index("ai_usage_logs_user_created_idx").on(table.userId, table.createdAt),
    executionIdIdx: index("ai_usage_logs_execution_idx").on(table.executionId),
}));

export type AIUsageLog = typeof aiUsageLogs.$inferSelect;
export type InsertAIUsageLog = typeof aiUsageLogs.$inferInsert;


