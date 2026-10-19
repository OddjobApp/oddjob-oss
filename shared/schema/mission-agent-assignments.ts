import { pgTable, serial, integer, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { missionRuns } from "./missions/runs.js";
import { agentDeployments } from "./agent-deployments.js";

// ============================================================================
// MISSION AGENT ASSIGNMENTS (Junction: mission_runs <-> agent_deployments)
// ============================================================================

export const missionAgentAssignments = pgTable("mission_agent_assignments", {
  id: serial("id").primaryKey(),
  missionRunId: integer("mission_run_id").notNull().references(() => missionRuns.id, { onDelete: "cascade" }),
  agentDeploymentId: integer("agent_deployment_id").notNull().references(() => agentDeployments.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("primary"),
  configSnapshot: jsonb("config_snapshot").default({}),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
}, (table) => [
  index("idx_maa_run").on(table.missionRunId),
  index("idx_maa_agent").on(table.agentDeploymentId),
  uniqueIndex("idx_maa_run_agent").on(table.missionRunId, table.agentDeploymentId),
]);

export type MissionAgentAssignment = typeof missionAgentAssignments.$inferSelect;
export type InsertMissionAgentAssignment = typeof missionAgentAssignments.$inferInsert;
