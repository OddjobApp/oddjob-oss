
import { pgTable, serial, text, integer, jsonb, timestamp, varchar, real, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/**
 * Tool usage analytics table
 * Tracks every tool invocation by agents for performance analysis
 */
export const agentToolUsage = pgTable("agent_tool_usage", {
    id: serial("id").primaryKey(),
    agentRunId: integer("agent_run_id"), // Link to agent run if applicable
    executionId: integer("execution_id"), // Link to pipeline execution
    toolName: varchar("tool_name", { length: 255 }).notNull(),
    taskType: varchar("task_type", { length: 255 }), // e.g., "data_analysis", "web_scraping"
    taskDescription: text("task_description"),
    status: varchar("status", { length: 50 }).notNull(), // 'success', 'error', 'timeout'
    executionTimeMs: integer("execution_time_ms"),
    errorType: varchar("error_type", { length: 255 }),
    errorMessage: text("error_message"),
    inputParams: jsonb("input_params"),
    outputData: jsonb("output_data"),
    reasoning: text("reasoning"), // Why the agent chose this tool
    organizationId: integer("organization_id"),
    createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Tool examples for few-shot learning
 * Stores successful tool usage patterns to inject into agent prompts
 */
export const agentToolExamples = pgTable("agent_tool_examples", {
    id: serial("id").primaryKey(),
    toolName: varchar("tool_name", { length: 255 }).notNull(),
    taskType: varchar("task_type", { length: 255 }).notNull(),
    examplePrompt: text("example_prompt").notNull(),
    exampleOutput: text("example_output").notNull(),
    successScore: real("success_score").default(1.0).notNull(), // 0-1 quality score
    usageCount: integer("usage_count").default(0).notNull(), // How often this example is used
    createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentToolUsageSchema = createInsertSchema(agentToolUsage);
export const insertAgentToolExampleSchema = createInsertSchema(agentToolExamples);

export type AgentToolUsage = typeof agentToolUsage.$inferSelect;
export type InsertAgentToolUsage = typeof agentToolUsage.$inferInsert;
export type AgentToolExample = typeof agentToolExamples.$inferSelect;
export type InsertAgentToolExample = typeof agentToolExamples.$inferInsert;



