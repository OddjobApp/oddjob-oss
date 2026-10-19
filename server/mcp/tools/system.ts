
import { z } from "zod";

export const systemToolDefinitions = [
    {
        name: "get_assistant_info",
        description: "Get information about the Oddjob Assistant's identity, AI provider, and configuration.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "update_assistant_settings",
        description: "Update the Oddjob Assistant's runtime settings like max iterations for reasoning.",
        inputSchema: {
            type: "object",
            properties: {
                maxIterations: {
                    type: "number",
                    description: "Maximum reasoning steps (1-100)",
                },
            },
        },
    },
    {
        name: "get_system_health",
        description: "Get current system health status, including recent error rates.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "list_failed_jobs",
        description: "List recently failed pipeline executions.",
        inputSchema: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "Maximum number of failed jobs to return (default 5)",
                },
            },
        },
    },
    {
        name: "get_cost_analysis",
        description: "Get AI cost analytics including total spend and trends.",
        inputSchema: {
            type: "object",
            properties: {
                days: {
                    type: "number",
                    description: "Number of days to analyze (default 30)",
                },
            },
        },
    },
    {
        name: "list_alerts",
        description: "List active alerts in the system.",
        inputSchema: {
            type: "object",
            properties: {
                severity: {
                    type: "string",
                    enum: ["critical", "high", "medium", "low", "info"],
                },
                includeAcknowledged: {
                    type: "boolean",
                },
                limit: {
                    type: "number",
                },
            },
        },
    },
    {
        name: "get_health_dashboard",
        description: "Get comprehensive system health including schedules, failed jobs, and alerts.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "resync_system_graph",
        description: "Manually trigger a resync of the System Graph (Knowledge Graph). Scans DB schema and frontend components to rebuild semantic relationships.",
        inputSchema: {
            type: "object",
            properties: {
                organizationId: {
                    type: "number",
                    description: "Organization ID to sync (default 1)",
                },
            },
        },
    },
];


export const GetAssistantInfoInput = z.object({});
export const UpdateAssistantSettingsInput = z.object({
    maxIterations: z.number().min(1).max(100).optional(),
});
export const ResyncSystemGraphInput = z.object({
    organizationId: z.number().optional(),
});

