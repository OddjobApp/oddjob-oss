import {
    pgTable, text, uuid, doublePrecision, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";

// ============================================================================
// PREDICTION INTELLIGENCE â€” REALM MESH POD â€” DRIZZLE SCHEMA
// Spec Â§36.1 (realm_contributions), Â§36.2 (realm_agreements), Â§36.3 (realm_conflicts)
// ============================================================================

// ---------------------------------------------------------------------------
// realm_contributions (spec Â§36.1)
// ---------------------------------------------------------------------------

export const realmContributions = pgTable("realm_contributions", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    quantId: uuid("quant_id"),
    eventId: uuid("event_id"),
    episodeId: uuid("episode_id"),
    branchId: uuid("branch_id"),
    hiddenStateId: uuid("hidden_state_id"),
    realm: text("realm").notNull(),
    pluginName: text("plugin_name").notNull(),
    pluginVersion: text("plugin_version").notNull(),
    effect: text("effect").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    amount: doublePrecision("amount").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    uncertaintyDelta: doublePrecision("uncertainty_delta").notNull().default(0),
    entropyDelta: doublePrecision("entropy_delta").notNull().default(0),
    evidenceIds: jsonb("evidence_ids").notNull().default([]),
    explanation: text("explanation"),
    metadata: jsonb("metadata").notNull().default({}),
    provenance: jsonb("provenance").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    contextTimeIdx: index("idx_realm_contrib_context_time").on(t.contextId, t.createdAt),
    quantIdx: index("idx_realm_contrib_quant").on(t.quantId),
    realmIdx: index("idx_realm_contrib_realm").on(t.realm),
    branchIdx: index("idx_realm_contrib_branch").on(t.branchId),
}));

// ---------------------------------------------------------------------------
// realm_agreements (spec Â§36.2)
// ---------------------------------------------------------------------------

export const realmAgreements = pgTable("realm_agreements", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    branchId: uuid("branch_id"),
    quantId: uuid("quant_id"),
    score: doublePrecision("score").notNull(),
    agreeingRealms: jsonb("agreeing_realms").notNull().default([]),
    disagreeingRealms: jsonb("disagreeing_realms").notNull().default([]),
    neutralRealms: jsonb("neutral_realms").notNull().default([]),
    explanation: text("explanation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    contextTimeIdx: index("idx_realm_agreement_context_time").on(t.contextId, t.createdAt),
    branchIdx: index("idx_realm_agreement_branch").on(t.branchId),
    quantIdx: index("idx_realm_agreement_quant").on(t.quantId),
}));

// ---------------------------------------------------------------------------
// realm_conflicts (spec Â§36.3)
// ---------------------------------------------------------------------------

export const realmConflicts = pgTable("realm_conflicts", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    conflictType: text("conflict_type").notNull(),
    realms: jsonb("realms").notNull().default([]),
    severity: text("severity").notNull(),
    entropyDelta: doublePrecision("entropy_delta").notNull(),
    suggestedAction: text("suggested_action").notNull(),
    explanation: text("explanation"),
    evidenceIds: jsonb("evidence_ids").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    contextTimeIdx: index("idx_realm_conflicts_context_time").on(t.contextId, t.createdAt),
    typeIdx: index("idx_realm_conflicts_type").on(t.conflictType),
}));


