import {
    pgTable,
    serial,
    integer,
    decimal,
    timestamp,
    text,
    varchar,
    jsonb,
    index,
    boolean,
} from "drizzle-orm/pg-core";
import { orgs } from '../auth.js';

// ============================================================================
// PERFORMANCE METRICS (Execution Performance Tracking)
// ============================================================================

export const performanceMetrics = pgTable("performance_metrics", {
    id: serial("id").primaryKey(),
    pipelineExecutionId: integer("pipeline_execution_id"),
    pipelineStepExecutionId: integer("pipeline_step_execution_id"),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),

    // Timing Metrics
    executionTimeMs: integer("execution_time_ms").notNull(),
    queueTimeMs: integer("queue_time_ms"),
    setupTimeMs: integer("setup_time_ms"),
    teardownTimeMs: integer("teardown_time_ms"),

    // Resource Metrics
    peakMemoryMb: decimal("peak_memory_mb", { precision: 10, scale: 2 }),
    cpuPercentage: decimal("cpu_percentage", { precision: 5, scale: 2 }),

    // Throughput Metrics
    inputRecordCount: integer("input_record_count"),
    outputRecordCount: integer("output_record_count"),
    recordsPerSecond: decimal("records_per_second", { precision: 15, scale: 2 }),

    // Data Quality
    droppedRecordCount: integer("dropped_record_count").default(0),
    errorRecordCount: integer("error_record_count").default(0),

    // Network Metrics
    bytesRead: integer("bytes_read"),
    bytesWritten: integer("bytes_written"),
    networkLatencyMs: decimal("network_latency_ms", { precision: 10, scale: 2 }),

    // Status and Metadata
    status: varchar("status", { length: 20 }).notNull(), // 'success', 'failure', 'timeout'
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    executionIdIdx: index("perf_metrics_execution_id_idx").on(table.pipelineExecutionId),
    stepExecutionIdIdx: index("perf_metrics_step_execution_id_idx").on(table.pipelineStepExecutionId),
    orgIdIdx: index("perf_metrics_org_id_idx").on(table.organizationId),
    createdAtIdx: index("perf_metrics_created_at_idx").on(table.createdAt),
}));

export type PerformanceMetric = typeof performanceMetrics.$inferSelect;
export type InsertPerformanceMetric = typeof performanceMetrics.$inferInsert;

// ============================================================================
// RATE LIMIT LOGS (Request Tracking & Rate Limiting)
// ============================================================================

export const rateLimitLogs = pgTable("rate_limit_logs", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),

    // Request Identity
    userId: text("user_id"),
    apiKeyId: integer("api_key_id"),
    endpointPath: text("endpoint_path").notNull(),
    httpMethod: varchar("http_method", { length: 10 }).notNull(),

    // Rate Limiting
    role: text("role"), // User role for role-based rate limiting
    requestCount: integer("request_count").default(1).notNull(),
    limitThreshold: integer("limit_threshold"),
    limitWindowSeconds: integer("limit_window_seconds"),
    limitExceeded: boolean("limit_exceeded").default(false),
    throttledDurationMs: integer("throttled_duration_ms"),

    // Response Details
    statusCode: integer("status_code"),
    responseTimeMs: integer("response_time_ms"),

    // Request/Response Size
    requestBodyBytes: integer("request_body_bytes"),
    responseBodyBytes: integer("response_body_bytes"),

    // Metadata
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    orgIdIdx: index("rate_limit_logs_org_id_idx").on(table.organizationId),
    userIdIdx: index("rate_limit_logs_user_id_idx").on(table.userId),
    apiKeyIdIdx: index("rate_limit_logs_api_key_id_idx").on(table.apiKeyId),
    endpointIdx: index("rate_limit_logs_endpoint_idx").on(table.endpointPath),
    createdAtIdx: index("rate_limit_logs_created_at_idx").on(table.createdAt),
    limitExceededIdx: index("rate_limit_logs_exceeded_idx").on(table.limitExceeded),
}));

export type RateLimitLog = typeof rateLimitLogs.$inferSelect;
export type InsertRateLimitLog = typeof rateLimitLogs.$inferInsert;
