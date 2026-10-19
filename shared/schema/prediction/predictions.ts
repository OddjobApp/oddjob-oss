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
// PREDICTION INTELLIGENCE DOMAIN - PREDICTION POD - DRIZZLE SCHEMA
// Spec section 29: predictions, prediction_branches, prediction_contracts
// ============================================================================

export const predictions = pgTable("predictions", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    organizationId: integer("organization_id"),
    mode: text("mode").notNull(),
    topPredicate: text("top_predicate"),
    confidence: doublePrecision("confidence").notNull().default(0),
    entropy: doublePrecision("entropy").notNull().default(1),
    collapseDetected: boolean("collapse_detected").notNull().default(false),
    quantFieldSummaryId: uuid("quant_field_summary_id"),
    hiddenStateEstimateId: uuid("hidden_state_estimate_id"),
    realmAgreementId: uuid("realm_agreement_id"),
    forwardChamber: jsonb("forward_chamber"),
    reverseChamber: jsonb("reverse_chamber"),
    bicameral: jsonb("bicameral"),
    provenance: jsonb("provenance").notNull().default({}),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    contextTimeIdx: index("idx_predictions_context_time").on(t.contextId, t.createdAt),
    orgContextTimeIdx: index("idx_predictions_org_context_time").on(t.organizationId, t.contextId, t.createdAt),
    topPredicateIdx: index("idx_predictions_top_predicate").on(t.topPredicate),
    entropyIdx: index("idx_predictions_entropy").on(t.entropy),
}));

export const predictionBranches = pgTable("prediction_branches", {
    id: uuid("id").primaryKey().defaultRandom(),
    predictionId: uuid("prediction_id").notNull().references(() => predictions.id, { onDelete: "cascade" }),
    contextId: uuid("context_id").notNull(),
    organizationId: integer("organization_id"),
    parentBranchId: uuid("parent_branch_id"),
    generation: integer("generation").notNull().default(0),
    predicate: text("predicate").notNull(),
    postPredicates: jsonb("post_predicates").$type<string[]>().notNull().default([]),
    probability: doublePrecision("probability").notNull().default(0),
    confidence: doublePrecision("confidence").notNull().default(0),
    branchScore: doublePrecision("branch_score").notNull().default(0),
    entropy: doublePrecision("entropy").notNull().default(1),
    expectedValue: doublePrecision("expected_value").notNull().default(0),
    status: text("status").notNull().default("candidate"),
    supportingQuantIds: jsonb("supporting_quant_ids").$type<string[]>().notNull().default([]),
    interferingQuantIds: jsonb("interfering_quant_ids").$type<string[]>().notNull().default([]),
    supportingEventIds: jsonb("supporting_event_ids").$type<string[]>().notNull().default([]),
    opposingEventIds: jsonb("opposing_event_ids").$type<string[]>().notNull().default([]),
    forwardScore: doublePrecision("forward_score"),
    reverseScore: doublePrecision("reverse_score"),
    bicameralAgreement: doublePrecision("bicameral_agreement"),
    collapseSignalId: uuid("collapse_signal_id"),
    prunedReason: text("pruned_reason"),
    explanation: text("explanation"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    predictionIdx: index("idx_prediction_branches_prediction").on(t.predictionId),
    contextTimeIdx: index("idx_prediction_branches_context").on(t.contextId, t.createdAt),
    orgContextTimeIdx: index("idx_prediction_branches_org_context").on(t.organizationId, t.contextId, t.createdAt),
    statusIdx: index("idx_prediction_branches_status").on(t.status),
    predicateIdx: index("idx_prediction_branches_predicate").on(t.predicate),
}));

export const predictionContracts = pgTable("prediction_contracts", {
    id: uuid("id").primaryKey().defaultRandom(),
    predictionId: uuid("prediction_id").notNull().references(() => predictions.id, { onDelete: "cascade" }),
    contextId: uuid("context_id").notNull(),
    organizationId: integer("organization_id"),
    contract: jsonb("contract").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    predictionIdx: index("idx_prediction_contracts_prediction").on(t.predictionId),
    contextTimeIdx: index("idx_prediction_contracts_context_time").on(t.contextId, t.createdAt),
    orgContextTimeIdx: index("idx_prediction_contracts_org_context_time").on(t.organizationId, t.contextId, t.createdAt),
}));


