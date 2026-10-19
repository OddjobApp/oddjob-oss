import { pgTable, serial, integer, text, boolean, doublePrecision, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";
import { missionRuns } from "./missions/index.js";

export const copilotCommandEvents = pgTable("copilot_command_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  commandId: text("command_id").notNull(),
  surface: text("surface").notNull(),
  riskLevel: text("risk_level").notNull(),
  requiresApproval: boolean("requires_approval").notNull(),
  missionId: integer("mission_id"),
  missionRunId: integer("mission_run_id").references(() => missionRuns.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("copilot_command_events_org_created_idx").on(t.organizationId, t.createdAt),
  index("copilot_command_events_command_idx").on(t.commandId),
]);

export const copilotSourceReviews = pgTable("copilot_source_reviews", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  sourceId: text("source_id").notNull(),
  sourceType: text("source_type").notNull().default("knowledge"),
  originalConfidence: doublePrecision("original_confidence").notNull(),
  outcome: text("outcome").notNull(), // relevant | partially_relevant | irrelevant
  outcomeScore: doublePrecision("outcome_score").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("copilot_source_reviews_org_source_idx").on(t.organizationId, t.sourceId),
  index("copilot_source_reviews_org_created_idx").on(t.organizationId, t.createdAt),
]);

export type CopilotCommandEvent = typeof copilotCommandEvents.$inferSelect;
export type CopilotSourceReview = typeof copilotSourceReviews.$inferSelect;
