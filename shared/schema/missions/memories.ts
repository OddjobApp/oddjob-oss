import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { missions } from './core.js';
import { jobs } from '../jobs/table.js';

// ============================================================================
// MISSION AGENT MEMORIES TABLE
// ============================================================================

export const missionAgentMemories = pgTable("mission_agent_memories", {
  id: serial("id").primaryKey(),
  missionId: integer("mission_id")
    .references(() => missions.id, { onDelete: "cascade" })
    .notNull(),
  agentId: integer("agent_id").references(() => jobs.id),
  runId: text("run_id"),
  
  type: text("type").notNull().default("observation"),
  content: text("content").notNull(),
  importance: integer("importance").default(5),
  
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMissionAgentMemorySchema = createInsertSchema(missionAgentMemories);
export const selectMissionAgentMemorySchema = createSelectSchema(missionAgentMemories);

export type MissionAgentMemory = typeof missionAgentMemories.$inferSelect;
export type InsertMissionAgentMemory = typeof missionAgentMemories.$inferInsert;



