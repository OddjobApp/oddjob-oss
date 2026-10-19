/**
 * Pipeline Output Parameters Schema
 * 
 * Defines expected outputs for pipelines with metadata about their structure.
 * Used by agents and frontend to understand what a pipeline produced.
 */

import { pgTable, serial, integer, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { pipelines } from './pipelines/pipeline-core.js';

// Supported data types (consistent with inputs)
export const outputParamDataTypes = [
    "string",
    "number",
    "boolean",
    "date",
    "email",
    "url",
    "json",
    "array",
] as const;

export type OutputParamDataType = (typeof outputParamDataTypes)[number];

/**
 * Pipeline Output Parameters Table
 */
export const pipelineOutputParams = pgTable("pipeline_output_params", {
    id: serial("id").primaryKey(),
    pipelineId: integer("pipeline_id")
        .notNull()
        .references(() => pipelines.id, { onDelete: "cascade" }),

    // Parameter identification
    name: text("name").notNull(),           // Variable name
    label: text("label"),                   // Display label
    description: text("description"),       // Help text

    // Type and requirement
    dataType: text("data_type").notNull(),
    isRequired: boolean("is_required").default(false).notNull(),

    // Metadata for complex structures
    schemaDef: jsonb("schema_def"),          // JSON Schema or similar definition
    sampleValue: jsonb("sample_value"),      // Example output

    // Ordering
    displayOrder: integer("display_order").default(0).notNull(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Zod schemas for API validation
export const insertPipelineOutputParamSchema = createInsertSchema(pipelineOutputParams, {
    pipelineId: z.number().int().positive(),
    name: z.string().min(1, "Name is required").regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Name must start with a letter and contain only letters, numbers, and underscores"),
    label: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    dataType: z.enum(outputParamDataTypes),
    isRequired: z.boolean().optional().default(false),
    schemaDef: z.any().optional().nullable(),
    sampleValue: z.any().optional().nullable(),
    displayOrder: z.number().int().optional(),
});

export const updatePipelineOutputParamSchema = insertPipelineOutputParamSchema.partial().omit({
    pipelineId: true,
});

// Types
export type PipelineOutputParam = typeof pipelineOutputParams.$inferSelect;
export type InsertPipelineOutputParam = z.infer<typeof insertPipelineOutputParamSchema>;
export type UpdatePipelineOutputParam = z.infer<typeof updatePipelineOutputParamSchema>;



