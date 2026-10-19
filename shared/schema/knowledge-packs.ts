import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { z } from "zod";
import { orgs } from "./auth.js";
import { approvalRequests } from "./hil.js";

export const GovernanceDecisionSchema = z.enum(["ALLOW", "BLOCK", "APPROVAL_REQUIRED", "INSUFFICIENT_CONTEXT"]);
export type GovernanceDecision = z.infer<typeof GovernanceDecisionSchema>;

export const KnowledgePackControlSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  actionTypes: z.array(z.string().min(1)).min(1),
  effect: z.enum(["BLOCK", "APPROVAL_REQUIRED"]),
  requiredContext: z.array(z.string()).default([]),
  conditions: z.array(z.object({
    field: z.string().min(1),
    operator: z.enum(["equals", "not_equals", "known", "hash_matches"]),
    value: z.unknown().optional(),
  })).default([]),
  remediation: z.array(z.string()).default([]),
});

export const KnowledgePackManifestSchema = z.object({
  apiVersion: z.literal("oddjob.io/v1"),
  kind: z.literal("KnowledgePack"),
  metadata: z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    publisher: z.string().min(1),
    contentHash: z.string().min(1),
    synthetic: z.boolean().default(false),
  }),
  scope: z.object({ domains: z.array(z.string()), jurisdictions: z.array(z.string()) }),
  requiredProfileFields: z.array(z.string()).default([]),
  controls: z.array(KnowledgePackControlSchema).min(1),
  certification: z.object({ minimumPassRate: z.number().min(0).max(1).default(1), requiresComplianceApproval: z.boolean().default(true) }),
});
export type KnowledgePackManifest = z.infer<typeof KnowledgePackManifestSchema>;

export const BlueprintGovernanceDependencySchema = z.object({
  pack: z.string().min(1),
  version: z.string().min(1),
  required: z.boolean().default(true),
  requiredControls: z.array(z.string()).default([]),
  requiredContext: z.array(z.string()).default([]),
  unresolvedBehavior: z.literal("BLOCK").default("BLOCK"),
});

export const knowledgePacks = pgTable("knowledge_packs", {
  id: serial("id").primaryKey(),
  packKey: varchar("pack_key", { length: 160 }).notNull(),
  version: varchar("version", { length: 32 }).notNull(),
  name: text("name").notNull(),
  publisher: text("publisher").notNull(),
  contentHash: text("content_hash").notNull(),
  synthetic: boolean("synthetic").default(false).notNull(),
  manifest: jsonb("manifest").notNull(),
  status: varchar("status", { length: 24 }).default("published").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({ packVersionUnq: uniqueIndex("knowledge_packs_key_version_unq").on(table.packKey, table.version) }));

export const orgKnowledgePackInstallations = pgTable("org_knowledge_pack_installations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  knowledgePackId: integer("knowledge_pack_id").notNull().references(() => knowledgePacks.id, { onDelete: "restrict" }),
  status: varchar("status", { length: 24 }).default("staged").notNull(),
  applicabilityProfile: jsonb("applicability_profile").default(sql`'{}'::jsonb`).notNull(),
  compiledPolicy: jsonb("compiled_policy").default(sql`'{}'::jsonb`).notNull(),
  certifiedBy: text("certified_by"),
  certifiedAt: timestamp("certified_at", { withTimezone: true }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({
  orgPackUnq: uniqueIndex("org_knowledge_pack_installations_unq").on(table.organizationId, table.knowledgePackId),
  orgStatusIdx: index("org_knowledge_pack_installations_status_idx").on(table.organizationId, table.status),
}));

export const knowledgePackSources = pgTable("knowledge_pack_sources", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  packKey: varchar("pack_key", { length: 160 }).notNull(),
  title: text("title").notNull(),
  sourceUri: text("source_uri").notNull(),
  authority: varchar("authority", { length: 80 }).notNull(),
  jurisdiction: varchar("jurisdiction", { length: 80 }).notNull(),
  effectiveDate: timestamp("effective_date", { withTimezone: true }),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).defaultNow().notNull(),
  contentHash: text("content_hash").notNull(),
  contentSnapshot: text("content_snapshot").notNull(),
  status: varchar("status", { length: 24 }).default("acquired").notNull(),
  acquiredBy: text("acquired_by").notNull(),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  freshnessDays: integer("freshness_days").default(90).notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
  staleAt: timestamp("stale_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({ orgPackIdx: index("knowledge_pack_sources_org_pack_idx").on(table.organizationId, table.packKey) }));

export const knowledgePackSourceObservations = pgTable("knowledge_pack_source_observations", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => knowledgePackSources.id, { onDelete: "cascade" }),
  observedHash: text("observed_hash").notNull(),
  contentSnapshot: text("content_snapshot").notNull(),
  effectiveDate: timestamp("effective_date", { withTimezone: true }),
  changed: boolean("changed").notNull(),
  checkedBy: text("checked_by").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({ sourceTimeIdx: index("knowledge_pack_source_observations_idx").on(table.sourceId, table.checkedAt) }));

export const knowledgePackChangeCandidates = pgTable("knowledge_pack_change_candidates", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  sourceId: integer("source_id").notNull().references(() => knowledgePackSources.id, { onDelete: "cascade" }),
  observationId: integer("observation_id").notNull().references(() => knowledgePackSourceObservations.id, { onDelete: "cascade" }),
  previousHash: text("previous_hash").notNull(),
  observedHash: text("observed_hash").notNull(),
  status: varchar("status", { length: 24 }).default("open").notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({ orgStatusIdx: index("knowledge_pack_change_candidates_org_status_idx").on(table.organizationId, table.status) }));

export const knowledgePackSourceMonitors = pgTable("knowledge_pack_source_monitors", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  sourceId: integer("source_id").notNull().references(() => knowledgePackSources.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").default(true).notNull(),
  checkIntervalHours: integer("check_interval_hours").default(24).notNull(),
  trustedHosts: text("trusted_hosts").array().default(sql`ARRAY[]::text[]`).notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  escalationHours: integer("escalation_hours").default(48).notNull(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).defaultNow().notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: varchar("last_status", { length: 24 }),
  lastError: text("last_error"),
  lastEscalatedAt: timestamp("last_escalated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({ orgSourceUnq: uniqueIndex("knowledge_pack_source_monitors_unq").on(table.organizationId, table.sourceId), dueIdx: index("knowledge_pack_source_monitors_due_idx").on(table.enabled, table.nextRunAt) }));

export const knowledgePackMonitorRuns = pgTable("knowledge_pack_monitor_runs", {
  id: serial("id").primaryKey(),
  monitorId: integer("monitor_id").notNull().references(() => knowledgePackSourceMonitors.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 24 }).notNull(),
  observedHash: text("observed_hash"),
  changed: boolean("changed"),
  candidateId: integer("candidate_id").references(() => knowledgePackChangeCandidates.id, { onDelete: "set null" }),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, table => ({ monitorTimeIdx: index("knowledge_pack_monitor_runs_idx").on(table.monitorId, table.startedAt) }));

export const knowledgePackSourceLinks = pgTable("knowledge_pack_source_links", {
  id: serial("id").primaryKey(),
  knowledgePackId: integer("knowledge_pack_id").notNull().references(() => knowledgePacks.id, { onDelete: "cascade" }),
  sourceId: integer("source_id").notNull().references(() => knowledgePackSources.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({ packSourceUnq: uniqueIndex("knowledge_pack_source_links_unq").on(table.knowledgePackId, table.sourceId) }));

export const knowledgePackAttestations = pgTable("knowledge_pack_attestations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  knowledgePackId: integer("knowledge_pack_id").notNull().references(() => knowledgePacks.id, { onDelete: "cascade" }),
  attestationType: varchar("attestation_type", { length: 32 }).notNull(),
  decision: varchar("decision", { length: 24 }).notNull(),
  attestedBy: text("attested_by").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({ packTypeActorUnq: uniqueIndex("knowledge_pack_attestations_unq").on(table.organizationId, table.knowledgePackId, table.attestationType, table.attestedBy) }));

export const governanceDecisionEvidence = pgTable("governance_decision_evidence", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  installationId: integer("installation_id").references(() => orgKnowledgePackInstallations.id, { onDelete: "set null" }),
  actionType: varchar("action_type", { length: 160 }).notNull(),
  contextHash: text("context_hash").notNull(),
  decision: varchar("decision", { length: 32 }).notNull(),
  applicableControls: text("applicable_controls").array().default(sql`ARRAY[]::text[]`).notNull(),
  evidence: jsonb("evidence").default(sql`'{}'::jsonb`).notNull(),
  actorId: text("actor_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({ orgTimeIdx: index("governance_decision_evidence_org_time_idx").on(table.organizationId, table.createdAt) }));

export const syntheticFinanceCommunications = pgTable("synthetic_finance_communications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  customerClassification: varchar("customer_classification", { length: 40 }).notNull(),
  archiveTarget: text("archive_target").notNull(),
  status: varchar("status", { length: 32 }).default("draft").notNull(),
  approvalRequestId: integer("approval_request_id").references(() => approvalRequests.id, { onDelete: "set null" }),
  approvedContentHash: text("approved_content_hash"),
  draftedBy: text("drafted_by").notNull(),
  approvedBy: text("approved_by"),
  publishedBy: text("published_by"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => ({ orgStatusIdx: index("synthetic_finance_communications_org_status_idx").on(table.organizationId, table.status) }));
