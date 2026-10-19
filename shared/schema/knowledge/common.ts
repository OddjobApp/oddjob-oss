import {
    pgTable,
    text,
    serial,
    timestamp,
    integer,
    jsonb,
    boolean,
    index,
} from "drizzle-orm/pg-core";
import { z } from "zod";

import { orgs } from '../auth.js';
import { jobs } from '../jobs/table.js';

// Pagination schemas
export const paginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(10000).default(50),
    offset: z.coerce.number().int().min(0).optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

// Snapshots Table (Baseline State Management)
export const snapshotEntityTypes = ["job_output", "knowledge_node", "pipeline_step"] as const;
export type SnapshotEntityType = (typeof snapshotEntityTypes)[number];

export const snapshots = pgTable("snapshots", {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(), // 'job_output', 'knowledge_node', 'pipeline_step'
    entityId: integer("entity_id").notNull(),  // ID of the job, node, or step
    jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }), // For job_output type
    data: jsonb("data").notNull(),             // The frozen data snapshot
    hash: text("hash").notNull(),              // SHA256 checksum for quick comparison
    label: text("label"),                      // User-defined tag: "Q1 Approved Baseline", "Pre-Migration"
    description: text("description"),          // Notes about this snapshot
    isPrimary: boolean("is_primary").default(false), // Is this the default comparison target?
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    entityIdx: index("snapshot_entity_idx").on(table.entityType, table.entityId),
    jobIdx: index("snapshot_job_idx").on(table.jobId),
    primaryIdx: index("snapshot_primary_idx").on(table.entityType, table.entityId, table.isPrimary),
}));

export type Snapshot = typeof snapshots.$inferSelect;
export type InsertSnapshot = typeof snapshots.$inferInsert;

export const insertSnapshotSchema = z.object({
    entityType: z.enum(snapshotEntityTypes),
    entityId: z.number().int().positive(),
    jobId: z.number().int().positive().optional().nullable(),
    data: z.record(z.any()),
    hash: z.string().min(1),
    label: z.string().max(200).optional().nullable(),
    description: z.string().max(1000).optional().nullable(),
    isPrimary: z.boolean().optional().default(false),
    organizationId: z.number().int().positive().optional().nullable(),
    createdBy: z.string().min(1),
});



