import {
    pgTable,
    uuid,
    text,
    boolean,
    doublePrecision,
    integer,
    timestamp,
    jsonb,
    index,
} from "drizzle-orm/pg-core";

// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - MEMORY POD - DRIZZLE SCHEMA
// Spec Â§28: pattern_memories, attractor_memories, historical_outcomes,
//           baseline_memories, memory_recall_logs
// ============================================================================

export const patternMemories = pgTable("pattern_memories", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    patternType: text("pattern_type").notNull(),
    signature: text("signature"),
    embeddingId: text("embedding_id"),
    typicalPredicates: text("typical_predicates").array().default([]),
    typicalPostPredicates: text("typical_post_predicates").array().default([]),
    confidence: doublePrecision("confidence").notNull(),
    supportCount: integer("support_count").notNull().default(0),
    falsePositiveRate: doublePrecision("false_positive_rate"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    typeIdx: index("idx_pattern_memories_type").on(t.patternType),
    confidenceIdx: index("idx_pattern_memories_confidence").on(t.confidence),
}));

export const attractorMemories = pgTable("attractor_memories", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    embeddingId: text("embedding_id"),
    description: text("description"),
    associatedPredicates: text("associated_predicates").array().default([]),
    associatedHiddenStates: text("associated_hidden_states").array().default([]),
    confidence: doublePrecision("confidence").notNull(),
    pullStrength: doublePrecision("pull_strength").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    typeIdx: index("idx_attractor_memories_type").on(t.type),
    pullIdx: index("idx_attractor_memories_pull").on(t.pullStrength),
}));

export const historicalOutcomes = pgTable("historical_outcomes", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    predictionId: uuid("prediction_id").notNull(),
    branchId: uuid("branch_id"),
    predictedPredicate: text("predicted_predicate").notNull(),
    actualOutcome: text("actual_outcome").notNull(),
    matched: boolean("matched").notNull(),
    confidenceAtPrediction: doublePrecision("confidence_at_prediction").notNull(),
    entropyAtPrediction: doublePrecision("entropy_at_prediction").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
}, (t) => ({
    contextTimeIdx: index("idx_historical_outcomes_context_time").on(t.contextId, t.recordedAt),
    predicateIdx: index("idx_historical_outcomes_predicate").on(t.predictedPredicate),
    matchedIdx: index("idx_historical_outcomes_matched").on(t.matched),
    predictionIdx: index("idx_historical_outcomes_prediction").on(t.predictionId),
}));

export const baselineMemories = pgTable("baseline_memories", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    baselineType: text("baseline_type").notNull(),
    scope: text("scope").notNull(),
    value: jsonb("value").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    sampleSize: integer("sample_size").notNull().default(0),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    contextTypeIdx: index("idx_baseline_memories_context_type").on(t.contextId, t.baselineType),
    scopeIdx: index("idx_baseline_memories_scope").on(t.scope),
}));

export const memoryRecallLogs = pgTable("memory_recall_logs", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    requestId: uuid("request_id").notNull(),
    memoryTypes: text("memory_types").array().notNull(),
    mode: text("mode").notNull(),
    resultCount: integer("result_count").notNull(),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
}, (t) => ({
    contextTimeIdx: index("idx_memory_recall_logs_context_time").on(t.contextId, t.createdAt),
}));


