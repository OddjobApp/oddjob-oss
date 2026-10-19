import { pgTable, serial, text, integer, timestamp, jsonb, doublePrecision, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs, users } from "../auth.js";

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface UserInterestNode {
    id?: number;
    topic: string;
    category: string; // 'technology' | 'domain' | 'architecture' | 'methodology' | 'general'
    weight: number;   // 0.0 - 100.0
    decayScore: number; // calculated post 14-day exponential decay
    evidence: string[];
    lastReinforcedAt: string; // ISO String
}

export interface UserProjectActivity {
    id?: number;
    projectId?: number;
    actionType: string; // 'view' | 'execute_job' | 'create_blueprint' | 'hil_approval' | 'chat_discussion'
    topic: string;
    details: string;
    timestamp: string; // ISO String
}

export interface SyntheticPersonaProfile {
    id?: number;
    archetype: string; // e.g. "Systems Architect & Strategic Analyst"
    summary: string;
    communicationDirectives: string[]; // e.g. ["Provide concise, structured verification steps", "Use mathematical/technical precision"]
    oceanSummary: {
        openness: number;
        conscientiousness: number;
        extraversion: number;
        agreeableness: number;
        neuroticism: number;
        confidence: number;
        guidance: string;
    };
    activeFocusVector: string[]; // Top 3 recent topics
    riskTolerance: "conservative" | "balanced" | "aggressive";
    workingStyle: "exploratory" | "goal_directed" | "hybrid";
    lastSynthesizedAt: string; // ISO String
}

// ─── Drizzle Tables ──────────────────────────────────────────────────────────

/**
 * User Interests — Tracks identified topics, weight, and recency decay.
 */
export const userInterests = pgTable("user_interests", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    topic: text("topic").notNull(),
    category: text("category").default("general").notNull(),
    weight: doublePrecision("weight").default(50.0).notNull(),
    decayScore: doublePrecision("decay_score").default(50.0).notNull(),
    evidence: jsonb("evidence").$type<string[]>().default([]).notNull(),
    lastReinforcedAt: timestamp("last_reinforced_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    userTopicIdx: uniqueIndex("idx_user_interests_org_user_topic").on(table.organizationId, table.userId, table.topic),
    userOrgIdx: index("idx_user_interests_user_org").on(table.organizationId, table.userId),
}));

/**
 * User Project Activities — History of user interaction with project resources.
 */
export const userProjectActivities = pgTable("user_project_activities", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    projectId: integer("project_id"),
    actionType: text("action_type").notNull(),
    topic: text("topic").notNull(),
    details: text("details"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    userOrgIdx: index("idx_user_proj_act_user_org").on(table.organizationId, table.userId),
}));

/**
 * Synthetic Personas — Synthesized profile generated asynchronously or on-demand.
 */
export const syntheticPersonas = pgTable("synthetic_personas", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    archetype: text("archetype").notNull(),
    summary: text("summary").notNull(),
    communicationDirectives: jsonb("communication_directives").$type<string[]>().default([]).notNull(),
    oceanSummary: jsonb("ocean_summary").$type<SyntheticPersonaProfile["oceanSummary"]>().notNull(),
    activeFocusVector: jsonb("active_focus_vector").$type<string[]>().default([]).notNull(),
    riskTolerance: text("risk_tolerance").default("balanced").notNull(),
    workingStyle: text("working_style").default("hybrid").notNull(),
    version: integer("version").default(1).notNull(),
    lastSynthesizedAt: timestamp("last_synthesized_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    userOrgIdx: uniqueIndex("idx_synthetic_personas_org_user").on(table.organizationId, table.userId),
}));

// Zod Schemas
export const insertUserInterestSchema = createInsertSchema(userInterests);
export const selectUserInterestSchema = createSelectSchema(userInterests);
export const insertUserProjectActivitySchema = createInsertSchema(userProjectActivities);
export const selectUserProjectActivitySchema = createSelectSchema(userProjectActivities);
export const insertSyntheticPersonaSchema = createInsertSchema(syntheticPersonas);
export const selectSyntheticPersonaSchema = createSelectSchema(syntheticPersonas);

export type UserInterest = typeof userInterests.$inferSelect;
export type InsertUserInterest = typeof userInterests.$inferInsert;
export type UserProjectActivityRecord = typeof userProjectActivities.$inferSelect;
export type SyntheticPersonaRecord = typeof syntheticPersonas.$inferSelect;
