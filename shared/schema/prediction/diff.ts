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
// PREDICTION INTELLIGENCE DOMAIN - DIFF POD - DRIZZLE SCHEMA
// Spec Â§34: diff_records, drift_records, diff_snapshots, diff_triggers
// ============================================================================

export const diffRecords = pgTable("diff_records", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    type: text("type").notNull(),
    realm: text("realm"),
    sourceRefId: uuid("source_ref_id"),
    targetRefId: uuid("target_ref_id"),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    magnitude: doublePrecision("magnitude").notNull(),
    velocity: doublePrecision("velocity"),
    acceleration: doublePrecision("acceleration"),
    entropyDelta: doublePrecision("entropy_delta"),
    significance: doublePrecision("significance").notNull(),
    direction: text("direction"),
    driftDetected: boolean("drift_detected").notNull().default(false),
    anomalyDetected: boolean("anomaly_detected").notNull().default(false),
    evidenceIds: uuid("evidence_ids").array().default([]),
    explanation: text("explanation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    contextTimeIdx: index("idx_diff_records_context_time").on(t.contextId, t.createdAt),
    typeIdx: index("idx_diff_records_type").on(t.type),
    realmIdx: index("idx_diff_records_realm").on(t.realm),
    significanceIdx: index("idx_diff_records_significance").on(t.significance),
}));

export const driftRecords = pgTable("drift_records", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    driftType: text("drift_type").notNull(),
    direction: text("direction"),
    magnitude: doublePrecision("magnitude").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    evidenceIds: uuid("evidence_ids").array().default([]),
    explanation: text("explanation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    contextTimeIdx: index("idx_drift_records_context_time").on(t.contextId, t.createdAt),
    typeIdx: index("idx_drift_records_type").on(t.driftType),
}));

export const diffSnapshots = pgTable("diff_snapshots", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    snapshotType: text("snapshot_type").notNull(),
    snapshotRefId: uuid("snapshot_ref_id"),
    summary: jsonb("summary").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    contextTimeIdx: index("idx_diff_snapshots_context_time").on(t.contextId, t.createdAt),
}));

export const diffTriggers = pgTable("diff_triggers", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    triggerType: text("trigger_type").notNull(),
    significance: doublePrecision("significance").notNull(),
    reason: text("reason"),
    evidenceIds: uuid("evidence_ids").array().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    contextTimeIdx: index("idx_diff_triggers_context_time").on(t.contextId, t.createdAt),
    typeIdx: index("idx_diff_triggers_type").on(t.triggerType),
}));


