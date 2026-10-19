import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    varchar,
    serial,
    boolean,
    timestamp,
    integer,
    jsonb,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from '../auth.js';
import { knowledgeTopics } from '../knowledge-base.js';
import { datasets } from '../datasets.js';
import { governorPolicies } from '../governor.js';

import {
    jobTypes,
    jobTools,
} from './types.js';

import {
    aiApiCallConfigSchema,
    aiAgentConfigSchema,
    supervisorJobConfigSchema,
    rerankerConfigSchema,
    predictionInferenceConfigSchema,
    spatialRerankerConfigSchema,
} from './config-ai.js';

import {
    shellConfigSchema,
    pythonConfigSchema,
    nodeScriptConfigSchema,
    gitConfigSchema,
    fileOpsConfigSchema,
    seleniumConfigSchema,
    computerUseConfigSchema,
} from './config-automation.js';

import {
    confluenceSyncConfigSchema,
    jiraSyncConfigSchema,
    googleDriveSyncConfigSchema,
    transformerConfigSchema,
    folderImportConfigSchema,
    fileExportConfigSchema,
    fileWriterConfigSchema,
    sqlQueryConfigSchema,
    statementIngestConfigSchema,
    dmsEvaluateConfigSchema,
    cashDragScanConfigSchema,
    subscriptionScanConfigSchema,
    balanceLockConfigSchema,
    amortizeSimConfigSchema,
} from './config-data.js';

import {
    curlConfigSchema,
    openApiJobConfigSchema,
    airflowDagRunConfigSchema,
    slackPostConfigSchema,
    emailSendConfigSchema,
} from './config-integration.js';

import {
    repeaterConfigSchema,
    iteratorConfigSchema,
    decisionConfigSchema,
    staticResponseConfigSchema,
    humanApprovalConfigSchema,
    formAgentConfigSchema,
    dispatcherConfigSchema,
} from './config-flow.js';

import {
    scribePublishConfigSchema,
    mediaTakeConfigSchema,
} from './config-studio.js';

// ============================================================================
// AGGREGATE JOB CONFIGURATION
// ============================================================================

export const jobConfigSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("shell"), config: shellConfigSchema }),
    z.object({ type: z.literal("api"), config: curlConfigSchema }), // DEPRECATED: Use "curl" instead
    z.object({ type: z.literal("curl"), config: curlConfigSchema }),
    z.object({ type: z.literal("python"), config: pythonConfigSchema }),
    z.object({ type: z.literal("ai_api_call"), config: aiApiCallConfigSchema }),
    z.object({ type: z.literal("repeater"), config: repeaterConfigSchema }),
    z.object({ type: z.literal("transformer"), config: transformerConfigSchema }),
    z.object({ type: z.literal("openapi"), config: openApiJobConfigSchema }),
    z.object({ type: z.literal("airflow_dag_run"), config: airflowDagRunConfigSchema }),
    z.object({ type: z.literal("slack_post"), config: slackPostConfigSchema }),
    z.object({ type: z.literal("email_send"), config: emailSendConfigSchema }),
    z.object({ type: z.literal("sql_query"), config: sqlQueryConfigSchema }),
    z.object({ type: z.literal("ai_agent"), config: aiAgentConfigSchema }),
    z.object({ type: z.literal("agent_ai"), config: aiAgentConfigSchema }),
    z.object({ type: z.literal("human_approval"), config: humanApprovalConfigSchema }),
    z.object({ type: z.literal("decision"), config: decisionConfigSchema }),
    z.object({ type: z.literal("iterator"), config: iteratorConfigSchema }),
    z.object({ type: z.literal("folder_import"), config: folderImportConfigSchema }),
    z.object({ type: z.literal("file_export"), config: fileExportConfigSchema }),
    z.object({ type: z.literal("selenium"), config: seleniumConfigSchema }),
    z.object({ type: z.literal("computer_use"), config: computerUseConfigSchema }),
    z.object({ type: z.literal("node_script"), config: nodeScriptConfigSchema }),
    z.object({ type: z.literal("git_op"), config: gitConfigSchema }),
    z.object({ type: z.literal("file_writer"), config: fileWriterConfigSchema }),
    z.object({ type: z.literal("file_ops"), config: fileOpsConfigSchema }),
    z.object({ type: z.literal("confluence_sync"), config: confluenceSyncConfigSchema }),
    z.object({ type: z.literal("jira_sync"), config: jiraSyncConfigSchema }),
    z.object({ type: z.literal("google_drive_sync"), config: googleDriveSyncConfigSchema }),
    z.object({ type: z.literal("static_response"), config: staticResponseConfigSchema }),
    z.object({ type: z.literal("supervisor"), config: supervisorJobConfigSchema }),
    z.object({ type: z.literal("form_agent"), config: formAgentConfigSchema }),
    z.object({ type: z.literal("reranker"), config: rerankerConfigSchema }),
    z.object({ type: z.literal("prediction_inference"), config: predictionInferenceConfigSchema }),
    z.object({ type: z.literal("spatial_reranker"), config: spatialRerankerConfigSchema }),
    z.object({ type: z.literal("dispatcher"), config: dispatcherConfigSchema }),
    // BudgetMaster (SAWM) finance engine
    z.object({ type: z.literal("statement_ingest"), config: statementIngestConfigSchema }),
    z.object({ type: z.literal("dms_evaluate"), config: dmsEvaluateConfigSchema }),
    z.object({ type: z.literal("cash_drag_scan"), config: cashDragScanConfigSchema }),
    z.object({ type: z.literal("subscription_scan"), config: subscriptionScanConfigSchema }),
    z.object({ type: z.literal("balance_lock"), config: balanceLockConfigSchema }),
    z.object({ type: z.literal("amortize_sim"), config: amortizeSimConfigSchema }),
    // Studio deliverables
    z.object({ type: z.literal("scribe_publish"), config: scribePublishConfigSchema }),
    z.object({ type: z.literal("media_take"), config: mediaTakeConfigSchema }),
]);

export type JobConfig = z.infer<typeof jobConfigSchema>;

// ============================================================================
// JOBS TABLE
// ============================================================================

export const jobDiffConfigSchema = z.object({
    enabled: z.boolean().default(false),
    mode: z.enum(["baseline", "latest"]).default("latest"),
    baselineSnapshotId: z.number().int().positive().optional().nullable(),
    ignorePaths: z.array(z.string()).default([]),
    threshold: z.number().min(0).max(1).optional(),
});

export type JobDiffConfig = z.infer<typeof jobDiffConfigSchema>;

export const jobs = pgTable("jobs", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").notNull(), // One of jobTypes
    isHidden: boolean("is_hidden").default(false), // For inline steps
    tool: text("tool").notNull().default("None"),
    config: jsonb("config").notNull(), // Type-specific configuration
    priority: integer("priority").default(2), // 1=high, 2=medium, 3=low
    isActive: boolean("is_active").default(true),
    // Lifecycle Management
    lifecycleStatus: text("lifecycle_status").default("active").notNull(), // 'active', 'draft', 'archived'
    // Harpy V3 Extensions
    parameterSchema: jsonb("parameter_schema"),
    renderTemplate: text("render_template"),
    cpuLimitMillicores: integer("cpu_limit_millicores"),
    memoryLimitMb: integer("memory_limit_mb"),
    organizationId: integer("organization_id").references(() => orgs.id),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    lastTestedAt: timestamp("last_tested_at"),
    lastTestStatus: text("last_test_status"), // "success" or "failure"
    // Output Storage Configuration
    outputStorageEnabled: boolean("output_storage_enabled").default(false).notNull(),
    enableKnowledgeStore: boolean("enable_knowledge_store").default(false).notNull(),
    outputKnowledgeTopicId: integer("output_knowledge_topic_id")
        .references(() => knowledgeTopics.id, { onDelete: "set null" }),
    outputDatasetId: integer("output_dataset_id")
        .references(() => datasets.id, { onDelete: "set null" }),
    outputTags: text("output_tags").array().default(sql`ARRAY[]::text[]`),
    outputStorageSettings: jsonb("output_storage_settings"),
    // Data Contract Schemas
    inputSchema: jsonb("input_schema"), // JobInputSchema
    outputSchema: jsonb("output_schema"), // JobOutputSchema
    // Test Configuration
    testConfig: jsonb("test_config"), // Persisted test parameters and default values
    diffConfig: jsonb("diff_config").default(sql`'{}'::jsonb`), // Reactive diff configuration
    // Governance
    governorSettings: jsonb("governor_settings"), // { enabled: boolean, mode: 'ADVISORY' | 'AUTONOMOUS' }
    governorPolicyId: integer("governor_policy_id").references(() => governorPolicies.id),
    // Privacy-aware model routing (Phase 4.5)
    // public: no restrictions | internal: prefer on-prem | sensitive: warn on cloud | restricted: local only
    dataClassification: text("data_classification").default("public").notNull(),
    // Autoresearch Benchmarking
    defaultTargetMetric: jsonb("default_target_metric"), // { type: 'latency', target: '500ms' }
    // Skill Evolution Linkage
    skillId: integer("skill_id"), // Reference to the source skill for autonomous evolution
}, (table) => ({
    orgIdIdx: index("jobs_org_id_idx").on(table.organizationId),
    outputDatasetIdIdx: index("jobs_output_dataset_id_idx").on(table.outputDatasetId),
    outputTopicIdIdx: index("jobs_output_topic_id_idx").on(table.outputKnowledgeTopicId),
    orgNameUnique: uniqueIndex("jobs_org_name_unique").on(table.organizationId, table.name),
    governorPolicyIdx: index("jobs_governor_policy_idx").on(table.governorPolicyId),
    dataClassificationIdx: index("jobs_data_classification_idx").on(table.organizationId, table.dataClassification),
    orgTypeIdx: index("idx_jobs_org_type").on(table.organizationId, table.type),
    orgTypeActiveIdx: index("idx_jobs_org_type_active").on(table.organizationId, table.type, table.isActive),
}));

// Output Storage Settings Schema
export const outputStorageSettingsSchema = z.object({
    storeOnStatus: z.enum(["success", "failure", "both"]).default("success"),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(0).optional(),
    requireNonEmpty: z.boolean().default(true),
    chunking: z.object({
        enabled: z.boolean().default(true),
        chunkSize: z.number().int().positive().default(800),
        chunkOverlap: z.number().int().nonnegative().default(150),
    }).optional(),
    schemaMapping: z.object({
        includedFields: z.array(z.string()).optional(),
        excludedFields: z.array(z.string()).optional(),
        columnRenames: z.record(z.string(), z.string()).optional(),
        maxDepth: z.number().optional(),
        storeArrayCounts: z.boolean().optional(),
        columns: z.array(z.object({
            jsonPath: z.string(),
            datasetKey: z.string(),
            type: z.enum(["text", "number", "boolean", "date", "json"]).default("text"),
            transform: z.enum(["lowercase", "uppercase", "trim", "none", "regex"]).optional(),
        })).optional(),
        hygiene: z.object({
            deduplication: z.object({
                enabled: z.boolean(),
                keyColumns: z.array(z.string()).optional(),
                strategy: z.enum(["keepFirst", "keepLast"]),
                scope: z.enum(["local", "global"]).optional(),
                globalConflictResolution: z.enum(["skip", "update"]).optional(),
            }).optional(),
            nullHandling: z.object({
                strategy: z.enum(["keep", "drop", "fill"]),
                fillValue: z.string().optional(),
            }).optional(),
            validation: z.object({
                dropInvalidTypes: z.boolean(),
            }).optional(),
        }).optional(),
    }).optional(),
}).default({});

export type OutputStorageSettings = z.infer<typeof outputStorageSettingsSchema>;

export const DATA_CLASSIFICATION_VALUES = ['public', 'internal', 'sensitive', 'restricted'] as const;
export type DataClassification = typeof DATA_CLASSIFICATION_VALUES[number];

export const insertJobSchema = createInsertSchema(jobs, {
    name: z.string().min(1, "Name is required"),
    type: z.enum(jobTypes),
    config: z.any(), // Validated separately based on type
    priority: z.number().int().min(1).max(3).optional(),
    tool: z.enum(jobTools).default("None"),
    parameterSchema: z.any().optional(),
    outputStorageSettings: outputStorageSettingsSchema.optional(),
    lifecycleStatus: z.enum(['active', 'draft', 'archived']).optional().default('active'),
    outputKnowledgeTopicId: z.number().int().positive().nullable().optional(),
    outputDatasetId: z.number().int().positive().nullable().optional(),
    enableKnowledgeStore: z.boolean().optional(),
    defaultTargetMetric: z.record(z.any()).optional().nullable(),
    dataClassification: z.enum(DATA_CLASSIFICATION_VALUES).optional().default('public'),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const updateJobSchema = insertJobSchema.partial().extend({
    outputStorageSettings: outputStorageSettingsSchema.nullable().optional(),
});

export type InsertJob = z.infer<typeof insertJobSchema>;
export type UpdateJob = z.infer<typeof updateJobSchema>;
export type Job = typeof jobs.$inferSelect;

// ============================================================================
// JOB DEPENDENCIES
// ============================================================================

export const jobDependencies = pgTable("job_dependencies", {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
        .notNull()
        .references(() => jobs.id, { onDelete: 'cascade' }),
    dependsOnJobId: integer("depends_on_job_id")
        .notNull()
        .references(() => jobs.id, { onDelete: 'cascade' }),
    dependencyType: varchar("dependency_type", { length: 20 }).default("hard").notNull(),
    organizationId: integer("organization_id").references(() => orgs.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    jobIdIdx: index("job_deps_job_id_idx").on(table.jobId),
    dependsOnIdx: index("job_deps_depends_on_idx").on(table.dependsOnJobId),
    uniqueJobDep: uniqueIndex("job_deps_unique_idx").on(table.jobId, table.dependsOnJobId),
}));

export type JobDependency = typeof jobDependencies.$inferSelect;
export type InsertJobDependency = typeof jobDependencies.$inferInsert;




