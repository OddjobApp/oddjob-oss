import { pgTable, text, serial, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';

// ============================================================================
// COMPETENCIES TAXONOMY
// ============================================================================

export const competencies = pgTable("competencies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default("general"), // "engineering", "security", "operations", "legal", "domain", etc.
  description: text("description"),
  organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_competencies_org_id").on(table.organizationId),
  index("idx_competencies_category").on(table.category),
]);

export const insertCompetencySchema = createInsertSchema(competencies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectCompetencySchema = createSelectSchema(competencies);
export type Competency = typeof competencies.$inferSelect;
export type NewCompetency = typeof competencies.$inferInsert;

// ============================================================================
// ACTOR COMPETENCIES (Polymorphic: Human Users <-> Autonomous Agents)
// ============================================================================

export const actorCompetencies = pgTable("actor_competencies", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
  actorType: text("actor_type").$type<"human" | "agent">().notNull().default("agent"),
  actorId: text("actor_id").notNull(), // Polymorphic reference to users.id OR agent_deployments.id
  competencyId: integer("competency_id").references(() => competencies.id, { onDelete: "cascade" }).notNull(),
  proficiencyLevel: integer("proficiency_level").notNull().default(1), // 1 (Novice) to 5 (Expert / Tier-1 Primary)
  verifiedAt: timestamp("verified_at").defaultNow().notNull(),
  verifiedBy: text("verified_by"), // ID of human lead, canary eval benchmark, or supervisor
  metadata: jsonb("metadata").$type<Record<string, any>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_actor_comp_org").on(table.organizationId),
  index("idx_actor_comp_actor").on(table.actorType, table.actorId),
  index("idx_actor_comp_competency").on(table.competencyId),
  uniqueIndex("idx_actor_comp_unique").on(table.actorType, table.actorId, table.competencyId),
]);

export const insertActorCompetencySchema = createInsertSchema(actorCompetencies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectActorCompetencySchema = createSelectSchema(actorCompetencies);
export type ActorCompetency = typeof actorCompetencies.$inferSelect;
export type NewActorCompetency = typeof actorCompetencies.$inferInsert;
