/**
 * AI Token Tracking Schema
 * Tracks token usage and costs for AI jobs
 */

import { pgTable, serial, integer, timestamp, jsonb, text, real, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";

export const aiTokenUsage = pgTable("ai_token_usage", {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    jobRunId: integer("job_run_id"), // Link to specific execution
    organizationId: integer("organization_id"),
    
    // Model info
    modelProvider: text("model_provider").notNull(), // openai, gemini, anthropic, etc.
    modelName: text("model_name").notNull(), // gpt-4, gemini-pro, etc.
    
    // Token counts
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    
    // Cost calculation (in cents/USD)
    inputCost: real("input_cost").notNull().default(0),
    outputCost: real("output_cost").notNull().default(0),
    totalCost: real("total_cost").notNull().default(0),
    
    // Request metadata
    requestTimestamp: timestamp("request_timestamp").defaultNow().notNull(),
    latencyMs: integer("latency_ms"),
    
    // Context for analysis
    promptType: text("prompt_type"), // system, user, function_calling, etc.
    promptCategory: text("prompt_category"), // extraction, generation, classification, etc.
    
    // Additional metadata
    metadata: jsonb("metadata"), // Temperature, max_tokens, etc.
    
}, (t) => ({
    jobIdIdx: index("token_usage_job_id_idx").on(t.jobId),
    orgIdIdx: index("token_usage_org_id_idx").on(t.organizationId),
    timestampIdx: index("token_usage_timestamp_idx").on(t.requestTimestamp),
    modelIdx: index("token_usage_model_idx").on(t.modelName),
}));

// Daily aggregation for dashboards
export const aiTokenDailyAggregation = pgTable("ai_token_daily_aggregation", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    date: timestamp("date").notNull(),
    
    // Aggregated stats
    totalRequests: integer("total_requests").notNull().default(0),
    totalInputTokens: integer("total_input_tokens").notNull().default(0),
    totalOutputTokens: integer("total_output_tokens").notNull().default(0),
    totalCost: real("total_cost").notNull().default(0),
    
    // Breakdown by model
    modelBreakdown: jsonb("model_breakdown"),
    jobBreakdown: jsonb("job_breakdown"), // Top jobs by cost
    
}, (t) => ({
    orgDateIdx: index("token_agg_org_date_idx").on(t.organizationId, t.date),
}));

export const insertAiTokenUsageSchema = createInsertSchema(aiTokenUsage).omit({
    id: true,
    requestTimestamp: true,
});

export const insertAiTokenDailyAggregationSchema = createInsertSchema(aiTokenDailyAggregation).omit({
    id: true,
});

export type AiTokenUsage = typeof aiTokenUsage.$inferSelect;
export type InsertAiTokenUsage = z.infer<typeof insertAiTokenUsageSchema>;
export type AiTokenDailyAggregation = typeof aiTokenDailyAggregation.$inferSelect;
export type InsertAiTokenDailyAggregation = z.infer<typeof insertAiTokenDailyAggregationSchema>;


