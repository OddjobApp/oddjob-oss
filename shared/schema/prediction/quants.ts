import {
    pgTable,
    uuid,
    text,
    doublePrecision,
    integer,
    timestamp,
    jsonb,
    index,
} from "drizzle-orm/pg-core";

// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN â€” QUANT POD â€” DRIZZLE SCHEMA
// Spec Â§27: Postgres Schema
// ============================================================================

// ---------------------------------------------------------------------------
// 27.1 quants
// ---------------------------------------------------------------------------

export const quants = pgTable("quants", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),

    type: text("type").notNull(),
    label: text("label"),

    // Epistemic fields (flattened for query performance)
    status: text("status").notNull(),                        // epistemic status
    worldKnownness: doublePrecision("world_knownness").notNull().default(0),
    systemKnownness: doublePrecision("system_knownness").notNull().default(0),
    evidenceStrength: doublePrecision("evidence_strength").notNull().default(0),
    recognitionLevel: doublePrecision("recognition_level").notNull().default(0),
    resolutionLevel: doublePrecision("resolution_level").notNull().default(0),

    // Core signal scalars
    magnitude: doublePrecision("magnitude").notNull().default(0.5),
    confidence: doublePrecision("confidence").notNull().default(0),
    uncertainty: doublePrecision("uncertainty").notNull().default(1),
    entropyContribution: doublePrecision("entropy_contribution").notNull().default(0),

    // Source provenance arrays (UUID arrays stored as JSONB for Drizzle compat)
    sourceEventIds: jsonb("source_event_ids").$type<string[]>().notNull().default([]),
    sourceEpisodeIds: jsonb("source_episode_ids").$type<string[]>().notNull().default([]),
    sourcePredictionIds: jsonb("source_prediction_ids").$type<string[]>().notNull().default([]),
    sourceQuantIds: jsonb("source_quant_ids").$type<string[]>().notNull().default([]),

    // Lifecycle
    lifecycleStatus: text("lifecycle_status").notNull().default("active"),
    decayRate: doublePrecision("decay_rate").notNull().default(0),
    ttlSeconds: integer("ttl_seconds"),

    // Rich nested data in JSONB
    payload: jsonb("payload").notNull().default({}),  // position, trajectory, provenance

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    ctxStatusIdx: index("idx_quants_context_status").on(t.contextId, t.status),
    ctxUpdatedIdx: index("idx_quants_context_updated").on(t.contextId, t.updatedAt),
    typeIdx: index("idx_quants_type").on(t.type),
    lifecycleIdx: index("idx_quants_lifecycle").on(t.lifecycleStatus),
}));

// ---------------------------------------------------------------------------
// 27.2 quant_realm_contributions
// ---------------------------------------------------------------------------

export const quantRealmContributions = pgTable("quant_realm_contributions", {
    id: uuid("id").primaryKey().defaultRandom(),
    quantId: uuid("quant_id").notNull().references(() => quants.id, { onDelete: "cascade" }),
    contextId: uuid("context_id").notNull(),
    realm: text("realm").notNull(),
    pluginName: text("plugin_name").notNull(),
    pluginVersion: text("plugin_version").notNull(),
    effect: text("effect").notNull(),
    amount: doublePrecision("amount").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    explanation: text("explanation"),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    quantIdx: index("idx_quant_realm_contrib_quant").on(t.quantId),
    ctxTimeIdx: index("idx_quant_realm_contrib_context").on(t.contextId, t.createdAt),
}));

// ---------------------------------------------------------------------------
// 27.3 quant_relationships
// ---------------------------------------------------------------------------

export const quantRelationships = pgTable("quant_relationships", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    sourceQuantId: uuid("source_quant_id").notNull().references(() => quants.id, { onDelete: "cascade" }),
    targetQuantId: uuid("target_quant_id").notNull().references(() => quants.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull(),
    strength: doublePrecision("strength").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    sourceIdx: index("idx_quant_relationships_source").on(t.sourceQuantId),
    targetIdx: index("idx_quant_relationships_target").on(t.targetQuantId),
    ctxTimeIdx: index("idx_quant_relationships_context").on(t.contextId, t.createdAt),
    typeIdx: index("idx_quant_relationships_type").on(t.relationshipType),
}));

// ---------------------------------------------------------------------------
// 27.4 quant_field_summaries
// ---------------------------------------------------------------------------

export const quantFieldSummaries = pgTable("quant_field_summaries", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    windowId: uuid("window_id"),
    quantCount: integer("quant_count").notNull(),
    fieldDensity: doublePrecision("field_density").notNull(),
    fieldEntropy: doublePrecision("field_entropy").notNull(),
    fieldAlignment: doublePrecision("field_alignment").notNull(),
    fieldDivergence: doublePrecision("field_divergence").notNull(),
    fieldCoherence: doublePrecision("field_coherence").notNull(),
    collapseProbability: doublePrecision("collapse_probability").notNull(),
    dominantStatus: text("dominant_status").notNull(),
    topAttractors: jsonb("top_attractors").$type<string[]>().notNull().default([]),
    summary: jsonb("summary").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    ctxTimeIdx: index("idx_quant_field_context_time").on(t.contextId, t.createdAt),
    windowIdx: index("idx_quant_field_window").on(t.windowId),
}));

// ---------------------------------------------------------------------------
// 27.5 quant_branch_influences
// ---------------------------------------------------------------------------

export const quantBranchInfluences = pgTable("quant_branch_influences", {
    id: uuid("id").primaryKey().defaultRandom(),
    quantId: uuid("quant_id").notNull().references(() => quants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull(),
    effect: text("effect").notNull(),
    amount: doublePrecision("amount").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    explanation: text("explanation"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    quantIdx: index("idx_quant_branch_influences_quant").on(t.quantId),
    branchIdx: index("idx_quant_branch_influences_branch").on(t.branchId),
}));

// ---------------------------------------------------------------------------
// 27.6 quant_hidden_state_influences
// ---------------------------------------------------------------------------

export const quantHiddenStateInfluences = pgTable("quant_hidden_state_influences", {
    id: uuid("id").primaryKey().defaultRandom(),
    quantId: uuid("quant_id").notNull().references(() => quants.id, { onDelete: "cascade" }),
    hiddenStateId: uuid("hidden_state_id").notNull(),
    effect: text("effect").notNull(),
    amount: doublePrecision("amount").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    explanation: text("explanation"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    quantIdx: index("idx_quant_hs_influences_quant").on(t.quantId),
    stateIdx: index("idx_quant_hs_influences_state").on(t.hiddenStateId),
}));


