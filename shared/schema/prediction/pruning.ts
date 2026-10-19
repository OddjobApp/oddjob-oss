import {
    pgTable,
    uuid,
    text,
    doublePrecision,
    timestamp,
    jsonb,
    index,
} from "drizzle-orm/pg-core";

// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - PRUNING POD - DRIZZLE SCHEMA
// Spec Â§28: pruning_decisions, branch_genealogy_events, branch_score_breakdowns
// ============================================================================

export const pruningDecisions = pgTable("pruning_decisions", {
    id: uuid("id").primaryKey().defaultRandom(),
    predictionId: uuid("prediction_id").notNull(),
    contextId: uuid("context_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    previousStatus: text("previous_status").notNull(),
    newStatus: text("new_status").notNull(),
    decisionType: text("decision_type").notNull(),
    reason: text("reason").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    scoreBefore: doublePrecision("score_before").notNull(),
    scoreAfter: doublePrecision("score_after").notNull(),
    evidenceIds: uuid("evidence_ids").array().default([]),
    pluginName: text("plugin_name").notNull(),
    pluginVersion: text("plugin_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    predictionIdx: index("idx_pruning_decisions_prediction").on(t.predictionId),
    contextTimeIdx: index("idx_pruning_decisions_context_time").on(t.contextId, t.createdAt),
    branchIdx: index("idx_pruning_decisions_branch").on(t.branchId),
    typeIdx: index("idx_pruning_decisions_type").on(t.decisionType),
}));

export const branchGenealogyEvents = pgTable("branch_genealogy_events", {
    id: uuid("id").primaryKey().defaultRandom(),
    predictionId: uuid("prediction_id").notNull(),
    contextId: uuid("context_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    parentBranchId: uuid("parent_branch_id"),
    eventType: text("event_type").notNull(),
    reason: text("reason"),
    evidenceIds: uuid("evidence_ids").array().default([]),
    sourcePlugin: text("source_plugin").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    branchIdx: index("idx_branch_genealogy_branch").on(t.branchId),
    predictionIdx: index("idx_branch_genealogy_prediction").on(t.predictionId),
    contextTimeIdx: index("idx_branch_genealogy_context_time").on(t.contextId, t.createdAt),
}));

export const branchScoreBreakdowns = pgTable("branch_score_breakdowns", {
    id: uuid("id").primaryKey().defaultRandom(),
    predictionId: uuid("prediction_id").notNull(),
    contextId: uuid("context_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    probability: doublePrecision("probability").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    quantSupport: doublePrecision("quant_support").notNull(),
    realmAgreement: doublePrecision("realm_agreement").notNull(),
    hiddenStateAlignment: doublePrecision("hidden_state_alignment").notNull(),
    bicameralAgreement: doublePrecision("bicameral_agreement").notNull(),
    expectedValue: doublePrecision("expected_value").notNull(),
    consequenceWeight: doublePrecision("consequence_weight").notNull(),
    entropyPenalty: doublePrecision("entropy_penalty").notNull(),
    finalScore: doublePrecision("final_score").notNull(),
    explanation: text("explanation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    branchIdx: index("idx_branch_score_breakdowns_branch").on(t.branchId),
    predictionIdx: index("idx_branch_score_breakdowns_prediction").on(t.predictionId),
}));


