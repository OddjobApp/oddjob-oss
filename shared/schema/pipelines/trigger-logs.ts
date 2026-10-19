import {
    pgTable,
    text,
    serial,
    boolean,
    timestamp,
    integer,
    jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { pipelines } from './pipeline-core.js';
import { pipelineTriggers } from './pipeline-triggers.js';
import { pipelineExecutions } from './pipeline-execution.js';
import { orgs } from '../auth.js';

export const pipelineTriggerLogs = pgTable("pipeline_trigger_logs", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id),
    pipelineId: integer("pipeline_id").references(() => pipelines.id, { onDelete: "cascade" }),
    triggerId: integer("trigger_id").references(() => pipelineTriggers.id, { onDelete: "set null" }),
    eventId: text("event_id"), // Optional: correlate with event_log
    
    eventType: text("event_type").notNull(),
    eventPayload: jsonb("event_payload"),
    
    evaluationResult: boolean("evaluation_result").notNull(),
    filterCondition: text("filter_condition"),
    
    outcome: text("outcome").notNull(), // 'executed', 'filtered', 'debouncing', 'error', 'skipped'
    executionId: integer("execution_id").references(() => pipelineExecutions.id),
    errorMessage: text("error_message"),
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPipelineTriggerLogSchema = createInsertSchema(pipelineTriggerLogs);
export type PipelineTriggerLog = typeof pipelineTriggerLogs.$inferSelect;
export type InsertPipelineTriggerLog = z.infer<typeof insertPipelineTriggerLogSchema>;


