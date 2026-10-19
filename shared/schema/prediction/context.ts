import {
    pgTable,
    uuid,
    text,
    boolean,
    doublePrecision,
    timestamp,
    jsonb,
    index,
} from "drizzle-orm/pg-core";

// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - CONTEXT POD - DRIZZLE SCHEMA
// Spec Â§35: prediction_contexts, context_relations, context_resolution_logs
// ============================================================================

export const predictionContexts = pgTable("prediction_contexts", {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    label: text("label"),
    tenantId: text("tenant_id"),
    applicationId: text("application_id"),
    actorId: text("actor_id"),
    workflowId: text("workflow_id"),
    sessionId: text("session_id"),
    taskId: text("task_id"),
    agentId: text("agent_id"),
    regionId: uuid("region_id"),
    status: text("status").notNull().default("active"),
    confidence: doublePrecision("confidence").notNull().default(0.8),
    resolutionMethod: text("resolution_method").notNull().default("created"),
    evidenceEventIds: uuid("evidence_event_ids").array().default([]),
    evidenceQuantIds: uuid("evidence_quant_ids").array().default([]),
    permissions: jsonb("permissions").notNull().default({}),
    baselineRefs: text("baseline_refs").array().default([]),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    provenance: jsonb("provenance").notNull().default({}),
    metadata: jsonb("metadata").notNull().default({}),
}, (t) => ({
    tenantIdx: index("idx_prediction_contexts_tenant").on(t.tenantId),
    actorIdx: index("idx_prediction_contexts_actor").on(t.actorId),
    workflowIdx: index("idx_prediction_contexts_workflow").on(t.workflowId),
    sessionIdx: index("idx_prediction_contexts_session").on(t.sessionId),
    statusIdx: index("idx_prediction_contexts_status").on(t.status),
    lastSeenIdx: index("idx_prediction_contexts_last_seen").on(t.lastSeenAt),
}));

export const contextRelations = pgTable("context_relations", {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceContextId: uuid("source_context_id").notNull().references(() => predictionContexts.id),
    targetContextId: uuid("target_context_id").notNull().references(() => predictionContexts.id),
    relationType: text("relation_type").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    evidenceIds: uuid("evidence_ids").array().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
}, (t) => ({
    sourceIdx: index("idx_context_relations_source").on(t.sourceContextId),
    targetIdx: index("idx_context_relations_target").on(t.targetContextId),
    typeIdx: index("idx_context_relations_type").on(t.relationType),
}));

export const contextResolutionLogs = pgTable("context_resolution_logs", {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull(),
    resolvedContextId: uuid("resolved_context_id"),
    inputSummary: jsonb("input_summary").notNull().default({}),
    candidates: jsonb("candidates").notNull().default([]),
    confidence: doublePrecision("confidence").notNull(),
    createdNew: boolean("created_new").notNull().default(false),
    warnings: text("warnings").array().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    contextIdx: index("idx_context_resolution_logs_context").on(t.resolvedContextId),
    timeIdx: index("idx_context_resolution_logs_time").on(t.createdAt),
}));


