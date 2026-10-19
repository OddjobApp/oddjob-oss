import { pgTable, text, integer, decimal, boolean, timestamp, smallint, index } from "drizzle-orm/pg-core";
import { orgs } from './auth.js';

export const agentPerformances = pgTable("agent_performances", {
  id: text("id").primaryKey(), // format: "{agentId}-{orgId}"
  agentId: text("agent_id").notNull(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id),
  totalMissions: integer("total_missions").notNull().default(0),
  successfulMissions: integer("successful_missions").notNull().default(0),
  failedMissions: integer("failed_missions").notNull().default(0),
  successRate: decimal("success_rate", { precision: 6, scale: 5 }).notNull().default("0"),
  totalCost: integer("total_cost").notNull().default(0),
  avgCostPerMission: decimal("avg_cost_per_mission", { precision: 12, scale: 2 }).notNull().default("0"),
  costPerSuccess: decimal("cost_per_success", { precision: 12, scale: 2 }).notNull().default("0"),
  efficiencyScore: decimal("efficiency_score", { precision: 6, scale: 5 }).notNull().default("0"),
  trend: text("trend").notNull().default("stable"),
  status: text("status").notNull().default("active"),
  firstMissionAt: timestamp("first_mission_at", { withTimezone: true }),
  lastMissionAt: timestamp("last_mission_at", { withTimezone: true }),
  lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_performances_org").on(table.organizationId),
]);

export const performanceImprovementPlans = pgTable("performance_improvement_plans", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id),
  status: text("status").notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  deadlineDays: integer("deadline_days").notNull().default(14),
  targetSuccessRate: decimal("target_success_rate", { precision: 6, scale: 5 }).notNull().default("0.80000"),
  targetCostEfficiency: decimal("target_cost_efficiency", { precision: 12, scale: 2 }).notNull().default("0"),
  triggerReason: text("trigger_reason"),
  thresholdFailed: text("threshold_failed"),
  upskillingAttempts: integer("upskilling_attempts").notNull().default(0),
  retrainingSessions: integer("retraining_sessions").notNull().default(0),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  outcome: text("outcome"),
  finalSuccessRate: decimal("final_success_rate", { precision: 6, scale: 5 }),
  finalCostEfficiency: decimal("final_cost_efficiency", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_pips_agent").on(table.agentId),
  index("idx_pips_org").on(table.organizationId),
  index("idx_pips_status").on(table.status),
]);

export const agentUpskillingJobs = pgTable("agent_upskilling_jobs", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  pipId: text("pip_id").notNull().references(() => performanceImprovementPlans.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"),
  type: text("type").notNull(),
  datasetId: text("dataset_id"),
  modelId: text("model_id"),
  externalJobId: text("external_job_id"),
  progressPercent: smallint("progress_percent").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_upskilling_pip").on(table.pipId),
]);

export type AgentPerformanceRecord = typeof agentPerformances.$inferSelect;
export type PerformanceImprovementPlanRecord = typeof performanceImprovementPlans.$inferSelect;
export type AgentUpskillingJobRecord = typeof agentUpskillingJobs.$inferSelect;


