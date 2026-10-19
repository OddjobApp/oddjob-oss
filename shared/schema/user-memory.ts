import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";
import { orgs } from "./auth.js";

/**
 * Per-user assistant memory — durable preferences/facts the assistant learns about
 * a user and recalls across sessions (Hermes MEMORY.md/USER.md analogue). Distinct
 * from org-level institutional memory and mission-scoped blackboard/shared memory.
 * Retrieved + injected into the system prompt for the conversational assistant.
 */
export const userMemory = pgTable("user_memory", {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    organizationId: integer("organization_id").references(() => orgs.id),
    content: text("content").notNull(),
    kind: text("kind").notNull().default("fact"), // 'preference' | 'fact' | 'context'
    source: text("source").notNull().default("assistant"), // 'assistant' | 'user' | 'auto'
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    userIdx: index("user_memory_user_idx").on(t.userId),
    userOrgIdx: index("user_memory_user_org_idx").on(t.userId, t.organizationId),
}));

export const insertUserMemorySchema = createInsertSchema(userMemory).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export type UserMemory = typeof userMemory.$inferSelect;
export type InsertUserMemory = z.infer<typeof insertUserMemorySchema>;
