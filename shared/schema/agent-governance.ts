import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";

export const agentIdentities = pgTable("agent_identities", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  displayName: text("display_name").notNull(),
  ownerId: text("owner_id").notNull(),
  environment: text("environment").notNull().default("dev"),
  status: text("status").notNull().default("draft"),
  riskLevel: text("risk_level").notNull().default("medium"),
  policyBundleId: text("policy_bundle_id"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdBy: text("created_by").notNull(),
  lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_agent_identities_org").on(table.organizationId),
  index("idx_agent_identities_agent").on(table.agentId),
  index("idx_agent_identities_status").on(table.status),
]);

export const agentPolicyBundles = pgTable("agent_policy_bundles", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  riskLevel: text("risk_level").notNull().default("medium"),
  grants: jsonb("grants").notNull().default(sql`'[]'::jsonb`),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_agent_policy_bundles_org").on(table.organizationId),
  index("idx_agent_policy_bundles_status").on(table.status),
]);

export const agentPermissionGrants = pgTable("agent_permission_grants", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  agentIdentityId: text("agent_identity_id").notNull().references(() => agentIdentities.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull().default("*"),
  effect: text("effect").notNull().default("allow"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  conditions: jsonb("conditions").notNull().default(sql`'{}'::jsonb`),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_agent_permission_grants_org").on(table.organizationId),
  index("idx_agent_permission_grants_identity").on(table.agentIdentityId),
  index("idx_agent_permission_grants_tool_action").on(table.tool, table.action),
]);

export const agentCredentialLeases = pgTable("agent_credential_leases", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  agentIdentityId: text("agent_identity_id").notNull().references(() => agentIdentities.id, { onDelete: "cascade" }),
  credentialId: integer("credential_id").notNull(),
  tool: text("tool").notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull().default("*"),
  status: text("status").notNull().default("active"),
  leaseReason: text("lease_reason"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  index("idx_agent_credential_leases_org").on(table.organizationId),
  index("idx_agent_credential_leases_identity").on(table.agentIdentityId),
  index("idx_agent_credential_leases_status").on(table.status),
  index("idx_agent_credential_leases_expires").on(table.expiresAt),
]);

export const agentGovernanceAuditEvents = pgTable("agent_governance_audit_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  agentIdentityId: text("agent_identity_id").references(() => agentIdentities.id, { onDelete: "set null" }),
  agentId: text("agent_id").notNull(),
  runId: text("run_id"),
  initiatedBy: text("initiated_by"),
  tool: text("tool").notNull(),
  action: text("action").notNull(),
  resource: text("resource").notNull().default("*"),
  decision: text("decision").notNull(),
  riskLevel: text("risk_level").notNull().default("low"),
  policyCodes: text("policy_codes").array().notNull().default(sql`ARRAY[]::text[]`),
  inputHash: text("input_hash"),
  outputHash: text("output_hash"),
  status: text("status").notNull().default("recorded"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_agent_gov_audit_org").on(table.organizationId),
  index("idx_agent_gov_audit_agent").on(table.agentId),
  index("idx_agent_gov_audit_decision").on(table.decision),
  index("idx_agent_gov_audit_created").on(table.createdAt),
]);

export type AgentIdentity = typeof agentIdentities.$inferSelect;
export type NewAgentIdentity = typeof agentIdentities.$inferInsert;
export type AgentPolicyBundle = typeof agentPolicyBundles.$inferSelect;
export type NewAgentPolicyBundle = typeof agentPolicyBundles.$inferInsert;
export type AgentPermissionGrant = typeof agentPermissionGrants.$inferSelect;
export type NewAgentPermissionGrant = typeof agentPermissionGrants.$inferInsert;
export type AgentCredentialLease = typeof agentCredentialLeases.$inferSelect;
export type NewAgentCredentialLease = typeof agentCredentialLeases.$inferInsert;
export type AgentGovernanceAuditEvent = typeof agentGovernanceAuditEvents.$inferSelect;
export type NewAgentGovernanceAuditEvent = typeof agentGovernanceAuditEvents.$inferInsert;
