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

import { orgs } from '../auth.js';

export const queryTemplates = pgTable("query_templates", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").default("custom"),
    queryStructure: jsonb("query_structure").notNull(),
    cypherTemplate: text("cypher_template"),
    parameters: jsonb("parameters").default([]),
    isPublic: boolean("is_public").default(false),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgIdx: index("query_templates_org_idx").on(table.organizationId),
}));

export const savedQueries = pgTable("saved_queries", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    queryStructure: jsonb("query_structure").notNull(),
    cypherQuery: text("cypher_query"),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    createdBy: text("created_by"),
    lastRunAt: timestamp("last_run_at"),
    runCount: integer("run_count").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgIdx: index("saved_queries_org_idx").on(table.organizationId),
}));

export const queryExecutionHistory = pgTable("query_execution_history", {
    id: serial("id").primaryKey(),
    queryId: integer("query_id").references(() => savedQueries.id, { onDelete: "set null" }),
    queryText: text("query_text").notNull(),
    executionTimeMs: integer("execution_time_ms"),
    resultCount: integer("result_count"),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    executedBy: text("executed_by"),
    executedAt: timestamp("executed_at").defaultNow().notNull(),
}, (table) => ({
    queryIdx: index("query_execution_history_query_idx").on(table.queryId),
}));


