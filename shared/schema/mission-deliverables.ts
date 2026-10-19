import { pgTable, text, serial, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { missions } from './missions/core.js';
import { missionRuns } from './missions/runs.js';

// ============================================================================
// MISSION DELIVERABLES (High-Value Outputs)
// ============================================================================

export const missionDeliverables = pgTable("mission_deliverables", {
    id: serial("id").primaryKey(),
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "cascade" }),
    missionRunId: integer("mission_run_id").references(() => missionRuns.id, { onDelete: "cascade" }),
    parentId: integer("parent_id").references((): any => missionDeliverables.id, { onDelete: "set null" }),
    name: text("name").notNull(), // e.g., "Technical Specification", "Deep Research Report"
    content: text("content").notNull(), // The actual deliverable content (Markdown)
    type: text("type").notNull().default("report"), // 'specification', 'research', 'report', 'code', 'backlog', 'test_cases', 'capacity_plan'
    isCritiqued: boolean("is_critiqued").default(false).notNull(),
    critiqueContent: text("critique_content"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMissionDeliverableSchema = createInsertSchema(missionDeliverables, {
    name: z.string().min(1, "Name is required").max(200),
    content: z.string().min(1, "Content is required"),
    type: z.string().default("report"),
    metadata: z.record(z.any()).optional(),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const updateMissionDeliverableSchema = insertMissionDeliverableSchema.partial();

export type MissionDeliverable = typeof missionDeliverables.$inferSelect;
export type InsertMissionDeliverable = z.infer<typeof insertMissionDeliverableSchema>;



