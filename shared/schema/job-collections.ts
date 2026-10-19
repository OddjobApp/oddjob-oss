import {
    pgTable,
    text,
    serial,
    integer,
    timestamp,
    primaryKey,
    jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';
import { jobs } from './jobs/table.js';

// ============================================================================
// JOB COLLECTIONS
// ============================================================================

export const jobCollections = pgTable("job_collections", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    organizationId: integer("organization_id").references(() => orgs.id),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    missionId: integer("mission_id"), // Optional link back to mission
    cycleId: integer("cycle_id"), // Optional link back to operational cycle
    // Tags for organization
    tags: jsonb("tags"), // string[] - color-coded labels
    // Template system
    templateId: text("template_id"), // e.g., "data-pipeline", "customer-support", null for custom
    templateData: jsonb("template_data"), // Template-specific configuration
    // Smart collections (auto-populating)
    isSmart: integer("is_smart").default(0), // 0 = manual, 1 = smart collection
    smartRules: jsonb("smart_rules"), // { field: string, operator: string, value: any }[]
    // Governance
    governorSettings: jsonb("governor_settings"), // { enabled: boolean, mode: 'ADVISORY' | 'AUTONOMOUS' }
    securityReport: jsonb("security_report"),
});

export const jobCollectionItems = pgTable("job_collection_items", {
    collectionId: integer("collection_id").references(() => jobCollections.id, { onDelete: 'cascade' }).notNull(),
    jobId: integer("job_id").references(() => jobs.id, { onDelete: 'cascade' }).notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.collectionId, t.jobId] }),
}));

// ============================================================================
// MISSION-COLLECTION EXECUTION HISTORY
// Tracks when collections are executed as part of mission runs
// ============================================================================

export const missionCollectionExecutions = pgTable("mission_collection_executions", {
    id: serial("id").primaryKey(),
    missionId: integer("mission_id").notNull(),
    missionRunId: integer("mission_run_id").notNull(),
    collectionId: integer("collection_id").references(() => jobCollections.id, { onDelete: 'cascade' }).notNull(),
    // Execution details
    triggeredBy: text("triggered_by").notNull(), // 'manual', 'auto', 'scheduled', 'pipeline_step'
    executionType: text("execution_type").notNull().default("test"), // 'test', 'run', 'sync'
    status: text("status").notNull().default("pending"), // 'pending', 'running', 'success', 'partial', 'failed'
    results: jsonb("results"), // Summary of execution results
    // Timing
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    durationMs: integer("duration_ms"),
    // Organization context
    organizationId: integer("organization_id").references(() => orgs.id),
});

export const insertMissionCollectionExecutionSchema = createInsertSchema(missionCollectionExecutions).omit({
    id: true,
    startedAt: true,
    completedAt: true,
});

export type MissionCollectionExecution = typeof missionCollectionExecutions.$inferSelect;
export type InsertMissionCollectionExecution = z.infer<typeof insertMissionCollectionExecutionSchema>;

export const insertJobCollectionSchema = createInsertSchema(jobCollections, {
    name: z.string().min(1, "Name is required"),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    createdBy: true,
    organizationId: true,
});

export type JobCollection = typeof jobCollections.$inferSelect;
export type InsertJobCollection = z.infer<typeof insertJobCollectionSchema>;



