import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";
import { operationalCycles } from "./operational-cycles.js";
import { missionRuns } from "./missions/index.js";

export const xrayOperationalConfigs = pgTable("xray_operational_configs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  schemaVersion: text("schema_version").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  version: integer("version").notNull().default(1),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, table => [
  uniqueIndex("xray_operational_configs_org_scope_unique").on(table.organizationId, table.scope),
]);

export const xrayOperationalEvents = pgTable("xray_operational_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  cycleId: integer("cycle_id").references(() => operationalCycles.id, { onDelete: "set null" }),
  missionRunId: integer("mission_run_id").references(() => missionRuns.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  subjectNodeId: text("subject_node_id"),
  severity: text("severity").notNull(),
  deduplicationKey: text("deduplication_key").notNull(),
  deduplicationBucket: text("deduplication_bucket").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  evaluation: jsonb("evaluation").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, table => [
  uniqueIndex("xray_operational_events_dedupe_unique").on(
    table.organizationId,
    table.scope,
    table.deduplicationKey,
    table.deduplicationBucket,
  ),
  index("xray_operational_events_org_scope_created_idx").on(
    table.organizationId,
    table.scope,
    table.createdAt,
  ),
  index("xray_operational_events_cycle_idx").on(table.cycleId, table.createdAt),
]);

export const xrayOperationalNotifications = pgTable("xray_operational_notifications", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  eventId: integer("event_id").notNull().references(() => xrayOperationalEvents.id, { onDelete: "cascade" }),
  ruleId: text("rule_id").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  recipientRoles: jsonb("recipient_roles").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("unread"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, table => [
  uniqueIndex("xray_operational_notifications_event_rule_unique").on(table.eventId, table.ruleId),
  index("xray_operational_notifications_org_status_created_idx").on(
    table.organizationId,
    table.status,
    table.createdAt,
  ),
]);

export type XrayOperationalConfigRecord = typeof xrayOperationalConfigs.$inferSelect;
export type XrayOperationalEventRecord = typeof xrayOperationalEvents.$inferSelect;
export type XrayOperationalNotificationRecord = typeof xrayOperationalNotifications.$inferSelect;
