import {
    pgTable,
    serial,
    text,
    varchar,
    timestamp,
    jsonb,
    boolean,
    uniqueIndex,
    integer,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';

/**
 * BLUEPRINT REGISTRY
 * 
 * Formalizes application templates into the database.
 * Replaces existing filesystem-based templates for better versioning and multi-tenancy.
 */
export const blueprints = pgTable("blueprints", {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 120 }).notNull().unique(), // e.g. "spa", "analytics-dashboard"
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    version: varchar("version", { length: 20 }).default("1.0.0").notNull(),
    
    // Core Template Data
    basePath: text("base_path"), // Original filesystem path (for migration period)
    manifest: jsonb("manifest").default({}).notNull(), // Blueprint manifest (files, dependencies, scripts)
    configSchema: jsonb("config_schema").default({}).notNull(), // JSON Schema for app configuration
    
    // Capabilities
    isPublic: boolean("is_public").default(true).notNull(),
    /**
     * The same three shelves as apps: a platform "standard" template, an org's own
     * "custom" one, or one "listed" for demo and purchase.
     *
     * Blueprints had no ownership at all — every row is global — so a blueprint
     * someone authored to sell had nowhere to live. `developerOrgId` is null for the
     * platform's own templates, which is what every existing row is.
     */
    distribution: varchar("distribution", { length: 20 }).default("standard").notNull(),
    developerOrgId: integer("developer_org_id").references(() => orgs.id, { onDelete: "set null" }),
    category: varchar("category", { length: 50 }).default("web_app").notNull(), // "web_app", "mobile_app", "agent", "worker"
    tags: text("tags").array().default([]).notNull(),
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    slugUnq: uniqueIndex("blueprint_slug_unq").on(table.slug),
}));

export const insertBlueprintSchema = createInsertSchema(blueprints);
export const selectBlueprintSchema = createSelectSchema(blueprints);
export type Blueprint = typeof blueprints.$inferSelect;
export type InsertBlueprint = typeof blueprints.$inferInsert;

// ============================================================================
// BLUEPRINT TEMPLATES (Template Management)
// ============================================================================

export const blueprintTemplates = pgTable("blueprint_templates", {
    id: serial("id").primaryKey(),
    blueprintId: integer("blueprint_id")
        .notNull()
        .references(() => blueprints.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),

    // Template Identity
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    templateVersion: varchar("template_version", { length: 20 }).default("1.0.0").notNull(),

    // Template Configuration
    templateConfig: jsonb("template_config"), // Configuration for this template instance
    parameterSchema: jsonb("parameter_schema"), // JSON Schema for template parameters
    variables: jsonb("variables").default({}).notNull(), // Default variables/values

    // Status and Metadata
    isActive: boolean("is_active").default(true).notNull(),
    isPublic: boolean("is_public").default(false).notNull(),
    tags: text("tags").array().default([]).notNull(),

    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    blueprintIdIdx: index("blueprint_templates_blueprint_id_idx").on(table.blueprintId),
    orgIdIdx: index("blueprint_templates_org_id_idx").on(table.organizationId),
    nameUnique: uniqueIndex("blueprint_templates_org_name_unique").on(
        table.organizationId,
        table.name
    ),
}));

export type BlueprintTemplate = typeof blueprintTemplates.$inferSelect;
export type InsertBlueprintTemplate = typeof blueprintTemplates.$inferInsert;

// ============================================================================
// TEMPLATE EXECUTIONS (Template Execution Tracking)
// ============================================================================

export const templateExecutions = pgTable("template_executions", {
    id: serial("id").primaryKey(),
    blueprintTemplateId: integer("blueprint_template_id")
        .notNull()
        .references(() => blueprintTemplates.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),

    // Execution Identity
    executionUuid: varchar("execution_uuid", { length: 36 }).notNull().unique(),
    executionName: varchar("execution_name", { length: 255 }).notNull(),

    // Workflow Integration
    pipelineExecutionId: integer("pipeline_execution_id"), // Links to pipeline_executions
    pipelineId: integer("pipeline_id"), // Direct pipeline reference

    // Execution Parameters and Results
    inputParameters: jsonb("input_parameters"),
    outputData: jsonb("output_data"),
    metadata: jsonb("metadata"),

    // Status and Timing
    status: varchar("status", { length: 20 }).notNull().default("pending"), // "pending", "running", "completed", "failed", "cancelled"
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    cancelledAt: timestamp("cancelled_at"),
    executionTimeMs: integer("execution_time_ms"),

    // Error Handling
    errorMessage: text("error_message"),
    errorStack: text("error_stack"),
    retryCount: integer("retry_count").default(0),

    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    templateIdIdx: index("template_executions_template_id_idx").on(table.blueprintTemplateId),
    orgIdIdx: index("template_executions_org_id_idx").on(table.organizationId),
    pipelineExecutionIdIdx: index("template_executions_pipeline_execution_id_idx").on(table.pipelineExecutionId),
    statusIdx: index("template_executions_status_idx").on(table.status),
    createdAtIdx: index("template_executions_created_at_idx").on(table.createdAt),
}));

export type TemplateExecution = typeof templateExecutions.$inferSelect;
export type InsertTemplateExecution = typeof templateExecutions.$inferInsert;

