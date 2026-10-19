/**
 * Entity Versioning Schema
 * 
 * Tracks version history for jobs and pipelines.
 * Enables rollback to previous configurations.
 */

import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    integer,
    jsonb,
    timestamp,
    varchar,
    primaryKey,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { users, orgs } from './auth.js';

// ============================================================================
// ENTITY VERSIONS TABLE
// ============================================================================

export const entityVersionTypes = ["job", "pipeline", "dataset", "credential"] as const;
export type EntityVersionType = (typeof entityVersionTypes)[number];

export const entityVersions = pgTable("entity_versions", {
    id: serial("id").primaryKey(),

    // Entity reference
    entityType: text("entity_type").notNull(), // 'job' | 'pipeline' | etc
    entityId: integer("entity_id").notNull(),

    // Version info
    version: integer("version").notNull(),

    // Full entity snapshot (JSON)
    snapshot: jsonb("snapshot").notNull(),

    // Change metadata
    changeSummary: text("change_summary"),      // Optional user-provided description
    changedFields: jsonb("changed_fields"),     // Array of field names that changed

    // Audit
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    // Indexes for efficient queries
    entityLookup: index("idx_entity_versions_lookup").on(table.entityType, table.entityId),
    entityVersion: index("idx_entity_versions_version").on(table.entityType, table.entityId, table.version),
    orgLookup: index("idx_entity_versions_org").on(table.organizationId),
}));

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

export const insertEntityVersionSchema = createInsertSchema(entityVersions, {
    entityType: z.enum(entityVersionTypes),
    entityId: z.number().int().positive(),
    version: z.number().int().positive(),
    snapshot: z.record(z.any()),
    changeSummary: z.string().max(500).optional().nullable(),
    changedFields: z.array(z.string()).optional().nullable(),
    userId: z.string().optional().nullable(),
    organizationId: z.number().int().positive().optional().nullable(),
});

export const selectEntityVersionSchema = createSelectSchema(entityVersions);

export type InsertEntityVersion = z.infer<typeof insertEntityVersionSchema>;
export type EntityVersion = typeof entityVersions.$inferSelect;



