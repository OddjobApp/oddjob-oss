import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    timestamp,
    integer,
    jsonb,
    index,
} from "drizzle-orm/pg-core";
import { z } from "zod";

import { orgs } from '../auth.js';

export const analysisSessions = pgTable("analysis_sessions", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    // Serialized state of the workbench/graph
    state: jsonb("state").notNull().default(sql`'{}'::jsonb`),
    // Context linking
    contextType: text("context_type").default("global"), // 'global', 'run', 'dataset'
    contextId: integer("context_id"), // ID of run or dataset if applicable
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgIdx: index("analysis_session_org_idx").on(table.organizationId),
}));

export type AnalysisSession = typeof analysisSessions.$inferSelect;
export type InsertAnalysisSession = typeof analysisSessions.$inferInsert;

export const createAnalysisSessionSchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    description: z.string().max(500).optional().nullable(),
    state: z.record(z.any()), // Loose validation for state blob
    contextType: z.enum(["global", "run", "dataset"]).optional().default("global"),
    contextId: z.number().int().optional().nullable(),
    organizationId: z.number().int().positive().optional().nullable(),
    createdBy: z.string().optional().nullable(),
});

export const updateAnalysisSessionSchema = createAnalysisSessionSchema.partial().extend({
    name: z.string().min(1).max(100).optional(),
});

export type CreateAnalysisSessionInput = z.infer<typeof createAnalysisSessionSchema>;



