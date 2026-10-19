
import { pgTable, text, serial, integer, timestamp, decimal, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';
import { projects } from './projects.js';

export const CYCLE_STATUSES = ['planning', 'pending_approval', 'active', 'paused', 'reviewing', 'closed', 'cancelled'] as const;
export type CycleStatus = typeof CYCLE_STATUSES[number];

export const operationalCycles = pgTable("operational_cycles", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    objective: text("objective").notNull(),
    status: text("status").notNull().default("planning"), // planning, pending_approval, active, paused, reviewing, closed, cancelled
    
    // Temporal Logic
    startDate: timestamp("start_date").notNull().defaultNow(),
    endDate: timestamp("end_date"),
    recurrence: text("recurrence").default("once"), // once, daily, weekly, monthly, custom
    timezone: text("timezone").default("UTC"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    
    priority: integer("priority").default(5), // 1 (Highest) to 10 (Lowest)
    
    // Fiscal & Resource Guardrails
    budgetLimitUsd: decimal("budget_limit_usd", { precision: 12, scale: 2 }).default("100.00"),
    currentSpendUsd: decimal("current_spend_usd", { precision: 12, scale: 2 }).default("0.00"),
    tokenLimit: integer("token_limit").default(1000000),
    
    // Outcomes & Metrics
    successCriteria: jsonb("success_criteria").default({}),
    outcomeMetrics: jsonb("outcome_metrics").default({}),
    
    requiresApproval: integer("requires_approval").default(0),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),

    // The single exception to the project_resources junction (PROJECT_SPACES_DESIGN §5.3):
    // cycle -> project is strict, always-present ownership that drives budget rollup and
    // sits on the hot path, so it earns a real column. Everything else goes through the
    // junction. ON DELETE SET NULL: deleting a project must not delete execution history.
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),

    metadata: jsonb("metadata").default({}),
    blueprintCount: integer("blueprint_count").default(0),

    // Orchestration plan (computed at launch): topological waves + critical path (CPM).
    // Shape: { waves: string[][], criticalPath: string[], projectDurationMs: number,
    //          computedAt: string, nodes: Record<name, {earliestStart,float,onCriticalPath,...}> }
    executionPlan: jsonb("execution_plan"),
    // Concurrency controls: { maxParallelMissions?: number, resourcePools?: [{name,capacity,missions[]}] }
    executionPolicy: jsonb("execution_policy").default({}),

    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
}, (table) => ({
    orgIdx: index("idx_operational_cycles_organization_id").on(table.organizationId),
    projectIdx: index("idx_operational_cycles_project").on(table.projectId),
}));

/**
 * CYCLE BLUEPRINTS
 * 
 * Relational tactical components for an operational cycle.
 * Allows for versioned, queryable mission sequences.
 */
export const cycleBlueprints = pgTable("cycle_blueprints", {
    id: serial("id").primaryKey(),
    cycleId: integer("cycle_id").references(() => operationalCycles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    objective: text("objective").notNull(),
    type: text("type").notNull().default("mission"), // mission, report, sweep
    
    // Gantt / Dependency Data
    dependencies: jsonb("dependencies").default([]), // Array of { blueprintName, type, leadLag }
    estimatedDays: integer("estimated_days").default(1),

    // CPM denorm (computed at launch) â€” queryable fields for Gantt/critical-path UI.
    // Per-node float/timings live in operational_cycles.executionPlan (jsonb, ms).
    waveIndex: integer("wave_index"),
    onCriticalPath: boolean("on_critical_path").default(false),

    // Execution Metadata
    config: jsonb("config").default({}),
    metadata: jsonb("metadata").default({}),

    // Pipeline artifact contracts: { input_contract?: ArtifactContract, output_contract?: ArtifactContract }
    artifactContracts: jsonb("artifact_contracts"),
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    cycleIdIdx: index("idx_cycle_blueprints_cycle_id").on(table.cycleId),
}));

/**
 * STRATEGIC AUDITS (Sentinel Logs)
 * 
 * Historical record of Strategic Sentinel drift analysis.
 */
export const cycleStrategicAudits = pgTable("cycle_strategic_audits", {
    id: serial("id").primaryKey(),
    cycleId: integer("cycle_id").references(() => operationalCycles.id, { onDelete: "cascade" }),
    alignmentScore: integer("alignment_score").notNull(), // 0-100
    analysis: text("analysis").notNull(),
    suggestedAction: text("suggested_action").notNull(), // CONTINUE, PAUSE, PIVOT
    isCriticalDrift: boolean("is_critical_drift").default(false).notNull(),
    
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertOperationalCycleSchema = createInsertSchema(operationalCycles).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const insertCycleBlueprintSchema = createInsertSchema(cycleBlueprints).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const insertCycleStrategicAuditSchema = createInsertSchema(cycleStrategicAudits).omit({
    id: true,
    createdAt: true,
});

/**
 * CYCLE WEBHOOKS
 *
 * Outbound webhook subscriptions for cycle events.
 * Persisted so subscriptions survive server restarts.
 */
export const cycleWebhooks = pgTable("cycle_webhooks", {
    id: text("id").primaryKey(),
    orgId: integer("org_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: jsonb("events").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * CYCLE DEPENDENCY GATES
 *
 * Persists the dependency wait state for each blocked blueprint so the system
 * survives restarts. The in-memory event emitter resolves these efficiently;
 * this table is the durable source of truth used for recovery on restart.
 */
export const cycleDependencyGates = pgTable("cycle_dependency_gates", {
    id: serial("id").primaryKey(),
    cycleId: integer("cycle_id").references(() => operationalCycles.id, { onDelete: "cascade" }).notNull(),
    upstreamBlueprintName: text("upstream_blueprint_name").notNull(),
    downstreamBlueprintName: text("downstream_blueprint_name").notNull(),
    dependencyType: text("dependency_type").notNull().default("finish_to_start"),
    offsetMs: integer("offset_ms").default(0),
    offsetDirection: text("offset_direction").default("plus"),
    status: text("status").notNull().default("waiting"), // waiting | resolved | expired
    // Configurable timeout + graduated escalation (#3)
    timeoutMs: integer("timeout_ms"),                                  // null â†’ use default
    escalationState: text("escalation_state").default("none"),        // none | warned | alerted | escalated
    escalatedTo: text("escalated_to"),                                // e.g. "scrum-master"
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OperationalCycle = typeof operationalCycles.$inferSelect;
export type CycleBlueprint = typeof cycleBlueprints.$inferSelect;
export type CycleStrategicAudit = typeof cycleStrategicAudits.$inferSelect;
export type CycleWebhook = typeof cycleWebhooks.$inferSelect;
export type CycleDependencyGate = typeof cycleDependencyGates.$inferSelect;


