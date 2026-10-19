import { pgTable, serial, integer, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from "./auth.js";
import { RESOURCE_TYPES, RESOURCE_RELATION_TYPES } from "../resource-catalog.js";

// ============================================================================
// RESOURCE CATALOG EDGES (Persisted Ontology Relations)
// ============================================================================
// Curated cross-resource relations, distinct from the relations the catalog
// derives at read time from existing foreign keys/columns. Always org-scoped:
// there is no concept of a global edge in this table.

export const resourceEdges = pgTable("resource_edges", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    relationType: text("relation_type").notNull(),
    label: text("label"),
    metadata: jsonb("metadata").default({}),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    sourceIdx: index("resource_edges_source_idx").on(table.sourceType, table.sourceId),
    targetIdx: index("resource_edges_target_idx").on(table.targetType, table.targetId),
    orgIdx: index("resource_edges_org_idx").on(table.organizationId),
    orgRelationUnique: uniqueIndex("resource_edges_org_relation_unique").on(
        table.organizationId,
        table.sourceType,
        table.sourceId,
        table.relationType,
        table.targetType,
        table.targetId,
    ),
}));

export const insertResourceEdgeSchema = createInsertSchema(resourceEdges, {
    sourceType: z.enum(RESOURCE_TYPES),
    targetType: z.enum(RESOURCE_TYPES),
    relationType: z.enum(RESOURCE_RELATION_TYPES),
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    label: z.string().max(200).optional().nullable(),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export type ResourceEdge = typeof resourceEdges.$inferSelect;
export type InsertResourceEdge = z.infer<typeof insertResourceEdgeSchema>;
