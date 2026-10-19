import { pgTable, serial, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs } from "../auth.js";
import { missions } from "./core.js";

/**
 * Per-mission binding to one of the org's apps. Drives the mission-row
 * "ðŸ›  Apps â–¾" dropdown in Cycle Manager: each binding becomes a row with
 * three actions (Open modal / Page / Builder).
 *
 * Role semantics:
 *   - 'primary'   â€” the canonical workbench for this mission (PM Workbench
 *                   for a PM mission, QA Workbench for a QA mission)
 *   - 'reference' â€” useful context but not the main tool (e.g. an analytics
 *                   dashboard surfaced on multiple missions)
 *   - 'oversight' â€” managerial / approval-flow apps (Stakeholder Workbench
 *                   on dev missions)
 *
 * Source:
 *   - 'blueprint' â€” created by orgForgeService.installCycleApp from YAML;
 *                   cannot be deleted via UI, only re-bound by re-install
 *   - 'manual'    â€” added through the Cycle Manager UI
 */
export const missionAppBindings = pgTable("mission_app_bindings", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "cascade" }).notNull(),
    // FK to apps is declared in the migration SQL; left soft here to avoid
    // a circular import (apps schema imports from missions in some paths).
    appId: integer("app_id").notNull(),
    role: text("role").default("primary").notNull(),
    label: text("label"),
    openModeDefault: text("open_mode_default").default("modal").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    source: text("source").default("blueprint").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
    index("mab_mission_idx").on(t.missionId, t.sortOrder),
    index("mab_org_idx").on(t.organizationId),
    uniqueIndex("mab_unique").on(t.missionId, t.appId, t.role),
]);

export const insertMissionAppBindingSchema = createInsertSchema(missionAppBindings);
export const selectMissionAppBindingSchema = createSelectSchema(missionAppBindings);

export type MissionAppBinding = typeof missionAppBindings.$inferSelect;
export type InsertMissionAppBinding = typeof missionAppBindings.$inferInsert;

export const MISSION_APP_BINDING_ROLES = ["primary", "reference", "oversight"] as const;
export type MissionAppBindingRole = (typeof MISSION_APP_BINDING_ROLES)[number];

export const MISSION_APP_OPEN_MODES = ["modal", "page"] as const;
export type MissionAppOpenMode = (typeof MISSION_APP_OPEN_MODES)[number];

export const MISSION_APP_BINDING_SOURCES = ["blueprint", "manual"] as const;
export type MissionAppBindingSource = (typeof MISSION_APP_BINDING_SOURCES)[number];


