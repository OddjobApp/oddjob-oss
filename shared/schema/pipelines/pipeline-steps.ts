import {
    pgTable,
    text,
    serial,
    timestamp,
    integer,
    jsonb,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { pipelines } from './pipeline-core.js';
import { jobs } from '../jobs/table.js';

export const pipelineSteps = pgTable("pipeline_steps", {
    id: serial("id").primaryKey(),
    pipelineId: integer("pipeline_id")
        .notNull()
        .references(() => pipelines.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
        .references(() => jobs.id, { onDelete: "cascade" }),
    order: integer("order").notNull(), // Execution order (0-based)
    outputName: text("output_name"), // Optional name for this step's output
    // Harpy V3 Extensions
    runOnCondition: text("run_on_condition").default("on_success").notNull(), // on_success, on_failure, always
    waitDurationSeconds: integer("wait_duration_seconds").default(0),
    // Slice 22: Advanced Flow Control
    onFailureAction: text("on_failure_action").default("Stop Pipeline").notNull(), // Stop Pipeline, Continue to Next, Execute Fallback Job
    fallbackJobId: integer("fallback_job_id").references(() => jobs.id, { onDelete: "set null" }), // Job to run when onFailureAction === "Execute Fallback Job"
    parallelGroup: text("parallel_group"), // Optional parallel group identifier
    // Custom Expression Evaluator
    conditionExpression: text("condition_expression"), // Optional custom condition expression (e.g., "{{step.0.output}} == 'success'")
    // Decision Node & Loopbane Protocols
    moduleType: text("module_type"), // "logic_gatekeeper" for Decision Nodes, null for regular steps
    destinationStepId: integer("destination_step_id"), // Explicit routing target (nullable)
    decisionNodeConfig: jsonb("decision_node_config"), // Stores CEL conditions, routes, safety policies
    knowledgeGraphConfig: jsonb("knowledge_graph_config"), // Explicit rules for entity extraction
    // Auto-Retry Configuration
    retryConfig: jsonb("retry_config"), // { maxRetries: number, backoffMs: number, backoffMultiplier: number, retryOnCategories: string[] }
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    // Data Contracts
    expectedInputSchema: jsonb("expected_input_schema"),
    guaranteedOutputSchema: jsonb("guaranteed_output_schema"),
    // Multi-Input/Output Mapping
    // inputMapping: jsonb("input_mapping"), // Explicit mapping: { "jobParam": "step.N.output" }

    // Direct Tool Execution
    toolName: text("tool_name"),
    toolArguments: jsonb("tool_arguments"),

    // JIT Asset Forging
    forgeConfig: jsonb("forge_config"), // { blueprint: string, name: string, slug: string, description: string }
}, (table) => ({
    pipelineIdIdx: index("pipeline_steps_pipeline_id_idx").on(table.pipelineId),
    jobIdIdx: index("pipeline_steps_job_id_idx").on(table.jobId),
    fallbackJobIdIdx: index("pipeline_steps_fallback_job_id_idx").on(table.fallbackJobId),
}));


// Retry Configuration Schema
export const retryConfigSchema = z.object({
    maxRetries: z.number().int().min(1).max(10).default(3),
    backoffMs: z.number().int().min(100).max(300000).default(5000), // 100ms to 5 min
    backoffMultiplier: z.number().min(1).max(5).default(2),
    retryOnCategories: z.array(z.enum([
        'auth',
        'rate_limit',
        'server_error',
        'network',
        'timeout',
    ])).default(['rate_limit', 'server_error', 'timeout']),
});

export type RetryConfig = z.infer<typeof retryConfigSchema>;

export const insertPipelineStepSchema = createInsertSchema(pipelineSteps, {
    pipelineId: z.number().int().positive(),
    jobId: z.number().int().positive(),
    order: z.number().int().min(0),
    outputName: z.string().min(1).optional(),
    runOnCondition: z.enum(["on_success", "on_failure", "always"]).optional(),
    waitDurationSeconds: z.number().int().min(0).optional(),
    onFailureAction: z.enum(["Stop Pipeline", "Continue to Next", "Execute Fallback Job"]).optional(),
    fallbackJobId: z.number().int().positive().optional().nullable(),
    parallelGroup: z.string().optional(),
    conditionExpression: z.string().optional(),
    moduleType: z.string().optional(),
    destinationStepId: z.number().int().positive().optional().nullable(),
    knowledgeGraphConfig: z.any().optional(),
    retryConfig: retryConfigSchema.optional(),
    toolName: z.string().optional(),
    toolArguments: z.record(z.any()).optional(),
    forgeConfig: z.object({
        blueprint: z.string().optional(),
        name: z.string().optional(),
        slug: z.string().optional(),
        description: z.string().optional(),
    }).optional(),

    // inputMapping: z.record(z.string()).optional(),
}).omit({

    id: true,
    createdAt: true,
} as const);

export const updatePipelineStepSchema = insertPipelineStepSchema.partial();

export const pipelineStepUpdateDataSchema = insertPipelineStepSchema
    .pick({ jobId: true, order: true, outputName: true, runOnCondition: true, waitDurationSeconds: true })
    .extend({
        outputName: z.string().min(1).nullish(), // Allow null, undefined, or string
    });

export type InsertPipelineStep = z.infer<typeof insertPipelineStepSchema>;
export type UpdatePipelineStep = z.infer<typeof updatePipelineStepSchema>;
export type PipelineStepUpdateData = z.infer<typeof pipelineStepUpdateDataSchema>;
export type PipelineStep = typeof pipelineSteps.$inferSelect;


