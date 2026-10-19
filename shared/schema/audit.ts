
import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    varchar,
    serial,
    timestamp,
    integer,
    jsonb,
    index,
} from "drizzle-orm/pg-core";
import { orgs } from './auth.js';
import { missionRuns } from './missions/runs.js';

export const auditLogs = pgTable("audit_logs", {
    id: serial("id").primaryKey(),

    // Who
    userId: varchar("user_id", { length: 255 }).notNull(), // User email or ID
    organizationId: integer("organization_id").references(() => orgs.id),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),

    // What
    action: varchar("action", { length: 50 }).notNull(), // CREATE, UPDATE, DELETE, LOGIN, LOGOUT
    entityType: varchar("entity_type", { length: 50 }).notNull(), // pipeline, job, credential, etc.
    entityId: varchar("entity_id", { length: 255 }), // ID of the entity (can be int or string)

    // Details
    changes: jsonb("changes").default(sql`'{}'::jsonb`), // Diff or Snapshot of changes
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`), // Extra context (e.g. specialized params)

    // When
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    orgIdx: index("idx_audit_org").on(table.organizationId),
    entityIdx: index("idx_audit_entity").on(table.entityType, table.entityId),
    userIdx: index("idx_audit_user").on(table.userId),
    timeIdx: index("idx_audit_time").on(table.createdAt),
}));

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

// ============================================================================
// REASONING AUDITS TABLE (Security Hardening)
// ============================================================================

export const reasoningAudits = pgTable("reasoning_audits", {
    id: serial("id").primaryKey(),
    missionRunId: integer("mission_run_id").references(() => missionRuns.id, { onDelete: 'cascade' }),
    traceId: varchar("trace_id", { length: 32 }).notNull(),
    
    // The reasoning snapshot being audited
    reasoningProtocol: varchar("reasoning_protocol", { length: 20 }), // 'hermes_xml', 'json_manifest'
    rawReasoning: text("raw_reasoning").notNull(),
    
    // Audit Metadata
    status: varchar("status", { length: 20 }).default('pending'), // 'pending', 'flagged', 'safe'
    auditorId: varchar("auditor_id", { length: 255 }), // 'system', 'user:123'
    auditNotes: text("audit_notes"),
    
    // Policy Compliance
    violatedPolicies: text("violated_policies").array(), // List of policy identifiers
    severity: integer("severity").default(0), // 0-10
    
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    missionRunIdx: index("idx_reasoning_mission_run").on(table.missionRunId),
    traceIdx: index("idx_reasoning_trace").on(table.traceId),
    statusIdx: index("idx_reasoning_status").on(table.status),
}));

export type ReasoningAudit = typeof reasoningAudits.$inferSelect;
export type InsertReasoningAudit = typeof reasoningAudits.$inferInsert;



