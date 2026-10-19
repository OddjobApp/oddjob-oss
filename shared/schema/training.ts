import { pgTable, text, integer, timestamp, serial, jsonb, real } from "drizzle-orm/pg-core";
import { orgs } from './auth.js';
import { jobs } from './jobs/table.js';
import { pipelineExecutions } from './pipelines/pipeline-execution.js';
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// ============================================================================
// TRAINING DATASETS (Containers for examples)
// ============================================================================

export const fineTuningDatasets = pgTable("fine_tuning_datasets", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // e.g., "JIRA Resolution V1"
    description: text("description"),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertFineTuningDatasetSchema = createInsertSchema(fineTuningDatasets, {
    name: z.string().min(1, "Name is required"),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export type FineTuningDataset = typeof fineTuningDatasets.$inferSelect;
export type InsertFineTuningDataset = typeof fineTuningDatasets.$inferInsert;

// ============================================================================
// TRAINING EXAMPLES (Golden Records)
// ============================================================================

export const fineTuningExamples = pgTable("fine_tuning_examples", {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id")
        .notNull()
        .references(() => fineTuningDatasets.id, { onDelete: "cascade" }),

    // The "Prompt" (Input)
    input: text("input").notNull(), // JSON or Text representation of the issue
    inputContext: jsonb("input_context"), // Metadata: { jiraId: "KAN-1", type: "Bug" }

    // The "Completion" (Output)
    output: text("output").notNull(), // The Verified Solution

    // Quality Metrics
    humanConfidence: integer("human_confidence").default(0), // 0-100 recommended, or 1-5
    originalAiConfidence: integer("original_ai_confidence"), // If available from AI response

    // Lineage
    sourceJobId: integer("source_job_id").references(() => jobs.id, { onDelete: "set null" }),
    sourcePipelineExecutionId: integer("source_pipeline_execution_id").references(() => pipelineExecutions.id, { onDelete: "set null" }),

    tags: text("tags").array().default(sql`ARRAY[]::text[]`),

    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFineTuningExampleSchema = createInsertSchema(fineTuningExamples, {
    humanConfidence: z.number().int().min(0).max(100).optional(),
    tags: z.array(z.string()).optional(),
}).omit({
    id: true,
    createdAt: true,
});

export type FineTuningExample = typeof fineTuningExamples.$inferSelect;
export type InsertFineTuningExample = typeof fineTuningExamples.$inferInsert;

// ============================================================================
// TRAINING PREFERENCES (RLAIF / DPO)
// ============================================================================

export const fineTuningPreferences = pgTable("fine_tuning_preferences", {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id")
        .notNull()
        .references(() => fineTuningDatasets.id, { onDelete: "cascade" }),

    // The Prompt (Question/Predicate)
    prompt: text("prompt").notNull(),
    
    // The Verified Ground Truth / Chosen Output
    chosenResponse: text("chosen_response").notNull(),
    
    // The Flawed / Rejected Output
    rejectedResponse: text("rejected_response").notNull(),

    // Quality Metrics
    humanConfidence: integer("human_confidence").default(0), 

    // Lineage
    sourceJobId: integer("source_job_id").references(() => jobs.id, { onDelete: "set null" }),
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFineTuningPreferenceSchema = createInsertSchema(fineTuningPreferences, {
    humanConfidence: z.number().int().min(0).max(100).optional(),
}).omit({
    id: true,
    createdAt: true,
});

export type FineTuningPreference = typeof fineTuningPreferences.$inferSelect;
export type InsertFineTuningPreference = typeof fineTuningPreferences.$inferInsert;

// ============================================================================
// ROUTING TELEMETRY (Student vs. Teacher routing tracking)
// ============================================================================

export const routingTelemetry = pgTable("routing_telemetry", {
    id: serial("id").primaryKey(),
    missionRunId: integer("mission_run_id"),
    routingDecision: text("routing_decision").notNull(), // 'student' or 'teacher'
    entropy: real("entropy").notNull(),
    modelUsed: text("model_used").notNull(),
    costSavings: real("cost_savings").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRoutingTelemetrySchema = createInsertSchema(routingTelemetry).omit({
    id: true,
    createdAt: true,
});

export type RoutingTelemetry = typeof routingTelemetry.$inferSelect;
export type InsertRoutingTelemetry = typeof routingTelemetry.$inferInsert;


