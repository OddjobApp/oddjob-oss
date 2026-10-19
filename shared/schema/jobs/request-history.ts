/**
 * Job Request History Schema
 * Stores request/response history for replay and debugging
 */

import { pgTable, serial, integer, timestamp, jsonb, text, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";

export const jobRequestHistory = pgTable("job_request_history", {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    organizationId: integer("organization_id"),
    
    // Request details
    requestMethod: text("request_method"),
    requestUrl: text("request_url"),
    requestHeaders: jsonb("request_headers"),
    requestBody: jsonb("request_body"),
    requestParams: jsonb("request_params"),
    
    // Response details
    responseStatus: integer("response_status"),
    responseHeaders: jsonb("response_headers"),
    responseBody: jsonb("response_body"),
    responseTimeMs: integer("response_time_ms"),
    
    // Metadata
    triggeredBy: text("triggered_by").notNull().default("manual"), // manual, scheduled, pipeline, mission
    triggeredByUserId: integer("triggered_by_user_id"),
    executionContext: jsonb("execution_context"), // missionId, collectionId, etc.
    
    // Replay support
    isReplayable: integer("is_replayable").notNull().default(1),
    replayOfId: integer("replay_of_id"), // If this is a replay, link to original
    
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    
    // Indexing
}, (t) => ({
    jobIdIdx: index("job_history_job_id_idx").on(t.jobId),
    orgIdIdx: index("job_history_org_id_idx").on(t.organizationId),
    createdAtIdx: index("job_history_created_at_idx").on(t.createdAt),
}));

export const insertJobRequestHistorySchema = createInsertSchema(jobRequestHistory).omit({
    id: true,
    createdAt: true,
});

export type JobRequestHistory = typeof jobRequestHistory.$inferSelect;
export type InsertJobRequestHistory = z.infer<typeof insertJobRequestHistorySchema>;


