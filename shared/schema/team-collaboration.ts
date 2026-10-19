import { pgTable, text, serial, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';

export const teams = pgTable("teams", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug"),
    description: text("description"),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    squadType: text("squad_type").notNull().default("operational"), // "operational" | "incident_response" | "field_ops" | "engineering" | "triage"
    leadUserId: text("lead_user_id"), // Designated supervisory human lead
    homeH3Index: text("home_h3_index"), // Home operational base (Uber H3 Index)
    status: text("status").notNull().default("on_duty"), // "on_duty" | "standby" | "active_mission" | "offline"
    metadata: jsonb("metadata").default({}),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
});

export const teamMembers = pgTable("team_members", {
    id: serial("id").primaryKey(),
    teamId: integer("team_id").references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id"), // Backwards compatibility for human user id
    memberType: text("member_type").$type<"user" | "agent">().default("user").notNull(), // Polymorphic co-member
    memberId: text("member_id"), // Polymorphic id referencing users.id OR agent_instances.id
    role: text("role").notNull().default("member"), // "lead" | "supervisor" | "specialist" | "operator" | "worker" | "watchdog"
    permissions: jsonb("permissions").default([]),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const teamPermissions = pgTable("team_permissions", {
    id: serial("id").primaryKey(),
    teamId: integer("team_id").references(() => teams.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    action: text("action").notNull(),
    conditions: jsonb("conditions").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
});

export const cycleTemplates = pgTable("cycle_templates", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    objective: text("objective").notNull(),
    category: text("category").notNull(),
    blueprints: jsonb("blueprints").default([]),
    tags: jsonb("tags").default([]),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    isPublic: boolean("is_public").default(false),
    usageCount: integer("usage_count").default(0),
    rating: integer("rating").default(0),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
});

export const collaborationEvents = pgTable("collaboration_events", {
    id: serial("id").primaryKey(),
    teamId: integer("team_id").references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    details: jsonb("details").default({}),
    timestamp: timestamp("timestamp").defaultNow().notNull()
});

// Insert schemas
export const insertTeamSchema = createInsertSchema(teams).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true
});

export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({
    id: true,
    joinedAt: true
});

export const insertTeamPermissionSchema = createInsertSchema(teamPermissions).omit({
    id: true,
    createdAt: true,
    updatedAt: true
});

export const insertCycleTemplateSchema = createInsertSchema(cycleTemplates).omit({
    id: true,
    createdAt: true,
    updatedAt: true
});

export const insertCollaborationEventSchema = createInsertSchema(collaborationEvents).omit({
    id: true,
    timestamp: true
});

// Select schemas
export const selectTeamSchema = createSelectSchema(teams);
export const selectTeamMemberSchema = createSelectSchema(teamMembers);
export const selectTeamPermissionSchema = createSelectSchema(teamPermissions);
export const selectCycleTemplateSchema = createSelectSchema(cycleTemplates);
export const selectCollaborationEventSchema = createSelectSchema(collaborationEvents);

// Types
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type TeamPermission = typeof teamPermissions.$inferSelect;
export type CycleTemplate = typeof cycleTemplates.$inferSelect;
export type CollaborationEvent = typeof collaborationEvents.$inferSelect;


