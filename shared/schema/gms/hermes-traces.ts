import { pgTable, serial, text, jsonb, timestamp, integer, boolean, real, varchar } from "drizzle-orm/pg-core";
import { missions } from '../missions/core.js';
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * Hermes Trace Storage Schema
 * Captures structured reasoning traces from Hermes protocol executions
 * for neural verifier training and PMI analysis
 */

export const hermesTraces = pgTable("hermes_traces", {
  id: serial("id").primaryKey(),
  
  // Trace identification
  traceId: varchar("trace_id", { length: 64 }).notNull().unique(),
  missionId: integer("mission_id").references(() => missions.id),
  jobId: integer("job_id"),
  executionId: integer("execution_id"),
  agentId: varchar("agent_id", { length: 64 }),
  
  // Source context
  organizationId: integer("organization_id").notNull(),
  userId: varchar("user_id", { length: 64 }),
  
  // Trace content
  thoughtContent: text("thought_content").notNull(), // Full <thinking> content
  toolCalls: jsonb("tool_calls").notNull(), // Parsed <action> calls
  toolResults: jsonb("tool_results"), // <result> responses
  finalContent: text("final_content"), // Response content
  
  // Structured trace steps
  traceSteps: jsonb("trace_steps").notNull(), // Array of AgentStep
  
  // Embedding vector for similarity search (stored as array for pgvector)
  embedding: jsonb("embedding"), // Array of floats
  
  // Verification and outcome
  predictedOutcome: real("predicted_outcome"), // Verifier prediction 0-1
  actualOutcome: boolean("actual_outcome"), // Ground truth success/failure
  executionTime: integer("execution_time"), // Duration in ms
  tokenUsage: jsonb("token_usage"), // { total, prompt, completion, cost }
  
  // Metadata
  modelUsed: varchar("model_used", { length: 64 }),
  reasoningProtocol: varchar("reasoning_protocol", { length: 32 }).notNull().default("hermes_xml"),
  isShadowRun: boolean("is_shadow_run").notNull().default(false),
  shadowConfig: jsonb("shadow_config"), // If shadow: { nVariations, scenarioId }
  
  // Evolution tracking
  skillId: varchar("skill_id", { length: 64 }), // Links to GMS skill if applicable
  generation: integer("generation").default(0), // Evolution generation
  
  // Timestamps
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Zod schemas for type safety
export const insertHermesTraceSchema = createInsertSchema(hermesTraces);
export const selectHermesTraceSchema = createSelectSchema(hermesTraces);

export type HermesTrace = z.infer<typeof selectHermesTraceSchema>;
export type InsertHermesTrace = z.infer<typeof insertHermesTraceSchema>;

/**
 * Trace step structure (stored in traceSteps JSONB)
 */
export interface HermesTraceStep {
  stepIndex: number;
  type: "thinking" | "action" | "result" | "final";
  timestamp: string;
  content: string;
  metadata?: {
    toolName?: string;
    toolArgs?: Record<string, any>;
    toolResult?: any;
    latencyMs?: number;
  };
}

/**
 * Tool call structure (stored in toolCalls JSONB)
 */
export interface HermesToolCallRecord {
  name: string;
  arguments: Record<string, any>;
  timestamp: string;
  stepIndex: number;
}

/**
 * Token usage structure
 */
export interface TokenUsageRecord {
  totalTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  costEstimateUsd?: number;
}


