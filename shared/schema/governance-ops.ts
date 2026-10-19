import { pgTable, text, integer, decimal, boolean, timestamp, serial, smallint, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from './auth.js';

export const governanceBudgetPolicies = pgTable("governance_budget_policies", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: integer("organization_id").notNull().references(() => orgs.id),
  department: text("department"),
  monthlyLimit: integer("monthly_limit").notNull().default(100000),
  alertThreshold: decimal("alert_threshold", { precision: 5, scale: 3 }).notNull().default("0.800"),
  hardLimit: integer("hard_limit").notNull().default(150000),
  currency: text("currency").notNull().default("tokens"),
  resetDay: smallint("reset_day").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_gov_budget_policies_org").on(table.organizationId),
]);

export const governanceAgentSalaries = pgTable("governance_agent_salaries", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  agentId: text("agent_id").notNull(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id),
  tokenAllowance: integer("token_allowance").notNull().default(50000),
  currentSpend: integer("current_spend").notNull().default(0),
  lifetimeSpend: integer("lifetime_spend").notNull().default(0),
  efficiencyScore: decimal("efficiency_score", { precision: 6, scale: 5 }).notNull().default("0"),
  lastEvaluationAt: timestamp("last_evaluation_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_gov_salaries_agent").on(table.agentId),
  index("idx_gov_salaries_org").on(table.organizationId),
]);

export const governanceApprovals = pgTable("governance_approvals", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  organizationId: integer("organization_id").notNull().references(() => orgs.id),
  type: text("type").notNull(),
  requesterId: text("requester_id").notNull(),
  missionId: integer("mission_id"),
  manifestId: text("manifest_id"),
  projectedCost: integer("projected_cost").notNull().default(0),
  currentSpend: integer("current_spend").notNull().default(0),
  budgetLimit: integer("budget_limit").notNull().default(0),
  riskLevel: text("risk_level").notNull().default("medium"),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("pending"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  requiredBy: timestamp("required_by", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_gov_approvals_org").on(table.organizationId),
  index("idx_gov_approvals_status").on(table.status),
]);

export const agentSpendEvents = pgTable("agent_spend_events", {
  id: serial("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  organizationId: integer("organization_id").notNull().references(() => orgs.id),
  amount: integer("amount").notNull(),
  success: boolean("success").notNull().default(true),
  reason: text("reason"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_spend_events_agent").on(table.agentId),
  index("idx_spend_events_org").on(table.organizationId),
  index("idx_spend_events_timestamp").on(table.timestamp),
]);

export type GovernanceBudgetPolicy = typeof governanceBudgetPolicies.$inferSelect;
export type GovernanceAgentSalary = typeof governanceAgentSalaries.$inferSelect;
export type GovernanceApproval = typeof governanceApprovals.$inferSelect;
export type AgentSpendEvent = typeof agentSpendEvents.$inferSelect;


