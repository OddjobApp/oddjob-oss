
import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs, users } from '../auth.js';

// ============================================================================
// AGENT LONG-TERM MEMORIES TABLE (Cross-Mission Persistence)
// ============================================================================

export const agentLongTermMemories = pgTable("agent_long_term_memories", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => orgs.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id),
  
  type: text("type").notNull(), // 'preference', 'fact', 'entity', 'strategy'
  key: text("key"),             // Optional key for quick lookups (e.g. 'preferred_language')
  content: text("content").notNull(),
  importance: integer("importance").default(5), // 1-10

  // Provenance: 'manual' (explicit .remember call), 'dialectic_v1' (derived
  // by the reconciliation worker), 'auto_extracted' (other extractors).
  // Lets consumers weight or filter by trust level.
  source: text("source").default("manual").notNull(),
  // 0-100 confidence in the assertion. Manual writes default to 100;
  // dialectic-derived items reflect the reconciliation pass's confidence.
  confidence: integer("confidence").default(100).notNull(),

  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAgentLongTermMemorySchema = createInsertSchema(agentLongTermMemories);
export const selectAgentLongTermMemorySchema = createSelectSchema(agentLongTermMemories);

export type AgentLongTermMemory = typeof agentLongTermMemories.$inferSelect;
export type InsertAgentLongTermMemory = typeof agentLongTermMemories.$inferInsert;


