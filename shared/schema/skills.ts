import { pgTable, text, serial, timestamp, boolean, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';

export const skills = pgTable("skills", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  language: text("language").notNull().default("javascript"), // javascript, python, rust, etc.
  code: text("code").notNull(),
  isInstalled: boolean("is_installed").notNull().default(true), // Default true for simple code-only skills
  installCommand: text("install_command"),
  isPublic: boolean("is_public").notNull().default(false),
  organizationId: integer("organization_id").references(() => orgs.id),
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSkillSchema = createInsertSchema(skills);
export const selectSkillSchema = createSelectSchema(skills);
export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;

// Linear snapshot history for the real `skills` row above — distinct from the
// unrelated `skill_versions` table used by the skill-marketplace feature, which
// targets an incompatible schema on a table of the same physical name.
export const skillVersionHistory = pgTable("skill_version_history", {
  id: serial("id").primaryKey(),
  skillId: integer("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  source: text("source").notNull().default("manual"), // 'pre_promotion_snapshot' | 'autoresearch_promotion' | 'rollback' | 'manual'
  shadowRunId: integer("shadow_run_id"), // soft ref to missionShadowRuns.id — no FK to avoid a cross-schema-file import cycle
  strategyDescription: text("strategy_description"),
  promotedBy: text("promoted_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSkillVersionHistorySchema = createInsertSchema(skillVersionHistory);
export type SkillVersionHistory = typeof skillVersionHistory.$inferSelect;
export type NewSkillVersionHistory = typeof skillVersionHistory.$inferInsert;



