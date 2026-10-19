import { sql } from "drizzle-orm";
import { pgTable, serial, text, varchar, timestamp, integer, boolean, jsonb, index, bigserial, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs } from '../auth.js';
import { appInstances, apps } from '../apps.js';

// ============================================================================
// STATE RECONCILIATION SYSTEM (System 1)
// ============================================================================

/**
 * Audit log for state consistency checks and auto-remediation actions
 */
export const stateConsistencyLog = pgTable("state_consistency_log", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  instanceId: integer("instance_id").notNull().references(() => appInstances.id, { onDelete: "cascade" }),
  checkTimestamp: timestamp("check_timestamp", { withTimezone: true }).defaultNow().notNull(),

  // Database state
  dbStatus: varchar("db_status", { length: 20 }), // 'running'|'stopped'|'pending'
  dbContainerId: varchar("db_container_id", { length: 256 }),
  dbPort: integer("db_port"),

  // Docker state
  dockerExists: boolean("docker_exists"),
  dockerRunning: boolean("docker_running"),
  dockerContainerId: varchar("docker_container_id", { length: 256 }),
  dockerExitCode: integer("docker_exit_code"),
  dockerLastError: text("docker_last_error"),

  // Divergence detection
  divergenceType: varchar("divergence_type", { length: 50 }), // 'none'|'container_missing'|'state_mismatch'|'port_conflict'|'id_mismatch'|'zombie_process'
  divergenceDetails: jsonb("divergence_details"),

  // Auto-remediation attempt
  remediationAttempted: boolean("remediation_attempted").default(false).notNull(),
  remediationAction: varchar("remediation_action", { length: 100 }), // 'restart'|'recreate'|'force_stop'|'cleanup'
  remediationSuccess: boolean("remediation_success"),
  remediationError: text("remediation_error"),

  // Outcome
  outcome: varchar("outcome", { length: 50 }).notNull(), // 'healthy'|'divergent'|'unrecoverable'
  alertSent: boolean("alert_sent").default(false).notNull(),

  // Metadata
  orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  instanceIdIdx: index("state_consistency_instance_id_idx").on(table.instanceId),
  checkTimestampIdx: index("state_consistency_check_timestamp_idx").on(table.checkTimestamp),
  orgIdIdx: index("state_consistency_org_id_idx").on(table.orgId),
  divergenceTypeIdx: index("state_consistency_divergence_type_idx").on(table.divergenceType),
}));

export type StateConsistencyLog = typeof stateConsistencyLog.$inferSelect;
export const insertStateConsistencyLogSchema = createInsertSchema(stateConsistencyLog).omit({
  id: true,
  createdAt: true,
});

/**
 * Configuration for auto-remediation behavior and alerting thresholds
 */
export const consistencyRemediationConfig = pgTable("consistency_remediation_config", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),

  // Enable/disable auto-remediation
  autoRemediateEnabled: boolean("auto_remediate_enabled").default(true).notNull(),

  // Divergence types to remediate automatically
  remediateMissingContainer: boolean("remediate_missing_container").default(true).notNull(),
  remediateStateMismatch: boolean("remediate_state_mismatch").default(true).notNull(),
  remediatePortConflict: boolean("remediate_port_conflict").default(false).notNull(),

  // Remediation strategies
  restartStrategy: varchar("restart_strategy", { length: 20 }).default("graceful").notNull(), // 'graceful'|'force'|'recreate'
  restartTimeoutSeconds: integer("restart_timeout_seconds").default(30).notNull(),
  maxRestartAttempts: integer("max_restart_attempts").default(3).notNull(),

  // Alert configuration
  alertOnDivergence: boolean("alert_on_divergence").default(true).notNull(),
  alertChannels: text("alert_channels").default("slack").notNull(), // comma-separated e.g. 'slack,email'
  alertSeverity: varchar("alert_severity", { length: 20 }).default("warning").notNull(), // 'info'|'warning'|'critical'

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("consistency_remediation_config_org_id_idx").on(table.orgId),
}));

export type ConsistencyRemediationConfig = typeof consistencyRemediationConfig.$inferSelect;
export const insertConsistencyRemediationConfigSchema = createInsertSchema(consistencyRemediationConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// ============================================================================
// PROACTIVE HEALTH MONITORING SYSTEM (System 2)
// ============================================================================

/**
 * Track health check results over time
 */
export const healthCheckResults = pgTable("health_check_results", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  instanceId: integer("instance_id").notNull().references(() => appInstances.id, { onDelete: "cascade" }),
  orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
  checkTimestamp: timestamp("check_timestamp", { withTimezone: true }).defaultNow().notNull(),
  responseTimeMs: integer("response_time_ms"),
  status: varchar("status", { length: 20 }).notNull(), // 'healthy'|'degraded'|'unhealthy'|'unknown'
  statusCode: integer("status_code"),
  databaseStatus: varchar("database_status", { length: 20 }),
  cacheStatus: varchar("cache_status", { length: 20 }),
  brokerStatus: varchar("broker_status", { length: 20 }),
  errorMessage: text("error_message"),
  alertTriggered: boolean("alert_triggered").default(false).notNull(),
}, (table) => ({
  instanceIdIdx: index("health_check_instance_id_idx").on(table.instanceId),
  checkTimestampIdx: index("health_check_timestamp_idx").on(table.checkTimestamp),
  orgIdIdx: index("health_check_org_id_idx").on(table.orgId),
}));

export type HealthCheckResults = typeof healthCheckResults.$inferSelect;

/**
 * Configuration for health monitoring behavior
 */
export const healthCheckConfig = pgTable("health_check_config", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  checkIntervalSeconds: integer("check_interval_seconds").default(30).notNull(),
  checkTimeoutSeconds: integer("check_timeout_seconds").default(10).notNull(),
  staleHeartbeatSeconds: integer("stale_heartbeat_seconds").default(120).notNull(),
  unhealthyThresholdCount: integer("unhealthy_threshold_count").default(3).notNull(),
  degradedThresholdPercent: decimal("degraded_threshold_percent", { precision: 5, scale: 2 }).default("0.10").notNull(),
  alertEnabled: boolean("alert_enabled").default(true).notNull(),
  alertOnUnhealthy: boolean("alert_on_unhealthy").default(true).notNull(),
  alertOnDegraded: boolean("alert_on_degraded").default(false).notNull(),
  alertOnStaleHeartbeat: boolean("alert_on_stale_heartbeat").default(true).notNull(),
  alertOnDependencyIssue: boolean("alert_on_dependency_issue").default(true).notNull(),
  alertChannels: text("alert_channels").default("slack").notNull(),
  alertSeverity: varchar("alert_severity", { length: 20 }).default("warning").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("health_check_config_org_id_idx").on(table.orgId),
}));

export type HealthCheckConfig = typeof healthCheckConfig.$inferSelect;

/**
 * Track consecutive failures per instance
 */
export const healthCheckFailures = pgTable("health_check_failures", {
  instanceId: integer("instance_id").primaryKey().references(() => appInstances.id, { onDelete: "cascade" }),
  failureCount: integer("failure_count").default(0).notNull(),
  lastFailureTime: timestamp("last_failure_time", { withTimezone: true }),
  lastSuccessfulTime: timestamp("last_successful_time", { withTimezone: true }),
  alertSentAt: timestamp("alert_sent_at", { withTimezone: true }),
});

export type HealthCheckFailures = typeof healthCheckFailures.$inferSelect;

