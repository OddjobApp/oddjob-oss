import {
    pgTable,
    uuid,
    text,
    doublePrecision,
    integer,
    bigint,
    timestamp,
    jsonb,
    index,
} from "drizzle-orm/pg-core";

// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - TEMPORAL / WINDOWING POD - DRIZZLE SCHEMA
// Spec Â§38: window_summaries, temporal_features, temporal_relations, expected_event_gaps
// ============================================================================

export const windowSummaries = pgTable("window_summaries", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    type: text("type").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    durationMs: bigint("duration_ms", { mode: "number" }).notNull(),
    eventCount: integer("event_count").notNull().default(0),
    quantCount: integer("quant_count"),
    episodeCount: integer("episode_count"),
    eventDensity: doublePrecision("event_density").notNull().default(0),
    quantDensity: doublePrecision("quant_density"),
    densityMode: text("density_mode").notNull().default("normal"),
    topActions: text("top_actions").array().default([]),
    topConcepts: text("top_concepts").array().default([]),
    topThemes: text("top_themes").array().default([]),
    entropy: doublePrecision("entropy"),
    burstScore: doublePrecision("burst_score"),
    silenceScore: doublePrecision("silence_score"),
    persistenceScore: doublePrecision("persistence_score"),
    regionId: uuid("region_id"),
    areaM2: doublePrecision("area_m2"),
    geoDensity: doublePrecision("geo_density"),
    spacetimeDensity: doublePrecision("spacetime_density"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    contextTimeIdx: index("idx_window_summaries_context_time").on(t.contextId, t.startTime),
    typeIdx: index("idx_window_summaries_type").on(t.type),
    densityModeIdx: index("idx_window_summaries_density_mode").on(t.densityMode),
}));

export const temporalFeatures = pgTable("temporal_features", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    eventId: uuid("event_id"),
    quantId: uuid("quant_id"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    durationMs: bigint("duration_ms", { mode: "number" }),
    windowIds: uuid("window_ids").array().default([]),
    sequenceIndex: bigint("sequence_index", { mode: "number" }),
    priorEventId: uuid("prior_event_id"),
    prePriorEventIds: uuid("pre_prior_event_ids").array().default([]),
    recency: doublePrecision("recency").notNull(),
    frequency: doublePrecision("frequency").notNull(),
    persistence: doublePrecision("persistence").notNull(),
    burstScore: doublePrecision("burst_score").notNull(),
    silenceScore: doublePrecision("silence_score").notNull(),
    expectedGapMs: bigint("expected_gap_ms", { mode: "number" }),
    actualGapMs: bigint("actual_gap_ms", { mode: "number" }),
    gapRatio: doublePrecision("gap_ratio"),
    densityMode: text("density_mode").notNull(),
    temporalValidity: doublePrecision("temporal_validity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    contextTimeIdx: index("idx_temporal_features_context_time").on(t.contextId, t.observedAt),
    eventIdx: index("idx_temporal_features_event").on(t.eventId),
    quantIdx: index("idx_temporal_features_quant").on(t.quantId),
}));

export const temporalRelations = pgTable("temporal_relations", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    sourceRefId: uuid("source_ref_id").notNull(),
    targetRefId: uuid("target_ref_id").notNull(),
    sourceType: text("source_type").notNull(),
    targetType: text("target_type").notNull(),
    relation: text("relation").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    evidenceIds: uuid("evidence_ids").array().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    contextIdx: index("idx_temporal_relations_context").on(t.contextId, t.createdAt),
    sourceIdx: index("idx_temporal_relations_source").on(t.sourceRefId),
    targetIdx: index("idx_temporal_relations_target").on(t.targetRefId),
    relationIdx: index("idx_temporal_relations_relation").on(t.relation),
}));

export const expectedEventGaps = pgTable("expected_event_gaps", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    eventType: text("event_type").notNull(),
    expectedGapMs: bigint("expected_gap_ms", { mode: "number" }).notNull(),
    toleranceMs: bigint("tolerance_ms", { mode: "number" }).notNull(),
    confidence: doublePrecision("confidence").notNull(),
    source: text("source").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    contextTypeIdx: index("idx_expected_event_gaps_context_type").on(t.contextId, t.eventType),
}));


