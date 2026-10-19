/**
 * Integration and Communication Job Configuration Schemas
 * 
 * Contains schemas for external service integrations:
 * - REST API (CURL, generic API)
 * - OpenAPI/Swagger
 * - Workflow Orchestration (Airflow)
 * - Notifications (Slack, Email)
 */

import { z } from "zod";

// ============================================================================
// API & WEB REQUESTS
// ============================================================================

export const curlConfigSchema = z.object({
    url: z.string().min(1).refine(
        (val) => val.startsWith('/') || (() => { try { new URL(val); return true; } catch { return false; } })(),
        { message: "Must be a valid URL or a relative path starting with /" }
    ),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    queryParams: z.record(z.string(), z.any()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    requestType: z.enum(["json", "text", "form-data", "xml", "custom"]).optional(),
    responseType: z.enum(["json", "text", "auto"]).optional(),
    authType: z.enum(["none", "bearer", "basic"]).default("none"),
    credentialId: z.number().int().positive().optional(),
});

export type CurlConfig = z.infer<typeof curlConfigSchema>;

export const apiConfigSchema = curlConfigSchema;
export type ApiConfig = CurlConfig;

export const openApiJobConfigSchema = z.object({
    specId: z.number().int().positive(),
    operationId: z.string().min(1),
    parameters: z.record(z.string(), z.any()).default({}), // Map of param name -> value
    credentialId: z.number().int().positive().optional(), // For auto-injection
});

export type OpenAPIJobConfig = z.infer<typeof openApiJobConfigSchema>;

// ============================================================================
// WORKFLOW ORCHESTRATION
// ============================================================================

export const airflowDagRunConfigSchema = z.object({
    connectionId: z.string(),
    dagId: z.string().min(1, "DAG ID is required"),
    dagRunConf: z.record(z.string(), z.any()).optional(),
    waitForCompletion: z.boolean().default(true),
    timeoutSeconds: z.number().int().default(3600),
    pollIntervalSeconds: z.number().int().default(30),
    xcomFetchConfig: z.array(z.string()).optional(),
});

export type AirflowDagRunConfig = z.infer<typeof airflowDagRunConfigSchema>;

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export const slackPostConfigSchema = z.object({
    credentialId: z.number().int().positive(),
    channelId: z.string().min(1),
    message: z.string().min(1),
});

export type SlackPostConfig = z.infer<typeof slackPostConfigSchema>;

export const emailSendConfigSchema = z.object({
    credentialId: z.number().int().positive(),
    to: z.string().min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
    isHtml: z.boolean().default(false),
});

export type EmailSendConfig = z.infer<typeof emailSendConfigSchema>;

// ============================================================================
// CLOUD INFRASTRUCTURE
// ============================================================================

export const cloudFunctionConfigSchema = z.object({
    credentialId: z.number().int().positive(),
    provider: z.enum(["aws", "gcp", "azure"]),
    action: z.enum([
        "invoke_function", "list_functions", "read_logs",
        "list_instances", "describe_instance",
        "list_buckets", "read_object", "put_object",
    ]),
    functionName: z.string().optional(),
    functionPayload: z.record(z.string(), z.any()).optional(),
    invocationType: z.enum(["sync", "async"]).default("sync"),
    logGroupName: z.string().optional(),
    logStreamName: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    filterPattern: z.string().optional(),
    bucketName: z.string().optional(),
    objectKey: z.string().optional(),
    objectContent: z.string().optional(),
    region: z.string().optional(),
    project: z.string().optional(),
});

export type CloudFunctionConfig = z.infer<typeof cloudFunctionConfigSchema>;

// ============================================================================
// MICROSOFT 365 â€” TEAMS
// ============================================================================

export const teamsPostConfigSchema = z.object({
    credentialId: z.number().int().positive(),
    teamId: z.string().min(1),
    channelId: z.string().min(1),
    message: z.string().min(1),
    isHtml: z.boolean().default(false),
    subject: z.string().optional(),
});

export type TeamsPostConfig = z.infer<typeof teamsPostConfigSchema>;

// ============================================================================
// MONITORING & ALERTING
// ============================================================================

export const monitoringQueryConfigSchema = z.object({
    credentialId: z.number().int().positive(),
    provider: z.enum(["datadog", "pagerduty", "newrelic", "grafana"]),
    action: z.enum([
        "query_metrics", "list_alerts", "get_incidents",
        "trigger_alert", "resolve_incident",
        "list_dashboards", "get_service_status",
    ]),
    query: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    tags: z.array(z.string()).optional(),
    serviceId: z.string().optional(),
    incidentId: z.string().optional(),
    alertTitle: z.string().optional(),
    alertBody: z.string().optional(),
    severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
    limit: z.number().int().default(50),
});

export type MonitoringQueryConfig = z.infer<typeof monitoringQueryConfigSchema>;



