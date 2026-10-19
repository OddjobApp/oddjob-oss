
import {
    pgTable,
    serial,
    text,
    timestamp,
    integer,
    jsonb,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { missions } from '../missions/core.js';
import { missionRuns } from '../missions/runs.js';

export const missionSuggestions = pgTable("mission_suggestions", {
    id: serial("id").primaryKey(),
    missionId: integer("mission_id").references(() => missions.id, { onDelete: 'cascade' }).notNull(),
    missionRunId: integer("mission_run_id").references(() => missionRuns.id, { onDelete: 'cascade' }).notNull(),

    // 'error_mitigation', 'tool_choice', 'quality', 'performance'
    type: text("type").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),

    // Actionable metadata for "Apply" logic
    // e.g., { type: 'update_objective', value: '...' } 
    // or { type: 'add_member', entityType: 'job', entityId: 123, role: '...' }
    // or { type: 'update_blackboard', key: '...', value: '...' }
    suggestedAction: jsonb("suggested_action"),

    status: text("status").notNull().default('pending'), // 'pending', 'applied', 'dismissed'

    createdAt: timestamp("created_at").defaultNow().notNull(),
    appliedAt: timestamp("applied_at"),
}, (table) => ({
    missionIdx: index("idx_mission_suggestions_mission").on(table.missionId),
    runIdx: index("idx_mission_suggestions_run").on(table.missionRunId),
}));

export const insertMissionSuggestionSchema = createInsertSchema(missionSuggestions);
export const selectMissionSuggestionSchema = createSelectSchema(missionSuggestions);

export type MissionSuggestion = typeof missionSuggestions.$inferSelect;
export type InsertMissionSuggestion = typeof missionSuggestions.$inferInsert;



