/**
 * Core Job Type Definitions
 * 
 * Contains the fundamental types used across all job configurations.
 */

import { z } from "zod";

// ============================================================================
// JOB TYPES & TOOLS
// ============================================================================

export const jobTypes = [
    "shell",
    "api", // DEPRECATED: Use "curl" instead - maintained for backward compatibility
    "curl",
    "python",
    "ai_api_call",
    "repeater",
    "transformer",
    "openapi",
    "airflow_dag_run",
    "human_approval",
    "slack_post",
    "email_send",
    "sql_query",
    "ai_agent",
    "decision",
    "iterator",
    "reranker",
    "folder_import",
    "file_export",
    "selenium",
    "node_script",
    "git_op",
    "file_writer",
    "file_ops",
    "confluence_sync",
    "jira_sync",
    "google_drive_sync",
    "static_response",
    "supervisor",
    "form_agent",
    "dispatcher",
    "youtube_sync",
    "foundry_agent",
    "github_sync",
    "github_op",
    "cloud_function",
    "teams_post",
    "sharepoint_sync",
    "monitoring_query",
    "agent_ai",
    "computer_use",
    // BudgetMaster (SAWM) finance engine job types — operate over the
    // YAML-declared dataset collections in app_records (no migration).
    "statement_ingest",
    "dms_evaluate",
    "cash_drag_scan",
    "subscription_scan",
    "balance_lock",
    "amortize_sim",
    "save_to_dataset",
    // Sense-Predict-Act Triad Prediction & Spatial Engines
    "prediction_inference",
    "spatial_reranker",
    // Studio deliverables
    "scribe_publish",
    "media_take",
] as const;
export type JobType = (typeof jobTypes)[number];

// ============================================================================
// DEPRECATED JOB TYPES
// ============================================================================
// These types are maintained for backward compatibility but should not be
// used for new jobs. Use the 'migrateTo' type instead.

export const DEPRECATED_JOB_TYPES: Record<string, { migrateTo: string; reason: string }> = {
    api: { migrateTo: "curl", reason: "Consolidated into curl type" },
};

/**
 * Migrate a deprecated job type to its replacement
 * Returns the original type if not deprecated
 */
export function migrateJobType(type: string): string {
    return DEPRECATED_JOB_TYPES[type]?.migrateTo || type;
}

export const jobTools = ["None", "RAG Resource"] as const;
export type JobTool = (typeof jobTools)[number];

export const agentPersonas = [
    "generic",
    "researcher",
    "critic",
    "analyst",
    "creator",
    "strategist",
    "debugger",
    "business_analyst",
    "forecaster",
    "compliance_officer",
    "threat_detector",
    "ui_specialist",
    "auditor"
] as const;
export type AgentPersona = (typeof agentPersonas)[number];

// ============================================================================
// SCHEMA DEFINITION TYPES (for data contracts)
// ============================================================================


export interface FieldDefinition {
    type: string;
    required?: boolean;
    isKey?: boolean;
    isForeignKey?: boolean;
    foreignKeyTarget?: string;
    description?: string;
    examples?: any[];
}

export interface JobInputSchema {
    capturedAt: string;
    sampleInput: any;
    schemaDef: Record<string, FieldDefinition>;
}

export interface JobOutputSchema {
    capturedAt: string;
    sampleOutput: any;
    schemaDef: Record<string, FieldDefinition>;
    suggestedLabel?: string;
}

// ============================================================================
// JOB PARAMETER SCHEMA
// ============================================================================

export const jobParameterSchema = z.object({
    name: z.string().min(1, "Name is required"),
    type: z.enum(["string", "number", "boolean", "json"]).default("string"),
    required: z.boolean().default(false),
    defaultValue: z.string().optional(),
    description: z.string().optional(),
});

export const jobParameterListSchema = z.array(jobParameterSchema);
export type JobParameter = z.infer<typeof jobParameterSchema>;



