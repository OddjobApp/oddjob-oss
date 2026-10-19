import { pgTable, serial, integer, text, jsonb, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { missionRuns } from './missions/runs.js';

export const antigravityIncidentStatusEnum = pgEnum("antigravity_incident_status", [
  "pending",
  "investigating",
  "resolved"
]);

export const antigravityIncidents = pgTable("antigravity_incidents", {
  id: serial("id").primaryKey(),
  missionRunId: integer("mission_run_id").references(() => missionRuns.id).notNull(),
  description: text("description").notNull(),
  context: jsonb("context").$type<{
    logs?: any[];
    stackTrace?: string;
    htmlSnapshot?: string;
    lastError?: string;
    blackboardSnapshot?: any;
  }>().notNull(),
  status: antigravityIncidentStatusEnum("status").notNull().default("pending"),
  traceId: text("trace_id"),
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAntigravityIncidentSchema = createInsertSchema(antigravityIncidents);
export const selectAntigravityIncidentSchema = createSelectSchema(antigravityIncidents);

export type AntigravityIncident = typeof antigravityIncidents.$inferSelect;
export type InsertAntigravityIncident = typeof antigravityIncidents.$inferInsert;


