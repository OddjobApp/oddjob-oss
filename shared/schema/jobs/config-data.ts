/**
 * Data Processing and Synchronization Job Configuration Schemas
 * 
 * Contains schemas for data-heavy operations:
 * - SaaS Sync (Confluence, Jira, Google Drive)
 * - Data Transformation (Transformer)
 * - Data Ingestion/Export (Folder Import, File Export, File Writer)
 * - Database Operations (SQL Query)
 */

import { z } from "zod";
import {
    entityRuleSchema,
    relationshipRuleSchema,
} from '../knowledge-config.js';

// ============================================================================
// SAAS SYNC CONFIGURATIONS
// ============================================================================

export const confluenceSyncConfigSchema = z.object({
    credentialId: z.number().int(),
    spaceKeys: z.array(z.string()).default([]),
    spaceKey: z.string().optional(), // Legacy/Frontend single space support
    cql: z.string().optional(),
    recursive: z.boolean().default(true),
    knowledgeTopicId: z.number().int(),
});

export type ConfluenceSyncConfig = z.infer<typeof confluenceSyncConfigSchema>;

export const jiraSyncConfigSchema = z.object({
    credentialId: z.number().int(),
    projectKeys: z.array(z.string()).default([]),
    projectKey: z.string().optional(),
    jql: z.string().optional(),
    limit: z.number().int().default(100),
    knowledgeTopicId: z.number().int(),
    additionalFields: z.array(z.string()).default([]).optional(),
});

export type JiraSyncConfig = z.infer<typeof jiraSyncConfigSchema>;

export const googleDriveSyncConfigSchema = z.object({
    credentialId: z.number().int(),
    folderIds: z.array(z.string()).default([]),
    recursive: z.boolean().default(true),
    knowledgeTopicId: z.number().int(),
});

export type GoogleDriveSyncConfig = z.infer<typeof googleDriveSyncConfigSchema>;

export const youtubeSyncConfigSchema = z.object({
    playlistId: z.string().min(1),
    maxVideos: z.number().int().optional(),
    transcriptionEnabled: z.boolean().default(true),
    enrichmentEnabled: z.boolean().default(true),
    knowledgeTopicId: z.number().int(),
    datasetId: z.number().int().optional(),
});

export type YouTubeSyncConfig = z.infer<typeof youtubeSyncConfigSchema>;

// ============================================================================
// TRANSFORMER & EXTRACTION
// ============================================================================

export const transformationRuleSchema = z.object({
    id: z.string(),
    sourcePath: z.string(),
    targetPath: z.string(),
    type: z.enum(["direct", "wrap_object", "map_value", "parse_json", "to_string", "extract_field", "custom_script", "template"]),
    template: z.string().optional(),
    targetType: z.enum(["string", "number", "boolean", "date", "json", "array"]).default("string"),
    config: z.object({
        wrapperKey: z.string().optional(),
        mapping: z.record(z.string(), z.string()).optional(),
        extractPath: z.string().optional(),
        // Custom Script Config
        script: z.string().optional(),
        language: z.enum(["javascript", "python"]).optional(),
    }).optional(),
});

export type TransformationRule = z.infer<typeof transformationRuleSchema>;

export const transformerConfigSchema = z.object({
    rules: z.array(transformationRuleSchema),
    inputSource: z.enum(["previous_step", "provided"]).default("previous_step"),
    entityExtraction: z.object({
        enabled: z.boolean().default(false),
        entityRules: z.array(entityRuleSchema).optional(),
        relationshipRules: z.array(relationshipRuleSchema).optional(),
        autoCreate: z.boolean().default(true),
    }).optional(),
});

export type TransformerConfig = z.infer<typeof transformerConfigSchema>;

export const extractionSourceSchema = z.object({
    source: z.enum(["transformer", "pipeline"]),
    stepOrder: z.number().int().positive().optional(),
    timestamp: z.string(),
    jobId: z.number().int().positive().optional(),
});

export type ExtractionSource = z.infer<typeof extractionSourceSchema>;

// ============================================================================
// DATA INGESTION & EXPORT
// ============================================================================

export const folderImportConfigSchema = z.object({
    folderPath: z.string().min(1),
    pattern: z.string().default("**/*"),
    recursive: z.boolean().default(false),
    mode: z.enum(["list_only", "read_content", "ingest_dataset"]).default("list_only"),
    encoding: z.enum(["utf8", "base64", "data_uri"]).default("utf8"),
    extractArchives: z.boolean().default(false),
    postProcessAction: z.enum(["none", "move", "delete"]).default("none"),
    moveDestination: z.string().optional(),
    maxBatchSize: z.number().int().positive().default(100),
    onBadRecord: z.enum(["skip", "fail_fast"]).default("skip"),
    schema: z.object({
        requiredFields: z.array(z.string()).optional(),
        mapping: z.record(z.string(), z.string()).optional(),
        columns: z.array(z.object({
            jsonPath: z.string(),
            datasetKey: z.string(),
            type: z.enum(["text", "number", "boolean", "date", "json"]).default("text"),
            transform: z.string().optional(),
        })).optional()
    }).optional()
});

export type FolderImportConfig = z.infer<typeof folderImportConfigSchema>;

export const fileExportConfigSchema = z.object({
    destinationPath: z.string().min(1),
    content: z.string(),
    encoding: z.enum(["utf8", "base64"]).default("utf8"),
    format: z.enum(["raw", "json", "csv"]).default("raw"),
    onConflict: z.enum(["overwrite", "append", "fail", "rename"]).default("overwrite"),
});

export type FileExportConfig = z.infer<typeof fileExportConfigSchema>;

export const saveToDatasetConfigSchema = z.object({
    datasetId: z.number().int().positive().optional(),
    datasetName: z.string().optional(),
    data: z.any().describe("The data to save into the dataset. If it's an array, multiple items will be created."),
});

export type SaveToDatasetConfig = z.infer<typeof saveToDatasetConfigSchema>;


// ============================================================================
// BUDGETMASTER (SAWM) FINANCE ENGINE
// ============================================================================
// Config contracts for the finance job types. Data lives in the YAML-declared
// dataset collections in app_records — these only carry the engine knobs.

/** statement_ingest: parse OFX/QIF/CSV statement files into `transactions`. */
export const statementIngestConfigSchema = z.object({
    accountId: z.string().default("acc_unassigned"),
    contextId: z.string().optional(), // overrides folder-based context routing
    content: z.string().optional(), // single inline statement
    fileName: z.string().optional(),
    files: z
        .array(z.object({ fileName: z.string().optional(), content: z.string() }))
        .optional(), // typically wired from an upstream folder_import step
});
export type StatementIngestConfig = z.infer<typeof statementIngestConfigSchema>;

/** dms_evaluate: sweep ARMED dead-man's switches for faults (no knobs). */
export const dmsEvaluateConfigSchema = z.object({}).passthrough();
export type DmsEvaluateConfig = z.infer<typeof dmsEvaluateConfigSchema>;

/** cash_drag_scan: idle-cash / yield-arbitrage scan. */
export const cashDragScanConfigSchema = z.object({
    floor: z.number().nonnegative().optional(),
    yieldDelta: z.number().min(0).max(1).optional(),
    minDragToFlag: z.number().nonnegative().optional(),
});
export type CashDragScanConfig = z.infer<typeof cashDragScanConfigSchema>;

/** subscription_scan: subscription decay / quarantine scan. */
export const subscriptionScanConfigSchema = z.object({
    staleDays: z.number().int().positive().optional(),
    maxCostPerHour: z.number().nonnegative().optional(),
});
export type SubscriptionScanConfig = z.infer<typeof subscriptionScanConfigSchema>;

/** balance_lock: monthly net-worth snapshot ("lock") or weekly CapEx burn ("capex"). */
export const balanceLockConfigSchema = z.object({
    mode: z.enum(["lock", "capex"]).default("lock"),
    period: z.string().optional(), // YYYY-MM; defaults to current month
});
export type BalanceLockConfig = z.infer<typeof balanceLockConfigSchema>;

/** amortize_sim: capital-purchase amortization + opportunity-cost math. */
export const amortizeSimConfigSchema = z.object({
    principal: z.number().nonnegative(),
    downPayment: z.number().nonnegative().default(0),
    annualRate: z.number().min(0).max(1),
    termMonths: z.number().int().positive(),
    opportunityRate: z.number().min(0).max(1).optional(),
    sandboxId: z.string().optional(), // persist the scenario to purchase_sandboxes
    label: z.string().optional(),
});
export type AmortizeSimConfig = z.infer<typeof amortizeSimConfigSchema>;

export const fileWriterConfigSchema = z.object({
    content: z.string().describe("Content to write. Supports variable substitution."),
    format: z.enum(["raw", "json", "csv"]).default("raw"),
    encoding: z.enum(["utf8", "base64"]).default("utf8"),
    destination: z.enum([
        "local",
        "aws_s3",
        "google_cloud_storage",
        "azure_blob",
        "google_drive",
        "onedrive"
    ]).default("local"),
    path: z.string().min(1),
    credentialId: z.number().int().positive().optional(),
    bucket: z.string().optional(),
    container: z.string().optional(),
    onConflict: z.enum(["overwrite", "append", "fail", "rename"]).default("overwrite"),
    createDirs: z.boolean().default(true),
    acl: z.string().optional(),
});

export type FileWriterConfig = z.infer<typeof fileWriterConfigSchema>;

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

export const sqlQueryConfigSchema = z.object({
    credentialId: z.number().int().positive(),
    query: z.string().min(1),
    parameters: z.record(z.string(), z.string()).optional(),
    outputMode: z.enum(["list", "single"]).default("list"),
});

export type SqlQueryConfig = z.infer<typeof sqlQueryConfigSchema>;

// ============================================================================
// GITHUB SYNC CONFIGURATION
// ============================================================================

export const githubSyncConfigSchema = z.object({
    credentialId: z.number().int(),
    owner: z.string().optional(),
    repos: z.array(z.string()).default([]),
    syncType: z.enum(["issues", "pull_requests", "commits", "releases", "all"]).default("all"),
    state: z.enum(["open", "closed", "all"]).default("open"),
    limit: z.number().int().default(100),
    knowledgeTopicId: z.number().int(),
    labels: z.array(z.string()).optional(),
    since: z.string().optional(),
});

export type GitHubSyncConfig = z.infer<typeof githubSyncConfigSchema>;

// ============================================================================
// SHAREPOINT SYNC CONFIGURATION
// ============================================================================

export const sharepointSyncConfigSchema = z.object({
    credentialId: z.number().int(),
    siteId: z.string().min(1),
    driveId: z.string().optional(),
    folderPath: z.string().default("/"),
    recursive: z.boolean().default(true),
    knowledgeTopicId: z.number().int(),
    fileTypes: z.array(z.string()).default([".docx", ".pdf", ".txt", ".md"]),
});

export type SharepointSyncConfig = z.infer<typeof sharepointSyncConfigSchema>;



