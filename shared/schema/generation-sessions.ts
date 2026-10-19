import { pgTable, text, integer, timestamp, decimal, jsonb, uuid, index, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from './auth.js';
import { operationalCycles } from './operational-cycles.js';
import { teams } from './team-collaboration.js';

// ============================================================================
// GENERATION SESSIONS (SDLC Code Generation Pipeline)
// ============================================================================

export const generationSessionStatuses = [
  'pending', 'active', 'paused', 'completed', 'failed', 'timed_out', 'cancelled'
] as const;
export type GenerationSessionStatus = typeof generationSessionStatuses[number];

export const generationSessions = pgTable("generation_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: text("template_id").notNull(),
  cycleId: integer("cycle_id").references(() => operationalCycles.id, { onDelete: "set null" }),
  assignedTeamId: integer("assigned_team_id").references(() => teams.id, { onDelete: "set null" }),
  organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),

  // Lifecycle
  status: text("status").notNull().default("pending"),
  currentPhase: text("current_phase"),
  phaseSequence: jsonb("phase_sequence").$type<string[]>().notNull().default([]),

  // Input Parameters
  inputParams: jsonb("input_params").notNull().default({}),

  // Cost & Budget
  budgetLimitUsd: decimal("budget_limit_usd", { precision: 12, scale: 2 }),
  currentCostUsd: decimal("current_cost_usd", { precision: 12, scale: 2 }).default("0.00"),
  tokenCount: integer("token_count").default(0),

  // TTL
  ttlHours: integer("ttl_hours"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),

  // Tracing
  traceId: varchar("trace_id", { length: 32 }),

  // Metadata
  metadata: jsonb("metadata").default({}),
  createdBy: text("created_by").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  orgIdx: index("idx_gen_sessions_org").on(table.organizationId),
  statusIdx: index("idx_gen_sessions_status").on(table.status),
  cycleIdx: index("idx_gen_sessions_cycle").on(table.cycleId),
}));

export type GenerationSession = typeof generationSessions.$inferSelect;
export type InsertGenerationSession = typeof generationSessions.$inferInsert;
