/**
 * Job Streaming Logs Schema
 * Real-time log storage for live output streaming
 */

import { pgTable, serial, integer, timestamp, text, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";

export const jobStreamingLogs = pgTable("job_streaming_logs", {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    jobRunId: integer("job_run_id").notNull(), // Specific execution instance
    organizationId: integer("organization_id"),
    
    // Log content
    logLevel: text("log_level").notNull().default("info"), // debug, info, warn, error
    logType: text("log_type").notNull().default("stdout"), // stdout, stderr, system, ai_response
    message: text("message").notNull(),
    
    // Chunk tracking for streaming
    chunkIndex: integer("chunk_index").notNull().default(0),
    isFinalChunk: integer("is_final_chunk").notNull().default(0),
    
    // Metadata
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    source: text("source"), // component that generated the log
    
}, (t) => ({
    jobRunIdx: index("streaming_logs_job_run_idx").on(t.jobId, t.jobRunId),
    timestampIdx: index("streaming_logs_timestamp_idx").on(t.timestamp),
    orgIdx: index("streaming_logs_org_idx").on(t.organizationId),
}));

// Active job runs for quick lookup
export const jobActiveRuns = pgTable("job_active_runs", {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    jobRunId: integer("job_run_id").notNull(),
    organizationId: integer("organization_id"),
    
    // Status
    status: text("status").notNull().default("running"), // running, completed, failed, cancelled
    startedAt: timestamp("started_at").defaultNow().notNull(),
    
    // Streaming endpoint
    sseChannelId: text("sse_channel_id"), // For SSE streaming
    
    // Context
    triggeredBy: text("triggered_by").default("manual"),
    context: text("context"), // JSON with missionId, collectionId, etc.
    
}, (t) => ({
    jobIdIdx: index("active_runs_job_id_idx").on(t.jobId),
    statusIdx: index("active_runs_status_idx").on(t.status),
    sseIdx: index("active_runs_sse_idx").on(t.sseChannelId),
}));

export const insertJobStreamingLogsSchema = createInsertSchema(jobStreamingLogs).omit({
    id: true,
    timestamp: true,
});

export const insertJobActiveRunsSchema = createInsertSchema(jobActiveRuns).omit({
    id: true,
    startedAt: true,
});

export type JobStreamingLogs = typeof jobStreamingLogs.$inferSelect;
export type InsertJobStreamingLogs = z.infer<typeof insertJobStreamingLogsSchema>;
export type JobActiveRuns = typeof jobActiveRuns.$inferSelect;
export type InsertJobActiveRuns = z.infer<typeof insertJobActiveRunsSchema>;


