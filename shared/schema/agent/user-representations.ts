import { pgTable, serial, text, integer, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs, users } from "../auth.js";

/**
 * Consolidated dialectic-derived model of a user, rebuilt periodically by the
 * reconciliation worker (see user-representation.service.ts).
 *
 * One row per (organizationId, userId). Individual derived facts also flow
 * into agent_long_term_memories (with source='dialectic_v1') so they remain
 * searchable; this table holds the structured, prompt-ready view.
 */
export const userRepresentations = pgTable("user_representations", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),

    // Structured representation produced by the reconciliation passes.
    // Each is an array of {value, confidence (0-100), observedFrom (session/msg refs), observedAt}
    preferences: jsonb("preferences").$type<Array<{ area: string; value: string; confidence: number; observedFrom?: string[]; observedAt?: string }>>().default([]).notNull(),
    goals: jsonb("goals").$type<Array<{ goal: string; confidence: number; observedFrom?: string[]; observedAt?: string }>>().default([]).notNull(),
    patterns: jsonb("patterns").$type<Array<{ pattern: string; frequency: string; observedFrom?: string[]; observedAt?: string }>>().default([]).notNull(),

    // Object describing how the user communicates (verbosity, tone, formality,
    // code/style preferences, length norms, etc.). Free-form keys.
    communicationStyle: jsonb("communication_style").$type<Record<string, any>>().default({}).notNull(),

    // Contradictions surfaced by the self-audit pass but not yet resolved.
    // Cleared when reconciliation pass 2 reconciles them.
    contradictions: jsonb("contradictions").$type<Array<{ topic: string; conflicting: string[]; noted: string }>>().default([]).notNull(),

    // Cadence trigger counters
    turnsSinceReconcile: integer("turns_since_reconcile").default(0).notNull(),
    lastReconciledAt: timestamp("last_reconciled_at"),
    // How many passes the last reconciliation used (1-3). Useful for cost analysis.
    dialecticDepth: integer("dialectic_depth").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    userOrgUnique: uniqueIndex("user_representations_user_org_unique").on(t.organizationId, t.userId),
    candidatesIdx: index("user_representations_candidates_idx").on(t.turnsSinceReconcile, t.lastReconciledAt),
}));

export const insertUserRepresentationSchema = createInsertSchema(userRepresentations);
export const selectUserRepresentationSchema = createSelectSchema(userRepresentations);

export type UserRepresentation = typeof userRepresentations.$inferSelect;
export type InsertUserRepresentation = typeof userRepresentations.$inferInsert;


