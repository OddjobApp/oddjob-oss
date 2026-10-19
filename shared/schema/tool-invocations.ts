import { pgTable, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from './auth.js';

export const toolInvocations = pgTable("tool_invocations", {
  id: text("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  jobType: text("job_type").notNull(),
  toolName: text("tool_name").notNull(),
  organizationId: integer("organization_id").references(() => orgs.id),
  agentId: text("agent_id"),
  missionId: integer("mission_id"),
  pipelineId: integer("pipeline_id"),
  userId: integer("user_id"),
  source: text("source").notNull().default("agent"),
  success: boolean("success").notNull().default(true),
  errorType: text("error_type"),
  executionTimeMs: integer("execution_time_ms").notNull().default(0),
  inputSize: integer("input_size").notNull().default(0),
  outputSize: integer("output_size").notNull().default(0),
  invokedAt: timestamp("invoked_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_tool_invocations_job").on(table.jobId),
  index("idx_tool_invocations_org").on(table.organizationId),
  index("idx_tool_invocations_invoked_at").on(table.invokedAt),
  index("idx_tool_invocations_tool_name").on(table.toolName),
]);

export type ToolInvocationRecord = typeof toolInvocations.$inferSelect;


