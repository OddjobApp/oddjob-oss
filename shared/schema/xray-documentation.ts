import { pgTable, text, serial, timestamp, boolean, jsonb, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';

export const xrayNodeDocumentation = pgTable("xray_node_documentation", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id),
  nodeId: text("node_id").notNull(), // e.g. "npm_module::learning", "api_endpoint::POST_/api/prompt-evolution"
  nodeType: text("node_type").notNull(), // e.g. "screen", "api_endpoint", "job_definition", "pipeline", "mission", etc.
  summary: text("summary"),
  content: text("content").notNull().default(""), // Markdown content
  status: text("status").notNull().default("draft"), // 'published' | 'draft' | 'ai_generated'
  contentFingerprint: text("content_fingerprint"),
  documentationStatus: text("documentation_status").notNull().default("up-to-date"), // 'up-to-date' | 'outdated' | 'missing'
  tags: jsonb("tags").$type<string[]>().default([]),
  authorId: integer("author_id"),
  isAiGenerated: boolean("is_ai_generated").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  knowledgeTopicId: integer("knowledge_topic_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    nodeIdIdx: index("xray_node_doc_node_id_idx").on(table.nodeId),
    orgNodeIdx: index("xray_node_doc_org_node_idx").on(table.organizationId, table.nodeId),
  };
});

export const insertXrayNodeDocSchema = createInsertSchema(xrayNodeDocumentation);
export const selectXrayNodeDocSchema = createSelectSchema(xrayNodeDocumentation);
export type XrayNodeDocumentation = typeof xrayNodeDocumentation.$inferSelect;
export type NewXrayNodeDocumentation = typeof xrayNodeDocumentation.$inferInsert;

export const xrayNodeDocChanges = pgTable("xray_node_doc_changes", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id),
  nodeId: text("node_id").notNull(),
  nodeType: text("node_type").notNull(),
  kind: text("kind").notNull().default("change"), // 'addition' | 'change' | 'deletion'
  previousFingerprint: text("previous_fingerprint"),
  newFingerprint: text("new_fingerprint").notNull(),
  explanation: text("explanation"),
  addedLines: integer("added_lines").default(0),
  removedLines: integer("removed_lines").default(0),
  diff: text("diff").default(""),
  authorId: integer("author_id"),
  isAiGenerated: boolean("is_ai_generated").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    nodeIdIdx: index("xray_node_doc_changes_node_id_idx").on(table.nodeId),
    orgNodeIdx: index("xray_node_doc_changes_org_node_idx").on(table.organizationId, table.nodeId),
  };
});

export const insertXrayNodeDocChangeSchema = createInsertSchema(xrayNodeDocChanges);
export const selectXrayNodeDocChangeSchema = createSelectSchema(xrayNodeDocChanges);
export type XrayNodeDocChange = typeof xrayNodeDocChanges.$inferSelect;
export type NewXrayNodeDocChange = typeof xrayNodeDocChanges.$inferInsert;

