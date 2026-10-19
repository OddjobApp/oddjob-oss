
import { pgTable, serial, text, integer, timestamp, varchar, boolean, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { orgs } from '../auth.js';

/**
 * Agent Performance Improvement Plans (PIP)
 * Tracks agents currently under performance review
 */
export const agentPips = pgTable("agent_pips", {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").notNull(), // Link to assistants/agents table
    organizationId: integer("organization_id").references(() => orgs.id),
    status: varchar("status", { length: 50 }).default("active").notNull(), // 'active', 'completed', 'failed', 'pruned'
    reason: text("reason").notNull(),
    failureThreshold: real("failure_threshold").default(0.3).notNull(), // PIP failure if error rate > 30%
    currentErrorRate: real("current_error_rate").default(0),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    metrics: jsonb("metrics").default({}), // Detailed breakdown of failures
});

/**
 * Agent Conduct & Performance Logs
 * High-level audit of agent "behavior"
 */
export const agentConductLogs = pgTable("agent_conduct_logs", {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").notNull(),
    type: varchar("type", { length: 50 }).notNull(), // 'ERROR_SPIKE', 'BUDGET_WASTE', 'HALLUCINATION', 'SUCCESS_STREAK'
    severity: varchar("severity", { length: 20 }).default("info").notNull(), // 'info', 'warning', 'critical'
    description: text("description").notNull(),
    missionId: integer("mission_id"),
    executionId: integer("execution_id"),
    data: jsonb("data"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAgentPipSchema = createInsertSchema(agentPips);
export const insertAgentConductLogSchema = createInsertSchema(agentConductLogs);

export type AgentPip = typeof agentPips.$inferSelect;
export type AgentConductLog = typeof agentConductLogs.$inferSelect;


