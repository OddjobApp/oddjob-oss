
import { pgTable, text, serial, timestamp, doublePrecision, index, integer } from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";
import { createInsertSchema, createSelectSchema } from "drizzle-zod"; // Assuming zods are used elsewhere
import { relations } from "drizzle-orm";

// 1. Ephemeral State Log (Matches ephemeral_schema.sql)
export const contactIntentStates = pgTable("contact_intent_states", {
    id: serial("id").primaryKey(),
    /** Whose visitor this is. A row without one is visible to no one (migration 0157). */
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    userFingerprint: text("user_fingerprint").notNull(),
    stateVector: text("state_vector").notNull(), // S, C, O, R, E
    confidence: doublePrecision("confidence").notNull(),
    routePath: text("route_path"),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => {
    return {
        userIdx: index("idx_intent_user").on(table.userFingerprint),
        orgUserIdx: index("idx_intent_org_user").on(table.organizationId, table.userFingerprint),
        timeIdx: index("idx_intent_time").on(table.createdAt),
    };
});

// 2. Engagement Log
export const engagementLogs = pgTable("engagement_logs", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    userFingerprint: text("user_fingerprint").notNull(),
    strategyName: text("strategy_name"),
    promptText: text("prompt_text"),
    userAction: text("user_action"), // 'dismissed', 'clicked', 'ignored'
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => {
    return {
        userLogIdx: index("idx_eng_user").on(table.userFingerprint),
        orgUserLogIdx: index("idx_eng_org_user").on(table.organizationId, table.userFingerprint),
        timeLogIdx: index("idx_eng_time").on(table.createdAt),
    };
});

// Exports type inference if needed
export type ContactIntentState = typeof contactIntentStates.$inferSelect;
export type InsertContactIntentState = typeof contactIntentStates.$inferInsert;

export type EngagementLog = typeof engagementLogs.$inferSelect;
export type InsertEngagementLog = typeof engagementLogs.$inferInsert;



