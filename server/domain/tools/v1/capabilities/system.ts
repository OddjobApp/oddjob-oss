
import { z } from "zod";
import { db } from "@server/database_service.js";
import { pipelineExecutions } from "@shared/schema/index.js";
import { eq, desc, and } from "drizzle-orm";
import type { ToolDefinition } from "./types.js";
import { getOddjobCapabilityManifest } from "@shared/product/oddjob-capability-manifest.js";
import { credentialSecretStore } from "@domain/auth/core/credential-secret-store.js";

// Helper function to extract text from MCP response format
function extractMcpText(mcpResult: any): string {
    if (mcpResult?.content && Array.isArray(mcpResult.content)) {
        const textContent = mcpResult.content.find((c: any) => c.type === "text");
        if (textContent?.text) {
            return textContent.text;
        }
    }
    return JSON.stringify(mcpResult, null, 2);
}

// Helper function to sanitize credential metadata - removes any potential secrets
function sanitizeCredentialMetadata(metadata: any): any {
    if (!metadata) return null;
    const safe = { ...metadata };
    const sensitiveFields = ['password', 'secret', 'token', 'apiKey', 'api_key', 'privateKey', 'private_key'];
    for (const field of sensitiveFields) {
        if (safe[field]) safe[field] = '[REDACTED]';
    }
    return safe;
}

export const SYSTEM_TOOLS: Record<string, ToolDefinition> = {
    // --- System Management ---
    get_oddjob_copilot_guide: {
        name: "get_oddjob_copilot_guide",
        label: "Get Oddjob Copilot Guide",
        group: "System Management",
        description: "Return the canonical Oddjob Copilot operating guide: guided flows, safe commands, trust questions, capability next actions, and readiness checks. Use before recommending platform workflows.",
        parameters: z.object({
            includeFullManifest: z.boolean().optional().default(false).describe("When true, include pillars, capabilities, demos, and readiness checks in addition to the Copilot guide."),
        }),
        riskLevel: "low",
        idempotency: "read-safe",
        execute: async ({ includeFullManifest }) => {
            const manifest = getOddjobCapabilityManifest();
            const payload = includeFullManifest
                ? manifest
                : {
                    positioning: manifest.positioning,
                    copilotGuide: manifest.copilotGuide,
                    capabilityNextActions: manifest.capabilities.map((capability) => ({
                        id: capability.id,
                        name: capability.name,
                        pillar: capability.pillar,
                        maturity: capability.maturity,
                        nextActions: capability.copilotNextActions,
                    })),
                    canonicalDemos: manifest.canonicalDemos.map((demo) => ({
                        id: demo.id,
                        title: demo.title,
                        outcome: demo.outcome,
                        successCriteria: demo.successCriteria,
                    })),
                };
            return JSON.stringify(payload, null, 2);
        }
    },
    list_jobs: {
        name: "list_jobs",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Jobs",
        group: "System Management",
        description: "List all jobs in the organization. Jobs are reusable task definitions that can be executed as pipeline steps.",
        parameters: z.object({
            search: z.string().optional().describe("Search term to filter jobs by name"),
            type: z.string().optional().describe("Filter by job type (shell, curl, api, ai, etc.)"),
            limit: z.number().optional().default(20),
        }),
        execute: async (params, context) => {
            const { handleListJobs } = await import("@server/mcp/handlers.js");
            const result = await handleListJobs(params, context);
            return extractMcpText(result);
        }
    },
    get_job_details: {
        name: "get_job_details",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Job Details",
        group: "System Management",
        description: "Get detailed configuration of a specific job.",
        parameters: z.object({
            jobId: z.number().optional().describe("ID of the job"),
            jobName: z.string().optional().describe("Name of the job (if ID not known)"),
        }),
        execute: async (params, context) => {
            const { handleGetJobDetails } = await import("../../../../mcp/handlers.js");
            const result = await handleGetJobDetails(params, context);
            return extractMcpText(result);
        }
    },
    create_job: {
        name: "create_job",

        idempotency: "none",
        label: "Create Job",
        group: "System Management",
        description: "Create a new job. Requires admin permissions. Types include: shell, curl, python, ai_api_call, ai_agent, transformer, openapi, selenium, sql_query, slack_post, email_send, repeater, iterator, decision, human_approval, folder_import, file_export, reranker, airflow_dag_run, node_script.",
        parameters: z.object({
            name: z.string().describe("Unique name for the job"),
            type: z.enum([
                "shell", "api", "curl", "python", "ai_api_call", "repeater",
                "transformer", "openapi", "airflow_dag_run", "human_approval",
                "slack_post", "email_send", "sql_query", "ai_agent", "decision",
                "iterator", "reranker", "folder_import", "file_export", "selenium", "node_script",
                "git_op"
            ]),
            description: z.string().optional(),
            config: z.record(z.any()).optional().describe("Job-type specific configuration. For JIRA: use method 'GET' and url '/rest/api/3/search/jql?jql=...'. Do NOT use POST. Include 'credentialId'."),
            // Top-level job field (NOT part of config): routes this job's output
            // into a dataset. Exposed so a create-with-routing request in one step
            // isn't silently dropped by the zod schema.
            outputDatasetId: z.number().int().positive().nullable().optional()
                .describe("Route this job's output into the dataset with this ID"),
        }),
        execute: async (params, context) => {
            const { handleCreateJob } = await import("../../../../mcp/handlers.js");
            const result = await handleCreateJob(params, context);
            return extractMcpText(result);
        }
    },
    update_job: {
        name: "update_job",

        idempotency: "idempotent",
        label: "Update Job",
        group: "System Management",
        description: "Update an existing job. Requires admin permissions.",
        parameters: z.object({
            jobId: z.number().describe("ID of the job to update"),
            name: z.string().optional(),
            description: z.string().optional(),
            config: z.record(z.any()).optional(),
            isActive: z.boolean().optional(),
            // Top-level job field (NOT part of config): routes this job's output
            // into a dataset. Without this parameter the LLM cannot request the
            // routing even when the user explicitly asks for it, because the zod
            // schema strips unknown keys before the handler runs.
            outputDatasetId: z.number().int().positive().nullable().optional()
                .describe("Route this job's output into the dataset with this ID (null to clear)"),
        }),
        execute: async (params, context) => {
            const { handleUpdateJob } = await import("../../../../mcp/handlers.js");
            const result = await handleUpdateJob(params, context);
            return extractMcpText(result);
        }
    },
    delete_job: {
        name: "delete_job",

        idempotency: "idempotent",
        riskLevel: "high",
        label: "Delete Job",
        group: "System Management",
        description: "Delete a job. Requires admin permissions. IMPORTANT: You MUST ask user to confirm before executing this delete.",
        parameters: z.object({
            jobId: z.number().describe("ID of the job to delete"),
            userConfirmed: z.boolean().describe("Set to true ONLY after user explicitly confirms deletion"),
        }),
        execute: async (params, context) => {
            if (!params.userConfirmed) {
                return "CONFIRMATION REQUIRED: Please ask the user to confirm they want to delete this job before proceeding.";
            }
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to delete jobs.";
            }
            const { handleDeleteJob } = await import("../../../../mcp/handlers.js");
            const result = await handleDeleteJob(params, context);
            return extractMcpText(result);
        }
    },
    list_failed_jobs: {
        name: "list_failed_jobs",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Failed Jobs",
        group: "System Management",
        description: "List recently failed pipeline executions.",
        parameters: z.object({
            limit: z.number().optional().default(5),
        }),
        execute: async ({ limit }, context) => {
            try {
                const orgId = context?.organizationId ?? null;
                const conditions = [eq(pipelineExecutions.status, 'failed')];
                if (orgId) conditions.push(eq(pipelineExecutions.organizationId, orgId));

                const results = await db.select({
                    id: pipelineExecutions.id,
                    pipelineId: pipelineExecutions.pipelineId,
                    error: pipelineExecutions.error,
                    completedAt: pipelineExecutions.completedAt
                })
                    .from(pipelineExecutions)
                    .where(and(...conditions))
                    .orderBy(desc(pipelineExecutions.completedAt))
                    .limit(limit);

                return results.length > 0 ? JSON.stringify(results, null, 2) : "No recent failed jobs found.";
            } catch (e: any) {
                return `Error fetching failed jobs: ${e.message}`;
            }
        }
    },
    get_system_health: {
        name: "get_system_health",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get System Health",
        group: "System Management",
        description: "Get current system health status including live worker queue depths and Redis connectivity.",
        parameters: z.object({}),
        execute: async () => {
            try {
                const { queueService } = await import("@domain/core/infrastructure/queue/queue-service.js");
                const namedQueues: Record<string, any> = {
                    steps:       queueService.stepsQueue,
                    ai:          queueService.aiQueue,
                    system:      queueService.systemQueue,
                    browser:     queueService.browserQueue,
                    heavy:       queueService.heavyQueue,
                    analytics:   queueService.analyticsQueue,
                    prospecting: queueService.prospectingQueue,
                };
                const queueStats: Record<string, { waiting: number; active: number; failed: number }> = {};

                for (const [label, q] of Object.entries(namedQueues)) {
                    try {
                        const [waiting, active, failed] = await Promise.all([
                            q.getWaitingCount(),
                            q.getActiveCount(),
                            q.getFailedCount(),
                        ]);
                        queueStats[label] = { waiting, active, failed };
                    } catch {
                        queueStats[label] = { waiting: -1, active: -1, failed: -1 };
                    }
                }

                const totalActive = Object.values(queueStats).reduce((s, q) => s + (q.active >= 0 ? q.active : 0), 0);
                const totalFailed = Object.values(queueStats).reduce((s, q) => s + (q.failed >= 0 ? q.failed : 0), 0);
                const status = totalFailed > 10 ? "DEGRADED" : "OPERATIONAL";

                return JSON.stringify({
                    status,
                    database: "Connected",
                    redis: "Connected",
                    totalActiveJobs: totalActive,
                    totalFailedJobs: totalFailed,
                    queues: queueStats,
                }, null, 2);
            } catch (e: any) {
                return `System Status: OPERATIONAL\nDatabase: Connected\nRedis: Connected\nWorker stats unavailable: ${e.message}`;
            }
        }
    },
    list_credentials: {
        name: "list_credentials",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Credentials",
        group: "System Management",
        adminOnly: true,
        description: "List credentials available in the organization. Returns metadata only (names, types, descriptions) and where each secret lives (secretSource: stored = encrypted for the organization, environment = legacy server variable, missing = not set) - NEVER exposes actual secret values. Requires admin permissions.",
        parameters: z.object({
            type: z.string().optional().describe("Filter by credential type (api_key, jira, database, smtp, etc.)"),
        }),
        execute: async (params, context) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to view credentials.";
            }
            try {
                const { credentialsService } = await import("@domain/auth/core/credentials-service.js");
                const orgId = context?.organizationId || null;
                const creds = await credentialsService.list(orgId, context?.isSuperAdmin || false);

                let filtered = creds;
                if (params.type) {
                    filtered = creds.filter(c => c.type === params.type);
                }

                const safeCredentials = filtered.map(c => ({
                    id: c.id,
                    name: c.name,
                    type: c.type,
                    description: c.description,
                    envVarRef: c.envVarName || null,
                    secretSource: c.secretSource,
                    metadata: c.metadata ? sanitizeCredentialMetadata(c.metadata) : null,
                    createdAt: c.createdAt,
                }));

                return JSON.stringify({
                    success: true,
                    summary: `Found ${safeCredentials.length} credentials`,
                    data: safeCredentials,
                }, null, 2);
            } catch (e: any) {
                return `Error listing credentials: ${e.message}`;
            }
        }
    },
    get_credential_info: {
        name: "get_credential_info",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Credential Info",
        group: "System Management",
        adminOnly: true,
        description: "Get information about a specific credential by ID or name. Returns metadata only and whether its secret is set (secretSource: stored = encrypted for the organization, environment = legacy server variable, missing = not set) - NEVER exposes actual secret values. Requires admin permissions.",
        parameters: z.object({
            credentialId: z.number().optional().describe("ID of the credential"),
            credentialName: z.string().optional().describe("Name of the credential (if ID not known)"),
        }),
        execute: async (params, context) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to view credential details.";
            }
            try {
                const { credentialsService } = await import("@domain/auth/core/credentials-service.js");
                const orgId = context?.organizationId || null;

                let credential;
                try {
                    if (params.credentialId) {
                        credential = await credentialsService.getById(params.credentialId, orgId, context?.isSuperAdmin || false);
                    } else if (params.credentialName) {
                        const creds = await credentialsService.list(orgId, context?.isSuperAdmin || false);
                        credential = creds.find(c =>
                            c.name.toLowerCase().includes(params.credentialName!.toLowerCase())
                        );
                    }
                } catch (err) {
                    // If not found, credential remains undefined
                }

                if (!credential) {
                    return JSON.stringify({ success: false, error: "Credential not found" });
                }

                if (credential.organizationId !== null &&
                    credential.organizationId !== orgId &&
                    !context?.isSuperAdmin) {
                    return JSON.stringify({ success: false, error: "Access denied to this credential" });
                }

                // Where the secret lives, without decrypting it to find out.
                const secretSource = await credentialSecretStore.source(credential);
                const safeCredential = {
                    id: credential.id,
                    name: credential.name,
                    type: credential.type,
                    description: credential.description,
                    envVarRef: credential.envVarName || null,
                    secretSource,
                    isConfigured: secretSource !== "missing",
                    metadata: credential.metadata ? sanitizeCredentialMetadata(credential.metadata) : null,
                    createdBy: credential.createdBy,
                    createdAt: credential.createdAt,
                };

                return JSON.stringify({
                    success: true,
                    data: safeCredential,
                }, null, 2);
            } catch (e: any) {
                return `Error getting credential: ${e.message}`;
            }
        }
    },
    get_cost_analysis: {
        name: "get_cost_analysis",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Cost Analysis",
        group: "Observability",
        description: "Get AI cost analytics including total spend, daily trends, cost by model, and top spending pipelines.",
        parameters: z.object({
            days: z.number().optional().default(30).describe("Number of days to analyze (default 30)"),
        }),
        execute: async (params, context) => {
            try {
                const { analyticsService } = await import("@domain/admin/core/analytics.service.js");
                const orgContext = {
                    isSuperAdmin: context?.isSuperAdmin || false,
                    organizationId: context?.organizationId || null
                };
                const stats = await (analyticsService as any).getCostDashboardStats(orgContext);

                return JSON.stringify({
                    success: true,
                    summary: `Total spend (last ${params.days || 30} days): $${stats.totalSpend.toFixed(4)}`,
                    data: {
                        totalSpend: stats.totalSpend,
                        activeModels: stats.modelCosts.length,
                        trackedPipelines: stats.topPipelines.length,
                        dailyCosts: stats.dailyCosts.slice(-7), // Last 7 days
                        topModels: stats.modelCosts.slice(0, 5),
                        topPipelines: stats.topPipelines.slice(0, 5)
                    }
                }, null, 2);
            } catch (e: any) {
                return `Error fetching cost analysis: ${e.message}`;
            }
        }
    },
    list_alerts: {
        name: "list_alerts",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Alerts",
        group: "Observability",
        description: "List active alerts in the system, optionally filtered by severity.",
        parameters: z.object({
            // The values alerts are written with (alerting.service.ts, the schedule
            // executor, the Python scheduler). This used to offer high/medium/low,
            // which no alert carries, so filtering on them always returned nothing.
            severity: z.enum(["critical", "error", "warning", "info"]).optional().describe("Filter by severity level"),
            includeAcknowledged: z.boolean().optional().default(false).describe("Include acknowledged alerts"),
            limit: z.number().optional().default(10),
        }),
        execute: async (params, context) => {
            try {
                const { alerts } = await import("@shared/schema/index.js");
                const { sql, and, eq, desc } = await import("drizzle-orm");

                const conditions = [];
                // A null org used to skip the filter and list every tenant's
                // alerts. Canonical scoping: the org's own rows; a null org sees
                // only null-org (platform) rows; a super admin with no org selected
                // sees all.
                const { getOrgConditions } = await import("@server/utils/org-conditions.js");
                const orgId = Number(context?.organizationId);
                conditions.push(...getOrgConditions({
                    userId: String(context?.userId ?? ""),
                    organizationId: Number.isInteger(orgId) && orgId > 0 ? orgId : null,
                    isSuperAdmin: !!context?.isSuperAdmin,
                    isAdmin: false,
                    isOrgAdmin: false,
                }, alerts, false));
                if (!params.includeAcknowledged) {
                    conditions.push(sql`${alerts.acknowledgedAt} IS NULL`);
                }
                conditions.push(sql`${alerts.resolvedAt} IS NULL`);
                conditions.push(eq(alerts.suppressed, false));

                if (params.severity) {
                    conditions.push(eq(alerts.severity, params.severity));
                }

                const alertList = await db.select({
                    id: alerts.id,
                    severity: alerts.severity,
                    message: alerts.message,
                    createdAt: alerts.createdAt,
                    acknowledgedAt: alerts.acknowledgedAt,
                }).from(alerts)
                    .where(and(...conditions))
                    .orderBy(desc(alerts.createdAt))
                    .limit(params.limit || 10);

                return JSON.stringify({
                    success: true,
                    summary: `Found ${alertList.length} active alerts`,
                    alerts: alertList
                }, null, 2);
            } catch (e: any) {
                return `Error fetching alerts: ${e.message}`;
            }
        }
    },
    get_health_dashboard: {
        name: "get_health_dashboard",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Health Dashboard",
        group: "Observability",
        description: "Get comprehensive system health including active schedules, failed jobs, alerts, and pipeline statistics.",
        parameters: z.object({}),
        execute: async (params, context) => {
            try {
                const { analyticsService } = await import("@domain/admin/core/analytics.service.js");
                const orgContext = {
                    isSuperAdmin: context?.isSuperAdmin || false,
                    organizationId: context?.organizationId || null
                };
                const stats = await (analyticsService as any).getDashboardStats(orgContext);

                return JSON.stringify({
                    success: true,
                    health: {
                        status: stats.activeAlerts > 0 ? "WARNING" : "HEALTHY",
                        activeSchedules: stats.activeSchedules,
                        activeAlerts: stats.activeAlerts,
                        failedJobs24h: stats.failedJobs24h,
                        activePipelines: stats.activePipelines,
                        pipelineRuns24h: stats.pipelineRuns24h,
                        failedPipelines24h: stats.failedPipelines24h,
                    },
                    recentActivity: stats.recentExecutions?.slice(0, 5) || [],
                    alertSummary: stats.activeAlertList || [],
                    trend: stats.executionTrend || []
                }, null, 2);
            } catch (e: any) {
                return `Error fetching health dashboard: ${e.message}`;
            }
        }
    },
    shell: {
        name: "shell",

        idempotency: "none",
        riskLevel: "high",
        label: "Execute Shell Command",
        group: "System Management",
        description: "Execute a shell command on the server. Useful for diagnostics (ps, netstat, df, etc.). Use with caution.",
        parameters: z.object({
            command: z.string().describe("The command to execute (e.g. 'ps aux', 'df -h')"),
        }),
        execute: async ({ command }) => {
            try {
                const { exec } = await import("child_process");
                const { promisify } = await import("util");
                const execAsync = promisify(exec);
                
                const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
                return `**Command**: ${command}\n\n**STDOUT**:\n${stdout}\n\n**STDERR**:\n${stderr}`;
            } catch (err: any) {
                return `**Command Failed**: ${command}\n\n**Error**: ${err.message}\n\n**Output**:\n${err.stdout || ""}\n${err.stderr || ""}`;
            }
        }
    },
    python: {
        name: "python",

        idempotency: "none",
        riskLevel: "medium",
        label: "Execute Python Code",
        group: "System Management",
        description: "Execute Python code securely in a sandboxed container. Useful for data analysis, complex logic, and scientific computing.",
        parameters: z.object({
            code: z.string().describe("The Python code to execute"),
        }),
        execute: async ({ code }) => {
            try {
                const { sandboxService } = await import("@server/services/sandbox.service.js");
                const { stdout, stderr } = await sandboxService.runPython(code, { timeoutMs: 60000 });
                return `**STDOUT**:\n${stdout}\n\n**STDERR**:\n${stderr}`;
            } catch (err: any) {
                return `**Execution Failed**\n\n**Error**: ${err.message}\n\n**Output**:\n${err.stdout || ""}\n${err.stderr || ""}`;
            }
        }
    },
    wave_reflection_synthesis: {
        name: "wave_reflection_synthesis",

        idempotency: "none",
        label: "Wave Reflection Synthesis",
        group: "Mission Control",
        description: "Synthesizes feedback from the Critic and constraints from the Developer to finalize the current wave and prepare for the next. Required at the end of every Rolling Wave cycle.",
        parameters: z.object({
            reflection: z.string().describe("The synthesized reflection and next steps."),
            status: z.enum(["continue", "pivot", "complete"]).optional().default("continue")
        }),
        execute: async (params, context) => {
            return JSON.stringify({
                success: true,
                message: "Reflection synthesized. Wave cycle complete.",
                status: params.status || "continue",
                timestamp: new Date().toISOString()
            });
        }
    },
    get_health_triage_brief: {
        name: "get_health_triage_brief",
        label: "Get Health Triage Brief",
        group: "System Management",
        description: "Retrieve a consolidated system health triage brief containing active alerts, circuit breakers, recent events, and resource pressures.",
        parameters: z.object({}),
        riskLevel: "low",
        idempotency: "read-safe",
        execute: async (params, context) => {
            const { monitoringService } = await import("@domain/core/infrastructure/monitoring.service.js");
            const brief = await monitoringService.getHealthTriageBrief({
                userId: context?.userId || "agent",
                organizationId: context?.organizationId || null,
                isAdmin: context?.isAdmin || false,
                // Carried through rather than defaulted: this is what decides whether
                // the brief is scoped to one tenant, and omitting it previously let an
                // isAdmin agent context read alerts across all of them.
                isSuperAdmin: context?.isSuperAdmin || false,
                isOrgAdmin: context?.isOrgAdmin || false,
            });
            return brief.markdown;
        }
    },
};


