
import { pgTable, serial, text, integer, jsonb, timestamp, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const agentCritiques = pgTable("agent_critiques", {
    id: serial("id").primaryKey(),
    // Link to the specific interaction/run. 
    // Assuming 'agentRuns' or similar exists, but staying loose for now with just an ID until we confirm the FK table.
    interactionId: integer("interaction_id").notNull(),

    criticism: text("criticism").notNull(), // The breakdown of what went wrong
    score: integer("score").notNull(), // 0-5 or 0-10 scale

    // Tags: ["Hallucination", "Off-Topic", "Stale Data", "Security Risk"]
    issues: jsonb("issues").default([]),

    correction: text("correction"), // Suggested better answer
    organizationId: integer("organization_id"), // Link to organization

    createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentCritiqueSchema = createInsertSchema(agentCritiques);
export type AgentCritique = typeof agentCritiques.$inferSelect;
export type InsertAgentCritique = typeof agentCritiques.$inferInsert;



