/**
 * Human-in-the-Loop Enhancements Schema
 * Escalation, delegation, and auto-approval rules
 */

import { pgTable, serial, integer, timestamp, jsonb, text, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";

// HIL Configuration for jobs
export const hilJobConfig = pgTable("hil_job_config", {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull().unique(),
    organizationId: integer("organization_id"),
    
    // Escalation rules
    escalationEnabled: integer("escalation_enabled").notNull().default(1),
    escalationTimeoutMinutes: integer("escalation_timeout_minutes").notNull().default(60),
    escalationRole: text("escalation_role").default("admin"), // Role to escalate to
    escalationUserIds: jsonb("escalation_user_ids"), // Specific users
    
    // Delegation
    allowDelegation: integer("allow_delegation").notNull().default(0),
    delegatableToRoles: jsonb("delegatable_to_roles"), // Roles that can be delegated to
    
    // Auto-approval rules
    autoApprovalEnabled: integer("auto_approval_enabled").notNull().default(0),
    autoApprovalRules: jsonb("auto_approval_rules"), // JSON rules for auto-approval
    
    // Similarity-based approval
    similarityThreshold: integer("similarity_threshold").default(90), // 0-100, approve if similar to past approved
    
    // Business hours
    businessHoursOnly: integer("business_hours_only").notNull().default(0),
    businessHoursTimezone: text("business_hours_timezone").default("UTC"),
    businessHoursStart: integer("business_hours_start").default(9), // 24h format
    businessHoursEnd: integer("business_hours_end").default(17),
    
    // Notifications
    notifyOnPending: jsonb("notify_on_pending"), // Notification channels
    notifyOnEscalation: jsonb("notify_on_escalation"),
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    jobIdIdx: index("hil_config_job_id_idx").on(t.jobId),
    orgIdx: index("hil_config_org_idx").on(t.organizationId),
}));

// HIL Approval History for pattern learning
export const hilApprovalPatterns = pgTable("hil_approval_patterns", {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    organizationId: integer("organization_id"),
    
    // Request fingerprint
    requestHash: text("request_hash").notNull(), // Hash of request content for similarity
    requestSummary: text("request_summary"), // Human-readable summary
    requestContext: jsonb("request_context"), // Key fields that define similarity
    
    // Decision tracking
    totalRequests: integer("total_requests").notNull().default(0),
    approvedCount: integer("approved_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    
    // Approval characteristics
    avgApprovalTimeMinutes: integer("avg_approval_time_minutes"),
    commonModifiers: jsonb("common_modifiers"), // Fields often modified
    
    // Auto-approval eligibility
    isReliablePattern: integer("is_reliable_pattern").default(0), // Can be auto-approved
    reliabilityScore: integer("reliability_score").default(0), // 0-100
    
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
    jobIdIdx: index("hil_patterns_job_id_idx").on(t.jobId),
    hashIdx: index("hil_patterns_hash_idx").on(t.requestHash),
    orgIdx: index("hil_patterns_org_idx").on(t.organizationId),
}));

// HIL Escalation Log
export const hilEscalationLog = pgTable("hil_escalation_log", {
    id: serial("id").primaryKey(),
    approvalRequestId: integer("approval_request_id").notNull(),
    jobId: integer("job_id").notNull(),
    
    escalationType: text("escalation_type").notNull(), // timeout, manual, auto
    fromUserId: integer("from_user_id"),
    toUserIds: jsonb("to_user_ids"), // Who it was escalated to
    toRole: text("to_role"), // Or what role
    
    reason: text("reason"),
    escalatedAt: timestamp("escalated_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
    resolution: text("resolution"), // approved, rejected, delegated
    
}, (t) => ({
    approvalIdx: index("hil_escalation_approval_idx").on(t.approvalRequestId),
    jobIdx: index("hil_escalation_job_idx").on(t.jobId),
}));

export const insertHilJobConfigSchema = createInsertSchema(hilJobConfig).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const insertHilApprovalPatternsSchema = createInsertSchema(hilApprovalPatterns).omit({
    id: true,
    lastSeenAt: true,
    createdAt: true,
});

export const insertHilEscalationLogSchema = createInsertSchema(hilEscalationLog).omit({
    id: true,
    escalatedAt: true,
    resolvedAt: true,
});

export type HilJobConfig = typeof hilJobConfig.$inferSelect;
export type InsertHilJobConfig = z.infer<typeof insertHilJobConfigSchema>;
export type HilApprovalPatterns = typeof hilApprovalPatterns.$inferSelect;
export type InsertHilApprovalPatterns = z.infer<typeof insertHilApprovalPatternsSchema>;
export type HilEscalationLog = typeof hilEscalationLog.$inferSelect;
export type InsertHilEscalationLog = z.infer<typeof insertHilEscalationLogSchema>;


