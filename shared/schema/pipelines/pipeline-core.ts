import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    boolean,
    timestamp,
    integer,
    jsonb,
    decimal,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs, users } from '../auth.js';
import { governorPolicies } from '../governor.js';
import { pipelineKnowledgeGraphConfigSchema } from '../knowledge-config.js';

export const pipelineTriggerTypes = ["manual", "schedule", "webhook", "event"] as const;
export type PipelineTriggerType = (typeof pipelineTriggerTypes)[number];

export const pipelines = pgTable("pipelines", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    triggerType: text("trigger_type").notNull(), // One of pipelineTriggerTypes
    triggerCredentialId: integer("trigger_credential_id"), // For secured webhooks
    labels: jsonb("labels"),
    isActive: boolean("is_active").default(true),
    organizationId: integer("organization_id").references(() => orgs.id),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    currentVersion: integer("current_version").default(1),
    monthlyBudgetUsd: decimal("monthly_budget_usd", { precision: 10, scale: 2 }),
    // Knowledge Graph Integration
    enableKnowledgeGraph: boolean("enable_knowledge_graph").default(false).notNull(),
    knowledgeGraphConfig: jsonb("knowledge_graph_config"), // PipelineKnowledgeGraphConfig

    // Lifecycle Management
    lifecycleStatus: text("lifecycle_status").default("active").notNull(), // 'active', 'draft', 'archived'
    // Governance
    governorSettings: jsonb("governor_settings"), // { enabled: boolean, mode: 'ADVISORY' | 'AUTONOMOUS' }
    governorPolicyId: integer("governor_policy_id").references(() => governorPolicies.id),
    
    // Reactive Intelligence: Gold Baselines & Self-Healing
    baselineRunId: integer("baseline_run_id"),
    baselineOutput: jsonb("baseline_output"),
    selfHealingEnabled: boolean("self_healing_enabled").default(false).notNull(),
}, (table) => ({
    orgNameUnique: uniqueIndex("pipelines_org_name_unique").on(table.organizationId, table.name),
    governorPolicyIdx: index("pipelines_governor_policy_idx").on(table.governorPolicyId),
}));

export const insertPipelineSchema = createInsertSchema(pipelines, {
    name: z.string().min(1, "Name is required"),
    triggerType: z.enum(pipelineTriggerTypes),
    labels: z.any().optional(),
    enableKnowledgeGraph: z.boolean().optional(),
    knowledgeGraphConfig: pipelineKnowledgeGraphConfigSchema.optional(),
    lifecycleStatus: z.enum(['active', 'draft', 'archived']).optional().default('active'),
}).omit({
    id: true,
    createdAt: true,
} as const);

export const updatePipelineSchema = insertPipelineSchema.partial().extend({
    steps: z.any().optional(), // Will be imported from pipeline-steps
});

export type InsertPipeline = z.infer<typeof insertPipelineSchema>;
export type UpdatePipeline = z.infer<typeof updatePipelineSchema>;
export type Pipeline = typeof pipelines.$inferSelect;

// ============================================================================
// PIPELINE VERSIONS TABLE
// ============================================================================

export const pipelineVersions = pgTable("pipeline_versions", {
    id: serial("id").primaryKey(),
    pipelineId: integer("pipeline_id")
        .references(() => pipelines.id, { onDelete: "cascade" })
        .notNull(),
    versionNumber: integer("version_number").notNull(),
    snapshot: jsonb("snapshot").notNull(), // Stores: { pipeline: {...}, steps: [...] }
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: text("created_by").references(() => users.id),
});

export type PipelineVersion = typeof pipelineVersions.$inferSelect;
export type InsertPipelineVersion = typeof pipelineVersions.$inferInsert;


