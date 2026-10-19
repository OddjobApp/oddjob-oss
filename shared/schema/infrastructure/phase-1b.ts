import { sql } from "drizzle-orm";
import { pgTable, serial, text, varchar, timestamp, integer, boolean, jsonb, index, uniqueIndex, bigserial } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs, users } from '../auth.js';
import { appInstances, apps } from '../apps.js';

// ============================================================================
// CONTAINER LIFECYCLE MANAGEMENT (System 3)
// ============================================================================

/**
 * Tracks all container lifecycle operations (create, update, shutdown, restart)
 * Used for audit trail and operational analytics
 */
export const containerLifecycleLog = pgTable("container_lifecycle_log", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  instanceId: integer("instance_id").notNull().references(() => appInstances.id, { onDelete: "cascade" }),
  operation: varchar("operation", { length: 50 }).notNull(), // 'create'|'update'|'shutdown'|'restart'
  operationTimestamp: timestamp("operation_timestamp", { withTimezone: true }).defaultNow().notNull(),

  // Container details
  containerId: varchar("container_id", { length: 256 }),
  imageName: varchar("image_name", { length: 256 }),
  imageTag: varchar("image_tag", { length: 100 }),
  imageDigest: varchar("image_digest", { length: 256 }), // SHA256:xxx for pinning

  // Resource configuration
  memoryLimitMb: integer("memory_limit_mb"),
  cpuLimitMillicores: integer("cpu_limit_millicores"),

  // Operation result
  status: varchar("status", { length: 20 }).notNull(), // 'success'|'failed'|'timeout'|'partial'
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
  errorStacktrace: text("error_stacktrace"),

  // Volume operations
  volumesCreated: integer("volumes_created").default(0).notNull(),
  volumesDeleted: integer("volumes_deleted").default(0).notNull(),

  // Metadata
  orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
  performedBy: varchar("performed_by", { length: 100 }), // User or system

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  instanceTimestampIdx: index("container_lifecycle_instance_timestamp_idx").on(table.instanceId, table.operationTimestamp),
  operationIdx: index("container_lifecycle_operation_idx").on(table.operation),
  statusIdx: index("container_lifecycle_status_idx").on(table.status),
  orgIdx: index("container_lifecycle_org_idx").on(table.orgId),
}));

export type ContainerLifecycleLog = typeof containerLifecycleLog.$inferSelect;
export const insertContainerLifecycleLogSchema = createInsertSchema(containerLifecycleLog).omit({
  id: true,
  createdAt: true,
});

/**
 * Tracks image versions used by apps
 * Used for inventory, deprecation tracking, and cleanup
 */
export const containerImageUsage = pgTable("container_image_usage", {
  id: serial("id").primaryKey(),
  appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
  imageName: varchar("image_name", { length: 256 }).notNull(),
  imageTag: varchar("image_tag", { length: 100 }).notNull(),
  imageDigest: varchar("image_digest", { length: 256 }), // Pinned digest if available

  firstUsedAt: timestamp("first_used_at", { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  usageCount: integer("usage_count").default(1).notNull(),

  // Image metadata
  sizeMb: integer("size_mb"),
  layers: integer("layers"),

  // Status
  available: boolean("available").default(true).notNull(),
  deprecated: boolean("deprecated").default(false).notNull(),

  orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
}, (table) => ({
  appImageUnq: uniqueIndex("container_image_usage_app_image_unq").on(table.appId, table.imageName, table.imageTag),
  appImageIdx: index("container_image_usage_app_image_idx").on(table.appId, table.imageName),
}));

export type ContainerImageUsage = typeof containerImageUsage.$inferSelect;
export const insertContainerImageUsageSchema = createInsertSchema(containerImageUsage).omit({
  id: true,
  firstUsedAt: true,
});

/**
 * Tracks volume lifecycle and usage
 * Used for storage management and cleanup
 */
export const containerVolumes = pgTable("container_volumes", {
  id: serial("id").primaryKey(),
  instanceId: integer("instance_id").references(() => appInstances.id, { onDelete: "cascade" }),
  volumeName: varchar("volume_name", { length: 256 }).notNull(),
  volumeType: varchar("volume_type", { length: 20 }).notNull(), // 'named'|'hostPath'|'emptyDir'

  mountPath: varchar("mount_path", { length: 256 }).notNull(),
  hostPath: varchar("host_path", { length: 256 }), // For hostPath volumes

  sizeMb: integer("size_mb"), // Current usage
  maxSizeMb: integer("max_size_mb"),

  orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => ({
  instanceVolumeUnq: uniqueIndex("container_volumes_instance_volume_unq").on(table.instanceId, table.volumeName),
  volumeNameIdx: index("container_volumes_volume_name_idx").on(table.volumeName),
  instanceIdx: index("container_volumes_instance_idx").on(table.instanceId),
}));

export type ContainerVolume = typeof containerVolumes.$inferSelect;
export const insertContainerVolumeSchema = createInsertSchema(containerVolumes).omit({
  id: true,
  createdAt: true,
});

// ============================================================================
// PORT MANAGEMENT (System 4)
// ============================================================================

/**
 * Tracks all port allocations and releases
 * Used for audit trail and port reuse strategy
 */
export const portAllocations = pgTable("port_allocations", {
  id: serial("id").primaryKey(),
  instanceId: integer("instance_id").notNull().references(() => appInstances.id, { onDelete: "cascade" }),
  appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
  orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),

  // Port details
  portNumber: integer("port_number").notNull(),
  allocatedAt: timestamp("allocated_at", { withTimezone: true }).defaultNow().notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),

  // Allocation strategy
  allocationType: varchar("allocation_type", { length: 50 }).notNull(), // 'sticky'|'dynamic'|'manual'
  previousPort: integer("previous_port"), // Previous port if sticky allocation

  // Metadata
  allocationReason: varchar("allocation_reason", { length: 100 }), // 'first_deploy'|'restart'|'migration'
  allocatedBy: varchar("allocated_by", { length: 100 }).notNull(), // User or system
}, (table) => ({
  instancePortUnq: uniqueIndex("port_allocations_instance_port_unq").on(table.instanceId, table.portNumber),
  orgPortIdx: index("port_allocations_org_port_idx").on(table.orgId, table.portNumber),
  allocatedAtIdx: index("port_allocations_allocated_at_idx").on(table.allocatedAt),
  releasedAtIdx: index("port_allocations_released_at_idx").on(table.releasedAt),
}));

export type PortAllocation = typeof portAllocations.$inferSelect;
export const insertPortAllocationSchema = createInsertSchema(portAllocations).omit({
  id: true,
  allocatedAt: true,
});

/**
 * Tracks detected port conflicts
 * Used for alerting and conflict resolution
 */
export const portConflicts = pgTable("port_conflicts", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  portNumber: integer("port_number").notNull(),
  conflictTimestamp: timestamp("conflict_timestamp", { withTimezone: true }).defaultNow().notNull(),

  // Conflicting instances
  requestedByInstanceId: integer("requested_by_instance_id"),
  requestedByAppId: integer("requested_by_app_id"),
  holdingInstanceId: integer("holding_instance_id"),
  holdingAppId: integer("holding_app_id"),

  // Resolution
  resolved: boolean("resolved").default(false).notNull(),
  resolutionAction: varchar("resolution_action", { length: 100 }), // 'reassign'|'release'|'manual'
  resolutionTimestamp: timestamp("resolution_timestamp", { withTimezone: true }),

  // Metadata
  orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
}, (table) => ({
  portTimestampIdx: index("port_conflicts_port_timestamp_idx").on(table.portNumber, table.conflictTimestamp),
  resolvedIdx: index("port_conflicts_resolved_idx").on(table.resolved),
  orgIdx: index("port_conflicts_org_idx").on(table.orgId),
}));

export type PortConflict = typeof portConflicts.$inferSelect;
export const insertPortConflictSchema = createInsertSchema(portConflicts).omit({
  id: true,
  conflictTimestamp: true,
});

/**
 * Port pool configuration per organization
 * Controls allocation strategy and thresholds
 */
export const portPoolConfig = pgTable("port_pool_config", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),

  // Pool bounds
  poolStart: integer("pool_start").default(10000).notNull(),
  poolEnd: integer("pool_end").default(15000).notNull(),

  // Allocation strategy
  stickyAllocation: boolean("sticky_allocation").default(true).notNull(), // Reuse previous ports
  allowManualAssignment: boolean("allow_manual_assignment").default(false).notNull(),

  // Conflict handling
  autoResolveConflicts: boolean("auto_resolve_conflicts").default(true).notNull(),
  fallbackStrategy: varchar("fallback_strategy", { length: 50 }).default("next_available").notNull(), // 'error'|'next_available'

  // Monitoring
  alertOnPoolUsagePercent: integer("alert_on_pool_usage_percent").default(80).notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  orgUnq: uniqueIndex("port_pool_config_org_unq").on(table.orgId),
}));

export type PortPoolConfig = typeof portPoolConfig.$inferSelect;
export const insertPortPoolConfigSchema = createInsertSchema(portPoolConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
