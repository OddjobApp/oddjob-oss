import { pgTable, serial, integer, varchar, timestamp, jsonb, text, index } from "drizzle-orm/pg-core";
import { pipelineExecutions } from "./pipelines/pipeline-execution.js";
import { jobs } from "./jobs/table.js";

export const cycleRunEvents = pgTable("cycle_run_events", {
    id: serial("id").primaryKey(),
    /**
     * A pipeline_executions.id.
     *
     * This referenced operational_cycles until migration 0103, which is not
     * what either writer has ever put here: both inserts in
     * server/core/pipeline-step-runner.ts pass pipelineExecutionId. The two id
     * spaces overlap, so most rows satisfied the old constraint by coincidence
     * and were filed under an unrelated cycle, while executions numbered above
     * the highest cycle id failed the constraint outright and logged nothing.
     */
    runId: integer("run_id").notNull().references(() => pipelineExecutions.id, { onDelete: "cascade" }),
    stepCode: varchar("step_code", { length: 50 }).notNull(),
    eventType: varchar("event_type", { length: 50 }).notNull(), // e.g., STEP_STARTED, STEP_COMPLETED, STEP_FAILED
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    jobId: integer("job_id").references(() => jobs.id),
    agentId: varchar("agent_id", { length: 100 }), // The agent persona/ID, if applicable
    inputs: jsonb("inputs"),
    outputs: jsonb("outputs"),
    error: text("error"),
    durationMs: integer("duration_ms"),
}, (table) => ({
    cycleCreatedIdx: index("idx_cycle_run_events_run_timestamp").on(table.runId, table.timestamp),
}));
