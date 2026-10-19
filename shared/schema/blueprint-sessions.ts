import { pgTable, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";

// ============================================================================
// BLUEPRINT SESSIONS — durable state for a multi-step assembly run
//
// The server owns stage state. It previously lived in an in-process Map on
// BlueprintStateService, which meant a restart lost every in-flight run and the
// worker fleet could not see any of them. It also had no organization at all, so
// possession of a session id was the only thing standing between a caller and
// another tenant's run.
//
// `blueprint` is stored as a snapshot rather than a reference: a run must not
// change shape underneath the person walking through it because someone edited
// the source blueprint mid-session.
// ============================================================================

export const blueprintSessions = pgTable("blueprint_sessions", {
    id: text("id").primaryKey(),
    orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),

    blueprintId: text("blueprint_id").notNull(),
    blueprint: jsonb("blueprint").notNull(),

    verifiedStageIds: jsonb("verified_stage_ids").notNull().default([]),
    activeStageId: text("active_stage_id"),
    stageConfigs: jsonb("stage_configs").notNull().default({}),

    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgIdx: index("blueprint_sessions_org_idx").on(table.orgId),
    orgBlueprintIdx: index("blueprint_sessions_org_blueprint_idx").on(table.orgId, table.blueprintId),
}));

export type BlueprintSessionRow = typeof blueprintSessions.$inferSelect;
export type InsertBlueprintSession = typeof blueprintSessions.$inferInsert;
