import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const workerHeartbeats = pgTable("worker_heartbeats", {
    id: serial("id").primaryKey(),
    workerId: text("worker_id").notNull().unique(),
    workerType: text("worker_type").notNull(),
    queueName: text("queue_name").notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    jobsProcessed: integer("jobs_processed").notNull().default(0),
    jobsFailed: integer("jobs_failed").notNull().default(0),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").default({}),
}, (t) => ({
    typeIdx: index("idx_worker_heartbeats_type").on(t.workerType),
    lastSeenIdx: index("idx_worker_heartbeats_last_seen").on(t.lastSeen),
}));

export const deadLetterJobs = pgTable("dead_letter_jobs", {
    id: serial("id").primaryKey(),
    queueName: text("queue_name").notNull(),
    jobName: text("job_name").notNull(),
    jobData: jsonb("job_data"),
    failedAt: timestamp("failed_at", { withTimezone: true }).notNull().defaultNow(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    organizationId: integer("organization_id"),
    metadata: jsonb("metadata").default({}),
}, (t) => ({
    queueIdx: index("idx_dlq_queue").on(t.queueName),
    failedAtIdx: index("idx_dlq_failed_at").on(t.failedAt),
    resolvedIdx: index("idx_dlq_resolved").on(t.resolvedAt),
}));


