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
// PREDICTION INTELLIGENCE DOMAIN - HIDDEN STATE POD - DRIZZLE SCHEMA
// Spec Â§28: hidden_state_estimates, candidates, transitions, splits, influences
// ============================================================================

export const hiddenStateEstimates = pgTable("hidden_state_estimates", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    windowId: uuid("window_id"),
    topCandidateId: uuid("top_candidate_id"),
    topLabel: text("top_label"),
    confidence: doublePrecision("confidence").notNull(),
    entropy: doublePrecision("entropy").notNull(),
    splitDetected: boolean("split_detected").notNull().default(false),
    collapseDetected: boolean("collapse_detected").notNull().default(false),
    dominantAttractorId: uuid("dominant_attractor_id"),
    fieldSummaryId: uuid("field_summary_id"),
    realmAgreementId: uuid("realm_agreement_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    contextTimeIdx: index("idx_hidden_state_estimates_context_time").on(t.contextId, t.createdAt),
    topLabelIdx: index("idx_hidden_state_estimates_top_label").on(t.topLabel),
}));

export const hiddenStateCandidates = pgTable("hidden_state_candidates", {
    id: uuid("id").primaryKey().defaultRandom(),
    estimateId: uuid("estimate_id").notNull().references(() => hiddenStateEstimates.id, { onDelete: "cascade" }),
    contextId: uuid("context_id").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    probability: doublePrecision("probability").notNull(),
    activation: doublePrecision("activation").notNull(),
    persistence: doublePrecision("persistence").notNull(),
    entropy: doublePrecision("entropy").notNull(),
    supportingQuantIds: uuid("supporting_quant_ids").array().default([]),
    opposingQuantIds: uuid("opposing_quant_ids").array().default([]),
    supportingEventIds: uuid("supporting_event_ids").array().default([]),
    opposingEventIds: uuid("opposing_event_ids").array().default([]),
    realmContributionIds: uuid("realm_contribution_ids").array().default([]),
    memoryIds: uuid("memory_ids").array().default([]),
    attractorIds: uuid("attractor_ids").array().default([]),
    explanation: text("explanation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    estimateIdx: index("idx_hidden_state_candidates_estimate").on(t.estimateId),
    contextIdx: index("idx_hidden_state_candidates_context").on(t.contextId, t.createdAt),
    labelIdx: index("idx_hidden_state_candidates_label").on(t.label),
}));

export const hiddenStateTransitions = pgTable("hidden_state_transitions", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    fromStateId: uuid("from_state_id"),
    toStateId: uuid("to_state_id").notNull(),
    transitionType: text("transition_type").notNull(),
    probability: doublePrecision("probability").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    evidenceIds: uuid("evidence_ids").array().default([]),
    explanation: text("explanation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    contextTimeIdx: index("idx_hidden_state_transitions_context_time").on(t.contextId, t.createdAt),
    fromIdx: index("idx_hidden_state_transitions_from").on(t.fromStateId),
    toIdx: index("idx_hidden_state_transitions_to").on(t.toStateId),
}));

export const hiddenStateSplits = pgTable("hidden_state_splits", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    candidateStateIds: uuid("candidate_state_ids").array().notNull(),
    tensionScore: doublePrecision("tension_score").notNull(),
    entropyDelta: doublePrecision("entropy_delta").notNull(),
    possibleExplanations: text("possible_explanations").array().default([]),
    evidenceIds: uuid("evidence_ids").array().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    contextTimeIdx: index("idx_hidden_state_splits_context_time").on(t.contextId, t.createdAt),
}));

export const hiddenStateInfluences = pgTable("hidden_state_influences", {
    id: uuid("id").primaryKey().defaultRandom(),
    hiddenStateId: uuid("hidden_state_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    effect: text("effect").notNull(),
    amount: doublePrecision("amount").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    explanation: text("explanation"),
    evidenceIds: uuid("evidence_ids").array().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    stateIdx: index("idx_hidden_state_influences_state").on(t.hiddenStateId),
    targetIdx: index("idx_hidden_state_influences_target").on(t.targetType, t.targetId),
}));


