import {
    pgTable, uuid, text, doublePrecision, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";

// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - EXPLANATION POD - DRIZZLE SCHEMA
// Spec Â§51: prediction_explanations, explanation_evidence, explanation_audit_logs
// ============================================================================

export const predictionExplanations = pgTable("prediction_explanations", {
    id: uuid("id").primaryKey().defaultRandom(),
    predictionId: uuid("prediction_id").notNull(),
    contextId: uuid("context_id").notNull(),
    explanationType: text("explanation_type").notNull(),
    audience: text("audience").notNull(),
    summary: text("summary").notNull(),
    explanationScore: doublePrecision("explanation_score").notNull().default(0.8),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    predictionIdx: index("idx_prediction_explanations_prediction").on(t.predictionId),
    contextTimeIdx: index("idx_prediction_explanations_context_time").on(t.contextId, t.createdAt),
}));

export const explanationEvidence = pgTable("explanation_evidence", {
    id: uuid("id").primaryKey().defaultRandom(),
    explanationId: uuid("explanation_id").notNull().references(() => predictionExplanations.id, { onDelete: "cascade" }),
    evidenceType: text("evidence_type").notNull(),
    contribution: doublePrecision("contribution").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    polarity: text("polarity").notNull(),
    explanation: text("explanation"),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    explanationIdx: index("idx_explanation_evidence_explanation").on(t.explanationId),
}));

export const explanationAuditLogs = pgTable("explanation_audit_logs", {
    id: uuid("id").primaryKey().defaultRandom(),
    explanationId: uuid("explanation_id").notNull().references(() => predictionExplanations.id, { onDelete: "cascade" }),
    audience: text("audience").notNull(),
    governanceVersion: text("governance_version"),
    redactions: jsonb("redactions").notNull().default([]),
    pluginsUsed: text("plugins_used").array().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    explanationIdx: index("idx_explanation_audit_explanation").on(t.explanationId),
}));


