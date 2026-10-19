import { pgTable, serial, integer, text, timestamp, jsonb, decimal, index } from "drizzle-orm/pg-core";
import { missionRuns } from "./missions/runs.js";
import { agentDeployments } from "./agent-deployments.js";

// ============================================================================
// PERFORMANCE SNAPSHOTS (Per-run agent performance capture)
// ============================================================================

export const performanceSnapshots = pgTable("performance_snapshots", {
  id: serial("id").primaryKey(),
  agentDeploymentId: integer("agent_deployment_id").notNull().references(() => agentDeployments.id, { onDelete: "cascade" }),
  missionRunId: integer("mission_run_id").notNull().references(() => missionRuns.id, { onDelete: "cascade" }),
  successRate: decimal("success_rate", { precision: 6, scale: 5 }).notNull().default("0"),
  costUsd: decimal("cost_usd", { precision: 10, scale: 4 }).default("0"),
  efficiencyScore: decimal("efficiency_score", { precision: 6, scale: 5 }).default("0"),
  oceanTraitsSnapshot: jsonb("ocean_traits_snapshot").default({}),
  runOutcome: text("run_outcome"),
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
}, (table) => [
  index("idx_ps_agent").on(table.agentDeploymentId),
  index("idx_ps_run").on(table.missionRunId),
  index("idx_ps_captured").on(table.capturedAt),
]);

export type PerformanceSnapshot = typeof performanceSnapshots.$inferSelect;
