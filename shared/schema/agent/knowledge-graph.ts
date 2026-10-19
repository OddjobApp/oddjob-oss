import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs } from '../auth.js';

// ============================================================================
// AGENT KNOWLEDGE GRAPH ENTRIES (Across-Mission Memory Graph)
// ============================================================================

export const agentKnowledgeGraphEntries = pgTable("agent_knowledge_graph_entries", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => orgs.id, { onDelete: "cascade" })
    .notNull(),
  agentId: text("agent_id").notNull(),       // Agent identifier (e.g. jobId or agent/archetype name)
  repositoryId: text("repository_id").notNull(), // Git repo identifier/URL
  type: text("type").notNull(), // code_pattern, architectural_decision, project_convention, dependency_note, lesson_learned
  content: text("content").notNull(),
  confidence: integer("confidence").default(100).notNull(), // 0-100 score
  accessCount: integer("access_count").default(0).notNull(),
  lastAccessed: timestamp("last_accessed").defaultNow().notNull(),
  metadata: jsonb("metadata").default({}).$type<{
    filePaths?: string[];
    moduleNames?: string[];
    techKeywords?: string[];
    sourceMissionId?: number;
    codeSnippet?: string;
    failureMode?: string;
    rootCause?: string;
    resolution?: string;
    errorCategory?: string; // test_failure, build_error, lint_violation, merge_conflict, timeout, tool_misuse
    [key: string]: any;
  }>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_agent_kg_org_agent_repo").on(table.organizationId, table.agentId, table.repositoryId),
]);

export const insertAgentKnowledgeGraphEntrySchema = createInsertSchema(agentKnowledgeGraphEntries);
export const selectAgentKnowledgeGraphEntrySchema = createSelectSchema(agentKnowledgeGraphEntries);

export type AgentKnowledgeGraphEntry = typeof agentKnowledgeGraphEntries.$inferSelect;
export type InsertAgentKnowledgeGraphEntry = typeof agentKnowledgeGraphEntries.$inferInsert;


