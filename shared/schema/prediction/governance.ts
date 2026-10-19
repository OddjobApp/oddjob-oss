import {
    pgTable,
    uuid,
    text,
    boolean,
    doublePrecision,
    timestamp,
    jsonb,
    index,
    unique,
} from "drizzle-orm/pg-core";

// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - GOVERNANCE POD - DRIZZLE SCHEMA
// Spec Â§45: governance_decisions, governance_policies, governance_audit_logs, governance_simulations
// ============================================================================

export const governanceDecisions = pgTable("governance_decisions", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id").notNull(),
    subjectId: text("subject_id"),
    decision: text("decision").notNull(),
    allowed: boolean("allowed").notNull(),
    maxActionLevel: text("max_action_level").notNull(),
    riskClass: text("risk_class").notNull(),
    requiresHumanConfirmation: boolean("requires_human_confirmation").notNull().default(false),
    requiresExplanation: boolean("requires_explanation").notNull().default(false),
    requiresAudit: boolean("requires_audit").notNull().default(true),
    confidenceThreshold: doublePrecision("confidence_threshold"),
    confidenceAdjustment: doublePrecision("confidence_adjustment"),
    redactions: jsonb("redactions").notNull().default([]),
    constraints: jsonb("constraints").notNull().default([]),
    policyTrace: jsonb("policy_trace").notNull().default([]),
    reason: text("reason").notNull(),
    evidenceIds: uuid("evidence_ids").array().default([]),
    policyVersion: text("policy_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull().default({}),
}, (t) => ({
    contextTimeIdx: index("idx_governance_decisions_context_time").on(t.contextId, t.createdAt),
    subjectIdx: index("idx_governance_decisions_subject").on(t.subjectId),
    decisionIdx: index("idx_governance_decisions_decision").on(t.decision),
    riskIdx: index("idx_governance_decisions_risk").on(t.riskClass),
}));

export const governancePolicies = pgTable("governance_policies", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    status: text("status").notNull().default("active"),
    policyType: text("policy_type").notNull(),
    definition: jsonb("definition").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
}, (t) => ({
    statusIdx: index("idx_governance_policies_status").on(t.status),
    typeIdx: index("idx_governance_policies_type").on(t.policyType),
    uniqueNameVersion: unique().on(t.name, t.version),
}));

export const governanceAuditLogs = pgTable("governance_audit_logs", {
    id: uuid("id").primaryKey().defaultRandom(),
    decisionId: uuid("decision_id").references(() => governanceDecisions.id),
    contextId: uuid("context_id").notNull(),
    subjectId: text("subject_id"),
    actionType: text("action_type"),
    resourceType: text("resource_type"),
    decision: text("decision").notNull(),
    policyVersion: text("policy_version").notNull(),
    auditPayload: jsonb("audit_payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    contextTimeIdx: index("idx_governance_audit_context_time").on(t.contextId, t.createdAt),
    subjectIdx: index("idx_governance_audit_subject").on(t.subjectId),
    actionIdx: index("idx_governance_audit_action").on(t.actionType),
}));

export const governanceSimulations = pgTable("governance_simulations", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id"),
    policyVersion: text("policy_version").notNull(),
    inputPayload: jsonb("input_payload").notNull(),
    resultPayload: jsonb("result_payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    contextTimeIdx: index("idx_governance_simulations_context_time").on(t.contextId, t.createdAt),
}));


