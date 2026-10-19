
import { pgTable, text, integer, timestamp, serial, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { orgs } from './auth.js';
import { pipelineExecutions } from './pipelines/pipeline-execution.js';
import { knowledgeNodes } from './knowledge/graph.js';
import { missions } from './missions/core.js';
import { projects } from './projects.js';
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// ============================================================================
// GENERIC DATASETS (Structured Data Store)
// ============================================================================

export const datasets = pgTable("datasets", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    tags: text("tags").array().default(sql`ARRAY[]::text[]`),
    // Schema mapping for JSON flattening configuration
    schemaMapping: jsonb("schema_mapping"),
    // Validation Rules for Data Quality Gates
    validationRules: jsonb("validation_rules"),
    // Knowledge Graph Extraction Rules
    knowledgeConfig: jsonb("knowledge_config").default({}),
    // Mission & Cycle lineage links
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "set null" }),
    cycleId: integer("cycle_id"),
    // Namespacing column: dataset names are unique WITHIN a project, not within the
    // org, so two projects can each own a "Fleet Telemetry" dataset. This is a real
    // column rather than a project_resources lookup because Postgres cannot enforce
    // uniqueness across a junction — see PROJECT_SPACES_DESIGN §5.2/§5.3.
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    projectNameUnique: uniqueIndex("datasets_project_name_unique").on(table.projectId, table.name),
    missionIdx: index("idx_datasets_mission").on(table.missionId),
    cycleIdx: index("idx_datasets_cycle").on(table.cycleId),
    projectIdx: index("idx_datasets_project").on(table.projectId),
}));

// Zod Schema for Validation Rules
export const validationRuleSchema = z.object({
    type: z.enum(['regex', 'number_range', 'email', 'url', 'enum', 'custom', 'required']),
    params: z.any().optional(), // { min, max, pattern, values }
    severity: z.enum(['error', 'warning']).default('error'),
    message: z.string().optional(),
});

export const datasetValidationRulesSchema = z.record(z.string(), z.array(validationRuleSchema)); // column -> rules
export type DatasetValidationRules = z.infer<typeof datasetValidationRulesSchema>;
export type ValidationRule = z.infer<typeof validationRuleSchema>;

export const insertDatasetSchema = createInsertSchema(datasets, {
    name: z.string().min(1, "Name is required"),
    tags: z.array(z.string()).optional(),
    validationRules: datasetValidationRulesSchema.optional(),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export type Dataset = typeof datasets.$inferSelect;
export type InsertDataset = typeof datasets.$inferInsert;

// ============================================================================
// DATASET ITEMS (Rows/Records)
// ============================================================================

export const datasetItems = pgTable("dataset_items", {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id")
        .notNull()
        .references(() => datasets.id, { onDelete: "cascade" }),

    // Flattened data content (dot-notation columns)
    data: jsonb("data").notNull(),
    // Original unflattened JSON for debugging/re-processing
    rawData: jsonb("raw_data"),

    // Lineage: Link to the Pipeline Run that created this item
    pipelineExecutionId: integer("pipeline_execution_id")
        .references(() => pipelineExecutions.id, { onDelete: "set null" }),
    // Semantic Fact Link: Link to the Knowledge Graph node representing this item's semantic data
    knowledgeNodeId: integer("knowledge_node_id")
        .references(() => knowledgeNodes.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDatasetItemSchema = createInsertSchema(datasetItems).omit({
    id: true,
    createdAt: true,
});

export type DatasetItem = typeof datasetItems.$inferSelect;
export type InsertDatasetItem = typeof datasetItems.$inferInsert;



