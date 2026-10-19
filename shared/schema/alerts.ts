import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    integer,
    timestamp,
    boolean,
    jsonb,
    varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs, alertSeverities } from './auth.js';
import { scheduledJobs } from './schedules.js';

// ============================================================================
// ALERTS TABLE
// ============================================================================

export const alertCategories = [
    "job_failure",
    "job_success",
    "job_delay",
    "pipeline_failure",
    "system",
    "security",
] as const;
export type AlertCategory = (typeof alertCategories)[number];

export const alerts = pgTable("alerts", {
    id: serial("alert_id").primaryKey(),
    severity: varchar("severity", { length: 10 }).notNull(),
    category: varchar("category", { length: 50 }).notNull(),
    jobRunId: integer("job_run_id"),
    scheduledJobId: integer("scheduled_job_id").references(
        () => scheduledJobs.id,
        { onDelete: "set null" },
    ),
    pipelineRunId: integer("pipeline_run_id"),
    message: text("message").notNull(),
    details: jsonb("details")
        .default(sql`'{}'::jsonb`)
        .notNull(),
    organizationId: integer("organization_id").references(() => orgs.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    acknowledgedAt: timestamp("acknowledged_at"),
    resolvedAt: timestamp("resolved_at"),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    ownerUserId: text("owner_user_id"),
    ownerOrgId: integer("owner_org_id"),
    suppressed: boolean("suppressed").default(false).notNull(),
    suppressedReason: text("suppressed_reason"),
    suppressedUntil: timestamp("suppressed_until"),
    updatedAt: timestamp("updated_at"),
});

export const insertAlertSchema = createInsertSchema(alerts, {
    severity: z.enum(alertSeverities),
    category: z.string().min(1),
    message: z.string().min(1, "Alert message is required"),
    details: z.any().optional(),
}).omit({
    id: true,
    createdAt: true,
    firstSeenAt: true,
});

export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alerts.$inferSelect;



