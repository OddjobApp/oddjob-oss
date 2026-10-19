/**
 * Pipeline Input Parameters Schema
 * 
 * Defines expected inputs for pipelines with validation rules (type, length, regex).
 * Used by agents and frontend to validate inputs before pipeline execution.
 */

import { pgTable, serial, integer, text, boolean, timestamp, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { pipelines } from './pipelines/pipeline-core.js';

// Supported data types for input parameters
export const inputParamDataTypes = [
    "string",
    "number",
    "boolean",
    "date",
    "email",
    "url",
    "phone",
    "vin",
    "location",
] as const;

export type InputParamDataType = (typeof inputParamDataTypes)[number];

/**
 * Pipeline Input Parameters Table
 * 
 * Each row defines one input parameter for a pipeline with its validation rules.
 */
export const pipelineInputParams = pgTable("pipeline_input_params", {
    id: serial("id").primaryKey(),
    pipelineId: integer("pipeline_id")
        .notNull()
        .references(() => pipelines.id, { onDelete: "cascade" }),

    // Parameter identification
    name: text("name").notNull(),           // Variable name (e.g., "vin", "customerId")
    label: text("label"),                   // Display label (e.g., "Vehicle Identification Number")
    description: text("description"),       // Help text for users/agents

    // Type and requirement
    dataType: text("data_type").notNull(),  // One of inputParamDataTypes
    isRequired: boolean("is_required").default(true).notNull(),
    defaultValue: text("default_value"),

    // String validation rules
    minLength: integer("min_length"),
    maxLength: integer("max_length"),
    pattern: text("pattern"),               // Regex pattern
    patternMessage: text("pattern_message"), // Custom error message for pattern failure

    // Number validation rules
    minValue: numeric("min_value", { precision: 20, scale: 6 }),
    maxValue: numeric("max_value", { precision: 20, scale: 6 }),

    // Enum validation
    allowedValues: jsonb("allowed_values"),  // Array of allowed values

    // Ordering
    displayOrder: integer("display_order").default(0).notNull(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Zod schemas for API validation
export const insertPipelineInputParamSchema = createInsertSchema(pipelineInputParams, {
    pipelineId: z.number().int().positive(),
    name: z.string().min(1, "Name is required").regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Name must start with a letter and contain only letters, numbers, and underscores"),
    label: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    dataType: z.enum(inputParamDataTypes),
    isRequired: z.boolean().optional().default(true),
    defaultValue: z.string().optional().nullable(),
    minLength: z.number().int().min(0).optional().nullable(),
    maxLength: z.number().int().min(1).optional().nullable(),
    pattern: z.string().optional().nullable(),
    patternMessage: z.string().optional().nullable(),
    minValue: z.string().optional().nullable(),
    maxValue: z.string().optional().nullable(),
    allowedValues: z.array(z.union([z.string(), z.number()])).optional().nullable(),
    displayOrder: z.number().int().optional(),
});

export const updatePipelineInputParamSchema = insertPipelineInputParamSchema.partial().omit({
    pipelineId: true, // Can't change pipeline association
});

// Types
export type PipelineInputParam = typeof pipelineInputParams.$inferSelect;
export type InsertPipelineInputParam = z.infer<typeof insertPipelineInputParamSchema>;
export type UpdatePipelineInputParam = z.infer<typeof updatePipelineInputParamSchema>;

/**
 * Validation result type
 */
export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
}

export interface ValidationError {
    field: string;
    message: string;
    value?: any;
    constraint?: string;
}

/**
 * Input schema for agent prompt generation
 */
export interface InputParamForAgent {
    name: string;
    label: string;
    description: string | null;
    dataType: InputParamDataType;
    isRequired: boolean;
    constraints: {
        minLength?: number;
        maxLength?: number;
        pattern?: string;
        patternMessage?: string;
        minValue?: number;
        maxValue?: number;
        allowedValues?: (string | number)[];
    };
}



