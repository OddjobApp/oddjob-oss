import {
    pgTable,
    uuid,
    text,
    boolean,
    doublePrecision,
    bigint,
    timestamp,
    jsonb,
    index,
    unique,
} from "drizzle-orm/pg-core";

// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - CANONICAL EVENT POD - DRIZZLE SCHEMA
// Spec Â§35: canonical_events, event_rejections, event_deduplication_keys, event_corrections
// ============================================================================

export const canonicalEvents = pgTable("canonical_events", {
    id: uuid("id").primaryKey().defaultRandom(),
    schemaVersion: text("schema_version").notNull().default("1.0"),
    contextId: uuid("context_id").notNull(),
    tenantId: text("tenant_id"),
    actorId: text("actor_id"),
    objectId: text("object_id"),
    source: text("source").notNull(),
    action: text("action").notNull(),
    eventKind: text("event_kind").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    durationMs: bigint("duration_ms", { mode: "number" }),
    confidence: doublePrecision("confidence").notNull(),
    sourceTrust: doublePrecision("source_trust").notNull(),
    rawPayloadRef: text("raw_payload_ref"),
    rawPayload: jsonb("raw_payload"),
    canonicalPayload: jsonb("canonical_payload").notNull().default({}),
    classification: jsonb("classification").notNull().default({}),
    sensitivity: jsonb("sensitivity").notNull().default({}),
    provenance: jsonb("provenance").notNull().default({}),
    lineage: jsonb("lineage").notNull().default({}),
    repair: jsonb("repair"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    contextTimeIdx: index("idx_canonical_events_context_time").on(t.contextId, t.occurredAt),
    sourceIdx: index("idx_canonical_events_source").on(t.source),
    actionIdx: index("idx_canonical_events_action").on(t.action),
    kindIdx: index("idx_canonical_events_kind").on(t.eventKind),
}));

export const eventRejections = pgTable("event_rejections", {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source"),
    sourceEventId: text("source_event_id"),
    reason: text("reason").notNull(),
    code: text("code").notNull(),
    recoverable: boolean("recoverable").notNull().default(false),
    rawPayload: jsonb("raw_payload"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    sourceTimeIdx: index("idx_event_rejections_source_time").on(t.source, t.createdAt),
    codeIdx: index("idx_event_rejections_code").on(t.code),
}));

export const eventDeduplicationKeys = pgTable("event_deduplication_keys", {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => canonicalEvents.id, { onDelete: "cascade" }),
    keyType: text("key_type").notNull(),
    keyValue: text("key_value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    eventIdx: index("idx_event_dedup_keys_event").on(t.eventId),
    uniqueKey: unique().on(t.keyType, t.keyValue),
}));

export const eventCorrections = pgTable("event_corrections", {
    id: uuid("id").primaryKey().defaultRandom(),
    originalEventId: uuid("original_event_id").notNull().references(() => canonicalEvents.id),
    correctionEventId: uuid("correction_event_id").notNull().references(() => canonicalEvents.id),
    correctionType: text("correction_type").notNull(),
    explanation: text("explanation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    originalIdx: index("idx_event_corrections_original").on(t.originalEventId),
}));


