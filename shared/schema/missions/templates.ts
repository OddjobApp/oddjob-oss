import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from '../auth.js';

// ============================================================================
// MISSION TEMPLATES TABLE
// ============================================================================

export const missionTemplates = pgTable("mission_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),

  // The configuration to replicate
  config: jsonb("config").notNull(),
  
  // Versioning & Ratings
  version: text("version").default("1.0.0"),
  starRating: integer("star_rating").default(0),
  performanceHistory: jsonb("performance_history").default([]),

  organizationId: integer("organization_id").references(() => orgs.id),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMissionTemplateSchema = createInsertSchema(missionTemplates, {
  name: z.string().min(1),
  config: z.record(z.any()),
}).omit({
  id: true,
  createdAt: true,
});

export type MissionTemplate = typeof missionTemplates.$inferSelect;
export type InsertMissionTemplate = typeof missionTemplates.$inferInsert;



