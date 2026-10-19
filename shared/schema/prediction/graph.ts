import {
    pgTable,
    uuid,
    text,
    doublePrecision,
    integer,
    timestamp,
    jsonb,
    index,
} from "drizzle-orm/pg-core";

// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN - GRAPH POD - DRIZZLE SCHEMA
// Spec Â§34: graph_nodes, graph_edges, graph_snapshots, graph_diffs
// ============================================================================

export const graphNodes = pgTable("graph_nodes", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id"),
    type: text("type").notNull(),
    label: text("label"),
    refId: uuid("ref_id").notNull(),
    properties: jsonb("properties").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    contextTypeIdx: index("idx_graph_nodes_context_type").on(t.contextId, t.type),
    refIdx: index("idx_graph_nodes_ref").on(t.refId),
    typeIdx: index("idx_graph_nodes_type").on(t.type),
}));

export const graphEdges = pgTable("graph_edges", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id"),
    sourceNodeId: uuid("source_node_id").notNull().references(() => graphNodes.id, { onDelete: "cascade" }),
    targetNodeId: uuid("target_node_id").notNull().references(() => graphNodes.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    strength: doublePrecision("strength").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    weight: doublePrecision("weight").notNull(),
    direction: text("direction").notNull().default("directed"),
    evidenceIds: uuid("evidence_ids").array().default([]),
    provenance: jsonb("provenance").notNull().default({}),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    properties: jsonb("properties").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    contextTypeIdx: index("idx_graph_edges_context_type").on(t.contextId, t.type),
    sourceIdx: index("idx_graph_edges_source").on(t.sourceNodeId),
    targetIdx: index("idx_graph_edges_target").on(t.targetNodeId),
    weightIdx: index("idx_graph_edges_weight").on(t.weight),
}));

export const graphSnapshots = pgTable("graph_snapshots", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id"),
    snapshotType: text("snapshot_type").notNull(),
    nodeCount: integer("node_count").notNull(),
    edgeCount: integer("edge_count").notNull(),
    summary: jsonb("summary").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    contextTimeIdx: index("idx_graph_snapshots_context_time").on(t.contextId, t.createdAt),
    typeIdx: index("idx_graph_snapshots_type").on(t.snapshotType),
}));

export const graphDiffs = pgTable("graph_diffs", {
    id: uuid("id").primaryKey().defaultRandom(),
    contextId: uuid("context_id"),
    previousSnapshotId: uuid("previous_snapshot_id"),
    currentSnapshotId: uuid("current_snapshot_id"),
    changes: jsonb("changes").notNull().default([]),
    summary: jsonb("summary").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    contextTimeIdx: index("idx_graph_diffs_context_time").on(t.contextId, t.createdAt),
}));


