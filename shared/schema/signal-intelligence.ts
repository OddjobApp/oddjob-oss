/**
 * Signal Intelligence Schema
 * External signal ingestion, event primitives, causal graph, and autonomous action policies
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  jsonb,
  real,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";
import { projects } from "./projects.js";
import { operationalCycles } from "./operational-cycles.js";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";

// ============================================================================
// ENUMS
// ============================================================================

export const feedSourceTypes = [
  "rss",
  "sec_filing",
  "eu_legislative",
  "central_bank",
  "trade_policy",
  "geo_spatial",
  "rest_api",
  "webhook",
  "internal_event",
  // Only add a value here when a dedicated fetcher is registered for it in
  // server/domain/signal-intelligence/core/fetchers/. `getFetcher` falls back to
  // the generic HTTP fetcher, so a type without one is a label: it validates,
  // persists and displays while being retrieved exactly like an RSS URL.
  "reddit",
  // Bridge connecting authenticated enterprise SaaS adapters (Jira, GitHub, Slack,
  // ServiceNow) into the Signal Studio event stream and CEL rule evaluation.
  "saas_adapter",
] as const;
export type FeedSourceType = (typeof feedSourceTypes)[number];

export const eventTypes = [
  "Policy_Change",
  "Operational_Disruption",
  "Market_Shift",
  "Regulatory_Update",
  "Security_Incident",
  "Supply_Chain_Event",
  "Compliance_Mandate",
  "Tariff_Updated",
  "Regulation_Enacted",
  "Sanction_Imposed",
  "Trade_Agreement_Modified",
  "Central_Bank_Rate_Change",
  "Export_Control_Updated",
  "Compliance_Deadline_Set",
] as const;
export type EventType = (typeof eventTypes)[number];

export const targetSectors = [
  "Enterprise_Operations",
  "Infrastructure",
  "Supply_Chain",
  "General",
  "Semiconductor",
  "Energy",
  "Finance",
  "Healthcare",
  "Agriculture",
  "Defense",
  "Technology",
  "Manufacturing",
] as const;
export type TargetSector = (typeof targetSectors)[number];

export const severities = ["Low", "Medium", "High", "Critical"] as const;
export type Severity = (typeof severities)[number];

export const actionTypes = [
  "spawn_cycle",
  "create_rfc",
  "update_compliance_check",
  "modify_spatial_routing",
] as const;
export type ActionType = (typeof actionTypes)[number];

export const approvalGates = [
  "auto_approve",
  "require_human_approval",
] as const;
export type ApprovalGate = (typeof approvalGates)[number];

// ============================================================================
// SIGNAL FEEDS TABLE
// ============================================================================

export const signalFeeds = pgTable("signal_feeds", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),
  sourceType: text("source_type").notNull(), // FeedSourceType
  url: text("url").notNull(),
  authCredentials: jsonb("auth_credentials"),
  pollingIntervalSeconds: integer("polling_interval_seconds").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  status: text("status").notNull().default("active"), // active | degraded | disabled
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastPollAt: timestamp("last_poll_at"),
  lastSuccessAt: timestamp("last_success_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  orgIdx: index("idx_signal_feeds_org").on(t.organizationId),
  statusIdx: index("idx_signal_feeds_status").on(t.organizationId, t.status),
}));

// ============================================================================
// EVENT PRIMITIVES TABLE
// ============================================================================

export const eventPrimitives = pgTable("event_primitives", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: integer("organization_id").notNull(),
  /** Project Space that owns the signal. NULL means explicitly org-global. */
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
  sourceEntryId: text("source_entry_id").notNull(),
  eventType: text("event_type").notNull(), // EventType
  targetSector: text("target_sector").notNull(), // TargetSector
  jurisdiction: text("jurisdiction").notNull(),
  severity: text("severity").notNull(), // Severity
  sourceUrl: text("source_url").notNull(),
  extractionTimestamp: timestamp("extraction_timestamp").notNull(),
  confidenceScore: real("confidence_score").notNull(),
  rawText: text("raw_text"),
  flags: jsonb("flags").notNull().default(sql`'[]'::jsonb`),
  contentHash: text("content_hash").notNull(),

  // --- Spatial telemetry -----------------------------------------------
  // Consumed by the spatial predicate engine. All nullable: a signal without
  // coordinates simply cannot satisfy a spatial condition.
  latitude: real("latitude"),
  longitude: real("longitude"),
  /** Res-7 cell for the observed position; indexed for O(1) geofence joins. */
  h3Index: text("h3_index"),
  /** Cell at the previous telemetry tick — drives ON_ENTER / ON_EXIT edges. */
  previousH3Index: text("previous_h3_index"),
  /** Minutes inside the current zone, for ON_DWELL SLA tests. */
  dwellMinutes: real("dwell_minutes"),
  velocityKnots: real("velocity_knots"),
  headingDegrees: real("heading_degrees"),
  /** Approved trajectory position, for spatial_drift. */
  projectedLatitude: real("projected_latitude"),
  projectedLongitude: real("projected_longitude"),
  /** Isotropic flux density Φ in the occupied cell, 0-1. */
  fluxDensityPhi: real("flux_density_phi"),
  /** Per-tile metrics keyed by H3 index, for grouped tile-set aggregations. */
  cellMetrics: jsonb("cell_metrics"),
  /**
   * Tracked entity this observation belongs to (vessel, asset, sensor).
   * Required to derive ENTER/EXIT transitions and dwell across observations.
   */
  subjectId: text("subject_id"),
  /**
   * How the position was determined: telemetry | gazetteer | geocoder |
   * jurisdiction | none. Read by the predicate engine's precision gate.
   */
  spatialSource: text("spatial_source"),
  /**
   * Accuracy radius in metres. A jurisdiction centroid is ~500km and must not
   * be allowed to satisfy a 5km geofence predicate.
   */
  spatialPrecisionM: real("spatial_precision_m"),
  /**
   * Horizontal Dilution of Precision, as reported by the receiver (NMEA GGA).
   *
   * Describes satellite GEOMETRY, not distance — horizontal error ≈ HDOP × UERE.
   * Kept alongside `spatialPrecisionM` rather than replacing it: most sources
   * supply only a radius, and a radius is the isotropic special case.
   *
   * MUST BE HDOP, NOT PDOP. `PDOP² = HDOP² + VDOP²`, and vertical geometry is
   * systematically worse because every satellite is overhead. H3 containment is
   * two-dimensional, so PDOP would inflate the error region with vertical error
   * that cannot affect the answer. Use `horizontalDopFromPdop()` to convert.
   */
  spatialHdop: real("spatial_hdop"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  orgIdx: index("idx_event_primitives_org").on(t.organizationId),
  severityIdx: index("idx_event_primitives_severity").on(t.severity),
  sectorIdx: index("idx_event_primitives_sector").on(t.targetSector),
  jurisdictionIdx: index("idx_event_primitives_jurisdiction").on(t.jurisdiction),
  confidenceIdx: index("idx_event_primitives_confidence").on(t.confidenceScore),
  hashIdx: index("idx_event_primitives_hash").on(t.contentHash),
  h3Idx: index("idx_event_primitives_h3").on(t.h3Index),
  // The resolver reads the subject's latest fix on every ingest, so this
  // lookup is on the hot path.
  subjectIdx: index("idx_event_primitives_subject").on(
    t.organizationId,
    t.subjectId,
    t.extractionTimestamp
  ),
}));

// ============================================================================
// CAUSAL GRAPH LINKS TABLE
// ============================================================================

export const causalGraphLinks = pgTable("causal_graph_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: integer("organization_id").notNull(),
  eventPrimitiveId: uuid("event_primitive_id").notNull().references(() => eventPrimitives.id),
  targetEntityType: text("target_entity_type").notNull(), // cycle | mission | workstream | supplier | geo_region
  targetEntityId: text("target_entity_id").notNull(),
  impactHorizonMinDays: integer("impact_horizon_min_days").notNull(),
  impactHorizonMaxDays: integer("impact_horizon_max_days").notNull(),
  impactConfidence: integer("impact_confidence").notNull(),
  blastRadius: integer("blast_radius").notNull().default(0),
  depth: integer("depth").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  eventIdx: index("idx_causal_graph_links_event").on(t.eventPrimitiveId),
  entityIdx: index("idx_causal_graph_links_entity").on(t.targetEntityType, t.targetEntityId),
  orgIdx: index("idx_causal_graph_links_org").on(t.organizationId),
}));

// ============================================================================
// AUTONOMOUS ACTION POLICIES TABLE
// ============================================================================

export const autonomousActionPolicies = pgTable("autonomous_action_policies", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),
  triggerCondition: jsonb("trigger_condition").notNull(),
  actionType: text("action_type").notNull(), // ActionType
  approvalGate: text("approval_gate").notNull().default("require_human_approval"), // ApprovalGate
  effectiveApprovalGate: text("effective_approval_gate").notNull().default("require_human_approval"),
  volatilityOverride: boolean("volatility_override").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  orgIdx: index("idx_aap_org").on(t.organizationId),
  enabledIdx: index("idx_aap_enabled").on(t.organizationId, t.enabled),
}));

// ============================================================================
// STATE TRANSITION EVENTS TABLE
// ============================================================================

export const stateTransitionEvents = pgTable("state_transition_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: integer("organization_id").notNull(),
  eventPrimitiveId: uuid("event_primitive_id").references(() => eventPrimitives.id),
  affectedEntities: jsonb("affected_entities").notNull().default(sql`'[]'::jsonb`),
  impactHorizons: jsonb("impact_horizons").notNull().default(sql`'{}'::jsonb`),
  environmentVariables: jsonb("environment_variables").notNull().default(sql`'{}'::jsonb`),
  status: text("status").notNull().default("pending"), // pending | accepted | failed | dead_letter
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  orgIdx: index("idx_ste_org").on(t.organizationId),
  statusIdx: index("idx_ste_status").on(t.status),
  createdIdx: index("idx_ste_created").on(t.createdAt),
}));

// ============================================================================
// CYCLE SIGNAL SUBSCRIPTIONS + WORLD STATE
// ============================================================================

export const cycleSignalSubscriptions = pgTable("cycle_signal_subscriptions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  cycleId: integer("cycle_id").notNull().references(() => operationalCycles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  filters: jsonb("filters").notNull().default(sql`'{}'::jsonb`),
  deliveryMode: text("delivery_mode").notNull().default("context_only"),
  stateProjection: jsonb("state_projection").notNull().default(sql`'{"namespace":"external_environment","reducer":"latest"}'::jsonb`),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(0),
  lastDeliveredAt: timestamp("last_delivered_at"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  orgIdx: index("idx_cycle_signal_subscriptions_org").on(t.organizationId),
  cycleIdx: index("idx_cycle_signal_subscriptions_cycle").on(t.cycleId),
}));

export const cycleWorldStates = pgTable("cycle_world_states", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  cycleId: integer("cycle_id").notNull().references(() => operationalCycles.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(0),
  variables: jsonb("variables").notNull().default(sql`'{}'::jsonb`),
  materialChanges: jsonb("material_changes").notNull().default(sql`'[]'::jsonb`),
  lastEventPrimitiveId: uuid("last_event_primitive_id").references(() => eventPrimitives.id, { onDelete: "set null" }),
  lastStateTransitionId: uuid("last_state_transition_id").references(() => stateTransitionEvents.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  cycleUnique: uniqueIndex("cycle_world_states_cycle_unique").on(t.cycleId),
  orgIdx: index("idx_cycle_world_states_org").on(t.organizationId),
}));

export const cycleSignalDeliveries = pgTable("cycle_signal_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  subscriptionId: integer("subscription_id").notNull().references(() => cycleSignalSubscriptions.id, { onDelete: "cascade" }),
  cycleId: integer("cycle_id").notNull().references(() => operationalCycles.id, { onDelete: "cascade" }),
  eventPrimitiveId: uuid("event_primitive_id").notNull().references(() => eventPrimitives.id, { onDelete: "cascade" }),
  stateTransitionId: uuid("state_transition_id").references(() => stateTransitionEvents.id, { onDelete: "set null" }),
  status: text("status").notNull().default("delivered"),
  disposition: text("disposition").notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  deliveredAt: timestamp("delivered_at").defaultNow().notNull(),
}, (t) => ({
  eventUnique: uniqueIndex("cycle_signal_deliveries_subscription_event_unique").on(t.subscriptionId, t.eventPrimitiveId),
  cycleIdx: index("idx_cycle_signal_deliveries_cycle").on(t.cycleId, t.deliveredAt),
}));

// ============================================================================
// AUTONOMOUS ACTION LOGS TABLE
// ============================================================================

export const autonomousActionLogs = pgTable("autonomous_action_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  eventPrimitiveId: uuid("event_primitive_id").references(() => eventPrimitives.id),
  policyId: integer("policy_id").references(() => autonomousActionPolicies.id),
  actionType: text("action_type").notNull(), // ActionType
  approvalStatus: text("approval_status").notNull(), // auto_approved | pending | approved | rejected | escalated | timed_out
  executedAt: timestamp("executed_at"),
  outcome: text("outcome"), // success | failure
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  orgIdx: index("idx_aal_org").on(t.organizationId),
  policyIdx: index("idx_aal_policy").on(t.policyId),
}));

// ============================================================================
// AUTONOMOUS ACTION ARTIFACTS
// ============================================================================

/**
 * The durable thing an autonomous action produced.
 *
 * `create_rfc`, `update_compliance_check` and `modify_spatial_routing` had no
 * consumer at all — they published to an empty room and reported success for it.
 * There was nothing to consume them WITH: no RFC, compliance-check or
 * spatial-routing table exists anywhere in the schema.
 *
 * All three share one shape rather than getting three half-domains, because what
 * they genuinely have in common is producing a record a human or agent must act
 * on — a proposed change, a compliance finding, a routing directive — attributed
 * to the signal and policy that caused it.
 *
 * A substrate, not an integration: it records the decision, its scope and its
 * provenance. Filing the RFC in an external change-management system is a
 * per-action integration that belongs behind this table, not instead of it.
 */
export const autonomousActionArtifacts = pgTable("autonomous_action_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  /** Nullable so purging signal history does not destroy what was done about it. */
  eventPrimitiveId: uuid("event_primitive_id").references(() => eventPrimitives.id, { onDelete: "set null" }),
  policyId: integer("policy_id").references(() => autonomousActionPolicies.id, { onDelete: "set null" }),
  /** rfc | compliance_finding | routing_directive */
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  /** open | acknowledged | resolved | dismissed */
  status: text("status").notNull().default("open"),
  severity: text("severity"),
  jurisdiction: text("jurisdiction"),
  targetSector: text("target_sector"),
  /** Length is the observed blast radius reported to the prediction-error loop. */
  affectedEntityIds: jsonb("affected_entity_ids").notNull().default(sql`'[]'::jsonb`),
  details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  openIdx: index("idx_action_artifacts_open").on(t.organizationId, t.status, t.createdAt),
  eventIdx: index("idx_action_artifacts_event").on(t.eventPrimitiveId),
  kindIdx: index("idx_action_artifacts_kind").on(t.organizationId, t.kind, t.createdAt),
}));

export type AutonomousActionArtifact = typeof autonomousActionArtifacts.$inferSelect;

// ============================================================================
// INSERT SCHEMAS
// ============================================================================

export const insertSignalFeedSchema = createInsertSchema(signalFeeds).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertEventPrimitiveSchema = createInsertSchema(eventPrimitives).omit({
  id: true,
  createdAt: true,
});

export const insertCausalGraphLinkSchema = createInsertSchema(causalGraphLinks).omit({
  id: true,
  createdAt: true,
});

export const insertAutonomousActionPolicySchema = createInsertSchema(autonomousActionPolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertStateTransitionEventSchema = createInsertSchema(stateTransitionEvents).omit({
  id: true,
  createdAt: true,
});

export const insertCycleSignalSubscriptionSchema = createInsertSchema(cycleSignalSubscriptions).omit({
  id: true,
  lastDeliveredAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAutonomousActionLogSchema = createInsertSchema(autonomousActionLogs).omit({
  id: true,
  createdAt: true,
});

// ============================================================================
// SIGNAL ACTIONS TABLE (Triage: dismiss, escalate, snooze)
// ============================================================================

export const bulkActionTypes = ["dismiss", "escalate", "snooze"] as const;
export type BulkActionType = (typeof bulkActionTypes)[number];

export const snoozeDurations = ["15m", "1h", "4h", "24h"] as const;
export type SnoozeDuration = (typeof snoozeDurations)[number];

export const signalActions = pgTable("signal_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: integer("organization_id").notNull(),
  signalId: uuid("signal_id").notNull().references(() => eventPrimitives.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // BulkActionType: dismiss | escalate | snooze
  performedBy: text("performed_by").notNull(),
  snoozedUntil: timestamp("snoozed_until"), // Only set for snooze actions
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  orgIdx: index("idx_signal_actions_org").on(t.organizationId),
  signalIdx: index("idx_signal_actions_signal").on(t.signalId),
  activeIdx: index("idx_signal_actions_active").on(t.organizationId, t.signalId, t.active),
}));

export const insertSignalActionSchema = createInsertSchema(signalActions).omit({
  id: true,
  createdAt: true,
});

// ============================================================================
// TYPES
// ============================================================================

export type SignalAction = typeof signalActions.$inferSelect;
export type InsertSignalAction = z.infer<typeof insertSignalActionSchema>;

export type SignalFeedConfig = typeof signalFeeds.$inferSelect;
export type InsertSignalFeed = z.infer<typeof insertSignalFeedSchema>;

export type EventPrimitive = typeof eventPrimitives.$inferSelect;
export type InsertEventPrimitive = z.infer<typeof insertEventPrimitiveSchema>;

export type CausalGraphLink = typeof causalGraphLinks.$inferSelect;
export type InsertCausalGraphLink = z.infer<typeof insertCausalGraphLinkSchema>;

export type AutonomousActionPolicy = typeof autonomousActionPolicies.$inferSelect;
export type InsertAutonomousActionPolicy = z.infer<typeof insertAutonomousActionPolicySchema>;

export type StateTransitionEvent = typeof stateTransitionEvents.$inferSelect;
export type InsertStateTransitionEvent = z.infer<typeof insertStateTransitionEventSchema>;

export type CycleSignalSubscription = typeof cycleSignalSubscriptions.$inferSelect;
export type InsertCycleSignalSubscription = z.infer<typeof insertCycleSignalSubscriptionSchema>;
export type CycleWorldState = typeof cycleWorldStates.$inferSelect;
export type CycleSignalDelivery = typeof cycleSignalDeliveries.$inferSelect;

export type AutonomousActionLog = typeof autonomousActionLogs.$inferSelect;
export type InsertAutonomousActionLog = z.infer<typeof insertAutonomousActionLogSchema>;

// ============================================================================
// GOVERNED RULES & DECISION INTELLIGENCE ENGINE (GRIE) SCHEMA
// ============================================================================

export const ruleSuites = pgTable("rule_suites", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  /**
   * Project Space scope — the durable namespace between org and cycle.
   * Nullable so pre-existing suites stay readable; new suites are written with
   * the caller's resolved project, and reads filter on it.
   */
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
  suiteId: text("suite_id").notNull(),
  suiteName: text("suite_name").notNull(),
  category: text("category").notNull().default("Supply Chain & Logistics"),
  version: text("version").notNull().default("1.0.0"),
  owner: text("owner").notNull().default("Operations Team"),
  description: text("description"),
  executionPolicy: text("execution_policy").notNull().default("HIGHEST_PRIORITY_MAUF"),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  orgIdx: index("idx_rule_suites_org").on(t.organizationId),
  projectIdx: index("idx_rule_suites_project").on(t.organizationId, t.projectId),
  scopeUnique: uniqueIndex("idx_rule_suites_scope_unique").on(t.organizationId, t.projectId, t.suiteId),
}));

export const ruleSpecifications = pgTable("rule_specifications", {
  id: serial("id").primaryKey(),
  suiteDbId: integer("suite_db_id").notNull().references(() => ruleSuites.id, { onDelete: "cascade" }),
  ruleId: text("rule_id").notNull(),
  ruleName: text("rule_name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  priorityWeight: integer("priority_weight").notNull().default(50),
  specification: jsonb("specification").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  suiteIdx: index("idx_rule_specs_suite").on(t.suiteDbId),
  ruleUnique: uniqueIndex("idx_rule_specs_unique").on(t.suiteDbId, t.ruleId),
}));

export const ruleExecutionAudits = pgTable("rule_execution_audits", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
  ruleSpecificationId: integer("rule_specification_id").references(() => ruleSpecifications.id, { onDelete: "set null" }),
  suiteId: text("suite_id").notNull(),
  ruleId: text("rule_id").notNull(),
  eventPrimitiveId: uuid("event_primitive_id").references(() => eventPrimitives.id, { onDelete: "set null" }),
  masterPriorityScore: integer("master_priority_score").notNull(),
  matchedBranch: text("matched_branch").notNull(),
  disposition: text("disposition").notNull(),
  fuzzyScores: jsonb("fuzzy_scores").notNull().default(sql`'{}'::jsonb`),
  actionTaken: jsonb("action_taken").notNull().default(sql`'{}'::jsonb`),
  /**
   * matched | no_match | error.
   *
   * Audits used to be written only for rules that PASSED, so a rule that
   * evaluated and legitimately did not match looked identical to one that threw
   * — and to one that was never reached at all. That made "why didn't my rule
   * fire?" unanswerable from the data.
   */
  outcome: text("outcome").notNull().default("matched"),
  /** Set when `outcome` is 'error'. */
  failureReason: text("failure_reason"),
  /**
   * Per-condition spatial explanations for this evaluation, when the rule
   * carried spatial conditions. Carries the precision gate's "position is
   * unknown, not outside" reasoning, which was previously reachable only
   * through the Rule Builder's dry run and never for a live signal.
   */
  spatialTrace: jsonb("spatial_trace"),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
}, (t) => ({
  orgIdx: index("idx_rule_audits_org").on(t.organizationId, t.executedAt),
  eventIdx: index("idx_rule_audits_event").on(t.eventPrimitiveId, t.executedAt),
  outcomeIdx: index("idx_rule_audits_outcome").on(t.organizationId, t.outcome, t.executedAt),
}));

/**
 * Durable confirmation counters for the spatial iteration gate.
 *
 * Held in memory the gate is correct only within one process lifetime: a
 * restart drops a LATCHED geofence back to unconfirmed, so an asset already
 * inside a zone re-fires ON_ENTER after every deploy — a duplicate alert for an
 * entry that already happened.
 *
 * One row per (org, condition, subject). The engine treats this as a
 * write-behind cache: it hydrates before evaluating and flushes after, so the
 * hot path stays an in-memory map lookup.
 */
export const spatialConditionState = pgTable("spatial_condition_state", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  /** Stable id of the condition within its rule. */
  conditionKey: text("condition_key").notNull(),
  /** Tracked entity; "__global__" for feeds with no subject. */
  subjectId: text("subject_id").notNull(),
  hits: integer("hits").notNull().default(0),
  misses: integer("misses").notNull().default(0),
  latched: boolean("latched").notNull().default(false),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
}, (t) => ({
  // The engine reads and upserts by this triple on every evaluation.
  keyUnique: uniqueIndex("idx_spatial_condition_state_key").on(
    t.organizationId,
    t.conditionKey,
    t.subjectId
  ),
  // Supports pruning entries no longer being fed.
  staleIdx: index("idx_spatial_condition_state_stale").on(t.lastSeenAt),
}));

export type SpatialConditionState = typeof spatialConditionState.$inferSelect;

export type RuleSuite = typeof ruleSuites.$inferSelect;
export type RuleSpecification = typeof ruleSpecifications.$inferSelect;
export type RuleExecutionAudit = typeof ruleExecutionAudits.$inferSelect;

