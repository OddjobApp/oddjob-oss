import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    timestamp,
    integer,
    jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// TICKETS TABLE (CRM)
// ============================================================================

export const tickets = pgTable("tickets", {
    id: serial("id").primaryKey(),
    subject: text("subject").notNull(),
    description: text("description"),
    userEmail: text("user_email").notNull(),
    priority: text("priority").default("normal"), // low, normal, high, urgent
    status: text("status").default("open"), // open, pending, resolved, closed
    // Analysis Fields
    sentimentScore: integer("sentiment_score"), // 0-100
    sentimentLabel: text("sentiment_label"), // positive, neutral, negative
    category: text("category"), // e.g. "Billing", "Technical", "Feature Request"
    confidenceScore: integer("confidence_score"), // 0-100, AI's confidence
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`), // Extra context
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
});

export const insertTicketSchema = createInsertSchema(tickets, {
    userEmail: z.string().email(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    resolvedAt: true,
});

export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof tickets.$inferSelect;



