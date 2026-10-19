import {
    pgTable,
    serial,
    integer,
    text,
    jsonb,
    timestamp,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { orgs } from '../auth.js';
import { knowledgeNodes } from './graph.js';

/**
 * Temporal Node Versioning
 * 
 * Records complete historical snapshots of knowledge node states with timestamps,
 * actor identifiers, and causal annotations. Supports point-in-time queries,
 * range queries, and FIFO pruning (max 100 versions per node).
 */
export const knowledgeNodeVersions = pgTable("knowledge_node_versions", {
    id: serial("id").primaryKey(),
    nodeId: integer("node_id").references(() => knowledgeNodes.id, { onDelete: "cascade" }).notNull(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    previousState: jsonb("previous_state").notNull(),
    newState: jsonb("new_state").notNull(),
    changeType: text("change_type").notNull(), // comma-separated field names that changed
    actorId: text("actor_id").notNull(), // user id or "system:<process>"
    causalAnnotation: text("causal_annotation").default("unspecified").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("node_version_node_idx").on(table.nodeId),
    index("node_version_ts_idx").on(table.nodeId, table.timestamp),
    index("node_version_org_idx").on(table.organizationId),
]);

export type KnowledgeNodeVersion = typeof knowledgeNodeVersions.$inferSelect;
export type InsertKnowledgeNodeVersion = typeof knowledgeNodeVersions.$inferInsert;

/**
 * Temporal Edge Versioning
 * 
 * Records edge creation, modification, or deletion with source/target node identifiers,
 * relation type, weight, timestamp, and change type. Supports diff queries
 * (all versions between two timestamps, max 10,000 per response with cursor-based pagination).
 */
export const knowledgeEdgeVersions = pgTable("knowledge_edge_versions", {
    id: serial("id").primaryKey(),
    edgeId: integer("edge_id").notNull(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    sourceId: integer("source_id").notNull(),
    targetId: integer("target_id").notNull(),
    relation: text("relation").notNull(),
    weight: integer("weight"),
    changeType: text("change_type").notNull(), // "created" | "modified" | "deleted"
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("edge_version_edge_idx").on(table.edgeId),
    index("edge_version_ts_idx").on(table.organizationId, table.timestamp),
    index("edge_version_org_idx").on(table.organizationId),
]);

export type KnowledgeEdgeVersion = typeof knowledgeEdgeVersions.$inferSelect;
export type InsertKnowledgeEdgeVersion = typeof knowledgeEdgeVersions.$inferInsert;

/**
 * Represents an edge snapshot at a specific point in time.
 * Used by getEdgesAtTimestamp to return the reconstructed edge set.
 */
export type EdgeSnapshot = {
    edgeId: number;
    sourceId: number;
    targetId: number;
    relation: string;
    weight: number | null;
    changeType: string;
    timestamp: Date;
};

/**
 * Result type for edge diff queries with cursor-based pagination.
 * Returns edge version entries between two timestamps, limited to 10,000 per page.
 */
export type EdgeDiffResult = {
    entries: KnowledgeEdgeVersion[];
    truncated: boolean;
    nextCursor: string | null;
};

// ============================================================================
// ZOD VALIDATION SCHEMAS
// ============================================================================

/**
 * Validation schema for node version record inserts.
 * Ensures actorId is non-empty, causalAnnotation is max 500 chars,
 * and changeType is non-empty.
 */
export const insertNodeVersionSchema = createInsertSchema(knowledgeNodeVersions, {
    actorId: z.string().min(1, "actorId must not be empty"),
    causalAnnotation: z.string().max(500, "causalAnnotation must be 500 characters or fewer").default("unspecified"),
    changeType: z.string().min(1, "changeType must not be empty"),
    previousState: z.record(z.any()),
    newState: z.record(z.any()),
}).omit({
    id: true,
    timestamp: true,
});

export type InsertNodeVersionInput = z.infer<typeof insertNodeVersionSchema>;

/**
 * Edge change type enum: "created" | "modified" | "deleted"
 */
export const edgeChangeTypeEnum = z.enum(["created", "modified", "deleted"]);
export type EdgeChangeType = z.infer<typeof edgeChangeTypeEnum>;

/**
 * Validation schema for edge version record inserts.
 * Validates changeType is one of "created" | "modified" | "deleted".
 */
export const insertEdgeVersionSchema = createInsertSchema(knowledgeEdgeVersions, {
    changeType: edgeChangeTypeEnum,
}).omit({
    id: true,
    timestamp: true,
});

export type InsertEdgeVersionInput = z.infer<typeof insertEdgeVersionSchema>;

/**
 * Validation schema for temporal range query parameters.
 * Takes two ISO date strings (from, to) with from < to constraint.
 * Results capped at 1,000 entries per the requirements.
 */
export const temporalRangeQuerySchema = z.object({
    from: z.string().datetime({ message: "from must be a valid ISO date string" }),
    to: z.string().datetime({ message: "to must be a valid ISO date string" }),
}).refine(
    (data) => new Date(data.from).getTime() < new Date(data.to).getTime(),
    { message: "from must be earlier than to", path: ["from"] }
);

export type TemporalRangeQuery = z.infer<typeof temporalRangeQuerySchema>;

/**
 * Validation schema for edge diff query parameters.
 * Supports cursor-based pagination (max 10,000 entries per response).
 */
export const edgeDiffQuerySchema = z.object({
    orgId: z.number().int().positive("orgId must be a positive integer"),
    from: z.string().datetime({ message: "from must be a valid ISO date string" }),
    to: z.string().datetime({ message: "to must be a valid ISO date string" }),
    cursor: z.string().optional(),
}).refine(
    (data) => new Date(data.from).getTime() < new Date(data.to).getTime(),
    { message: "from must be earlier than to", path: ["from"] }
);

export type EdgeDiffQuery = z.infer<typeof edgeDiffQuerySchema>;
