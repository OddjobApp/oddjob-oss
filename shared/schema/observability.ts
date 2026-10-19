import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    varchar,
    serial,
    timestamp,
    integer,
    jsonb,
    bigint,
    index,
    boolean as pgBoolean,
} from "drizzle-orm/pg-core";
import { orgs } from './auth.js';
import { missions } from './missions/core.js';
import { missionRuns } from './missions/runs.js';


// ============================================================================
// FORENSIC EVENT LOG
// ============================================================================


export const forensicEventLog = pgTable("forensic_event_log", {

    id: serial("id").primaryKey(), // Changed to serial for auto-increment behavior

    // Trace Hierarchy
    traceId: varchar("trace_id", { length: 32 }),
    spanId: varchar("span_id", { length: 16 }),
    parentSpanId: varchar("parent_span_id", { length: 16 }),

    // Identity
    organizationId: integer("organization_id").references(() => orgs.id),
    userId: varchar("user_id", { length: 255 }),
    jobType: varchar("job_type", { length: 50 }).notNull(),
    jobId: integer("job_id"),
    pipelineId: integer("pipeline_id"),
    missionRunId: integer("mission_run_id").references(() => missionRuns.id),
    stepExecutionId: integer("step_execution_id"),

    // Telemetry
    startTimeNs: bigint("start_time_ns", { mode: "bigint" }).notNull(),
    endTimeNs: bigint("end_time_ns", { mode: "bigint" }),
    status: varchar("status", { length: 20 }).notNull(), // 'success', 'failure', 'timeout', 'cancelled'
    errorMessage: text("error_message"),
    errorStack: text("error_stack"),

    // Context
    ragTopicId: integer("rag_topic_id"),
    knowledgeNodeRefs: text("knowledge_node_refs").array(), // Array of UUIDs stored as text

    // Metadata
    attributes: jsonb("attributes").default(sql`'{}'::jsonb`),
    thoughts: text("thoughts"), // Reasoning/Self-talk from the agent
    reasoningHash: varchar("reasoning_hash", { length: 64 }), // For verifying integrity of reasoning chain
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    traceIdx: index("idx_forensic_trace").on(table.traceId),
    orgTimeIdx: index("idx_forensic_org_time").on(table.organizationId, table.createdAt),
    statusIdx: index("idx_forensic_status").on(table.status).where(sql`status IN ('failure', 'timeout')`),
    jobTypeIdx: index("idx_forensic_job_type").on(table.jobType),
}));

export type ForensicEvent = typeof forensicEventLog.$inferSelect;
export type InsertForensicEvent = typeof forensicEventLog.$inferInsert;

// ============================================================================
// ERROR DIAGNOSIS & CLUSTERING (Added in Phase 2)
// ============================================================================

export const errorDiagnoses = pgTable("error_diagnoses", {
    id: serial("id").primaryKey(),
    diagnosisId: varchar("diagnosis_id", { length: 36 }).notNull().unique(), // UUID
    pipelineExecutionId: integer("pipeline_execution_id"), // Soft reference to avoid circular deps if needed
    stepExecutionId: integer("step_execution_id"),
    errorMessage: text("error_message"),
    errorCode: varchar("error_code", { length: 50 }),
    httpStatus: integer("http_status"),
    jobType: varchar("job_type", { length: 50 }),
    matchedPatternId: varchar("matched_pattern_id", { length: 255 }),
    matchedPatternScore: integer("matched_pattern_score"), // Scaled 0-100 or decimal? Migration said decimal(3,2)
    aiDiagnosis: jsonb("ai_diagnosis"),
    recommendations: jsonb("recommendations"),
    appliedFixId: varchar("applied_fix_id", { length: 255 }),
    fixSuccessful: pgBoolean("fix_successful"),
    userFeedback: varchar("user_feedback", { length: 50 }),
    organizationId: integer("organization_id").references(() => orgs.id),
    createdAt: timestamp("created_at").defaultNow(),
});

export const errorEmbeddings = pgTable("error_embeddings", {
    id: serial("id").primaryKey(),
    errorDiagnosisId: varchar("error_diagnosis_id", { length: 36 }).references(() => errorDiagnoses.diagnosisId),
    errorText: text("error_text").notNull(),
    errorHash: varchar("error_hash", { length: 64 }),
    // embedding: vector(1536) - omitted from TS schema for now as it requires pgvector extension and custom type setup
    clusterId: integer("cluster_id"),
    organizationId: integer("organization_id").references(() => orgs.id),
    createdAt: timestamp("created_at").defaultNow(),
});

export const errorClusters = pgTable("error_clusters", {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }),
    description: text("description"),
    errorCount: integer("error_count").default(0),
    sampleErrors: text("sample_errors").array(),
    suggestedPattern: jsonb("suggested_pattern"),
    centroidText: text("centroid_text"),
    status: varchar("status", { length: 50 }).default('pending'),
    organizationId: integer("organization_id").references(() => orgs.id),
    reviewedBy: varchar("reviewed_by", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
    reviewedAt: timestamp("reviewed_at"),
});

// ============================================================================
// ERROR ALERTS (Added in Phase 3)
// ============================================================================

export const errorAlertConfigs = pgTable("error_alert_configs", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id),
    name: varchar("name", { length: 255 }).notNull(),
    enabled: pgBoolean("enabled").default(true),
    errorCategories: text("error_categories").array(),
    minOccurrences: integer("min_occurrences").default(3),
    timeWindowMinutes: integer("time_window_minutes").default(60),
    pipelineIds: integer("pipeline_ids").array(),
    notifyVia: text("notify_via").array().notNull(),
    slackWebhookUrl: text("slack_webhook_url"),
    slackChannel: varchar("slack_channel", { length: 255 }),
    emailRecipients: text("email_recipients").array(),
    cooldownMinutes: integer("cooldown_minutes").default(30),
    lastTriggeredAt: timestamp("last_triggered_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
    orgIdx: index("idx_alert_configs_org").on(table.organizationId, table.enabled),
}));

export const errorAlerts = pgTable("error_alerts", {
    id: serial("id").primaryKey(),
    configId: integer("config_id").references(() => errorAlertConfigs.id, { onDelete: 'cascade' }),
    triggeredAt: timestamp("triggered_at").defaultNow(),
    errorCount: integer("error_count").notNull(),
    errorCategory: varchar("error_category", { length: 50 }),
    pipelineId: integer("pipeline_id"),
    diagnosisSummary: jsonb("diagnosis_summary"),
    sampleErrors: text("sample_errors").array(),
    notificationSent: pgBoolean("notification_sent").default(false),
    notificationError: text("notification_error"),
});

export type ErrorDiagnosis = typeof errorDiagnoses.$inferSelect;
export type InsertErrorDiagnosis = typeof errorDiagnoses.$inferInsert;

export type ErrorCluster = typeof errorClusters.$inferSelect;
export type InsertErrorCluster = typeof errorClusters.$inferInsert;

export type ErrorAlertConfig = typeof errorAlertConfigs.$inferSelect;
export type InsertErrorAlertConfig = typeof errorAlertConfigs.$inferInsert;

export type ErrorAlert = typeof errorAlerts.$inferSelect;
export type InsertErrorAlert = typeof errorAlerts.$inferInsert;



