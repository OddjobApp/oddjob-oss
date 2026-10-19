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
// PREDICTION INTELLIGENCE DOMAIN - CALIBRATION POD - DRIZZLE SCHEMA
// Spec Â§44: observed_outcomes, outcome_matches, calibration_outcomes,
//           calibration_signals, plugin_reliability_scores, realm_reliability_scores
// ============================================================================

export const observedOutcomes = pgTable("observed_outcomes", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    outcomeType: text("outcome_type").notNull(),
    label: text("label").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
    sourceTrust: doublePrecision("source_trust").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    relatedEventIds: uuid("related_event_ids").array().default([]),
    relatedQuantIds: uuid("related_quant_ids").array().default([]),
    relatedPredictionIds: uuid("related_prediction_ids").array().default([]),
    payload: jsonb("payload").notNull().default({}),
    provenance: jsonb("provenance").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    contextTimeIdx: index("idx_observed_outcomes_context_time").on(t.contextId, t.occurredAt),
    labelIdx: index("idx_observed_outcomes_label").on(t.label),
    typeIdx: index("idx_observed_outcomes_type").on(t.outcomeType),
}));

export const outcomeMatches = pgTable("outcome_matches", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    outcomeId: uuid("outcome_id").notNull().references(() => observedOutcomes.id),
    predictionId: uuid("prediction_id").notNull(),
    matchedBranchId: uuid("matched_branch_id"),
    matchedPredicate: text("matched_predicate"),
    matchType: text("match_type").notNull(),
    matchScore: doublePrecision("match_score").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    explanation: text("explanation"),
    evidenceIds: uuid("evidence_ids").array().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    outcomeIdx: index("idx_outcome_matches_outcome").on(t.outcomeId),
    predictionIdx: index("idx_outcome_matches_prediction").on(t.predictionId),
    contextTimeIdx: index("idx_outcome_matches_context_time").on(t.contextId, t.createdAt),
}));

export const calibrationOutcomes = pgTable("calibration_outcomes", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    predictionId: uuid("prediction_id").notNull(),
    outcomeId: uuid("outcome_id").notNull().references(() => observedOutcomes.id),
    outcomeMatchId: uuid("outcome_match_id").notNull().references(() => outcomeMatches.id),
    topPredictionCorrect: boolean("top_prediction_correct").notNull(),
    trueBranchPresent: boolean("true_branch_present").notNull(),
    trueBranchStatus: text("true_branch_status"),
    confidenceAtPrediction: doublePrecision("confidence_at_prediction").notNull(),
    entropyAtPrediction: doublePrecision("entropy_at_prediction").notNull(),
    calibratedConfidence: doublePrecision("calibrated_confidence"),
    predictionError: doublePrecision("prediction_error").notNull(),
    calibrationError: doublePrecision("calibration_error").notNull(),
    brierScore: doublePrecision("brier_score"),
    logLoss: doublePrecision("log_loss"),
    falsePositive: boolean("false_positive").notNull().default(false),
    falseNegative: boolean("false_negative").notNull().default(false),
    falsePrune: boolean("false_prune").notNull().default(false),
    luckyCorrect: boolean("lucky_correct").notNull().default(false),
    overconfident: boolean("overconfident").notNull().default(false),
    underconfident: boolean("underconfident").notNull().default(false),
    explanation: text("explanation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    predictionIdx: index("idx_calibration_outcomes_prediction").on(t.predictionId),
    contextTimeIdx: index("idx_calibration_outcomes_context_time").on(t.contextId, t.createdAt),
    falsePruneIdx: index("idx_calibration_outcomes_false_prune").on(t.falsePrune),
    overconfidentIdx: index("idx_calibration_outcomes_overconfident").on(t.overconfident),
}));

export const calibrationSignals = pgTable("calibration_signals", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id"),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    targetName: text("target_name"),
    signalType: text("signal_type").notNull(),
    amount: doublePrecision("amount").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    reason: text("reason").notNull(),
    evidenceIds: uuid("evidence_ids").array().default([]),
    applied: boolean("applied").notNull().default(false),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    targetIdx: index("idx_calibration_signals_target").on(t.targetType, t.targetId),
    contextTimeIdx: index("idx_calibration_signals_context_time").on(t.contextId, t.createdAt),
    appliedIdx: index("idx_calibration_signals_applied").on(t.applied),
}));

export const pluginReliabilityScores = pgTable("plugin_reliability_scores", {
    id: uuid("id").primaryKey().defaultRandom(),
    pluginName: text("plugin_name").notNull(),
    pluginVersion: text("plugin_version").notNull(),
    contextScope: text("context_scope"),
    reliabilityScore: doublePrecision("reliability_score").notNull(),
    accuracyContribution: doublePrecision("accuracy_contribution"),
    falsePositiveContribution: doublePrecision("false_positive_contribution"),
    falseNegativeContribution: doublePrecision("false_negative_contribution"),
    falsePruneContribution: doublePrecision("false_prune_contribution"),
    sampleSize: integer("sample_size").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    pluginIdx: index("idx_plugin_reliability_plugin").on(t.pluginName, t.pluginVersion),
    scoreIdx: index("idx_plugin_reliability_score").on(t.reliabilityScore),
}));

export const realmReliabilityScores = pgTable("realm_reliability_scores", {
    id: uuid("id").primaryKey().defaultRandom(),
    realm: text("realm").notNull(),
    contextScope: text("context_scope"),
    reliabilityScore: doublePrecision("reliability_score").notNull(),
    overboostRate: doublePrecision("overboost_rate"),
    underboostRate: doublePrecision("underboost_rate"),
    sampleSize: integer("sample_size").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    realmIdx: index("idx_realm_reliability_realm").on(t.realm),
    scoreIdx: index("idx_realm_reliability_score").on(t.reliabilityScore),
}));


