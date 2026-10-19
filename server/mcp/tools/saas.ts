
import { z } from "zod";

export const saasToolDefinitions = [
    {
        name: "list_saas_connectors",
        description: "List all registered SaaS connectors (Jira, Confluence, Slack, etc.) and their current connection status.",
        inputSchema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "get_saas_connector_schema",
        description: "Get the field schema (including custom fields and allowed values) for a specific SaaS platform and project.",
        inputSchema: {
            type: "object",
            properties: {
                platform: {
                    type: "string",
                    description: "The platform (e.g., 'jira', 'confluence')",
                },
                projectKey: {
                    type: "string",
                    description: "Optional project key (required for Jira)",
                },
            },
            required: ["platform"],
        },
    },
    {
        name: "update_saas_sync_config",
        description: "Update the bidirectional sync configuration (mappings and filters) for a SaaS platform.",
        inputSchema: {
            type: "object",
            properties: {
                platform: {
                    type: "string",
                    description: "The platform to configure",
                },
                config: {
                    type: "object",
                    properties: {
                        enabled: { type: "boolean" },
                        sync_interval: { type: "integer" },
                        conflict_resolution: { type: "string" },
                        mappings: { type: "object" },
                        filters: { type: "object" }
                    }
                }
            },
            required: ["platform", "config"],
        },
    },
    {
        name: "add_jira_comment",
        description: "Add a comment to an existing Jira issue.",
        inputSchema: {
            type: "object",
            properties: {
                issueKey: { type: "string", description: "The Jira issue key (e.g., PROJ-123)" },
                comment: { type: "string", description: "The comment text to add" },
            },
            required: ["issueKey", "comment"],
        },
    },
    {
        name: "transition_jira_issue",
        description: "Change the status of a Jira issue (e.g., move to 'Done').",
        inputSchema: {
            type: "object",
            properties: {
                issueKey: { type: "string", description: "The Jira issue key" },
                status: { type: "string", description: "The target status name or transition name" },
            },
            required: ["issueKey", "status"],
        },
    },
    {
        name: "update_jira_issue",
        description: "Update fields of an existing Jira issue (summary, description, priority, etc.).",
        inputSchema: {
            type: "object",
            properties: {
                issueKey: { type: "string", description: "The Jira issue key" },
                summary: { type: "string" },
                description: { type: "string" },
                priority: { type: "string" },
                assignee: { type: "string", description: "Jira Account ID" },
                labels: { type: "array", items: { type: "string" } },
            },
            required: ["issueKey"],
        },
    },
    {
        name: "create_jira_issue",
        description: "Create a new Jira issue with summary, type, and optional fields.",
        inputSchema: {
            type: "object",
            properties: {
                projectKey: { type: "string", description: "The Jira project key (e.g., PROJ)" },
                summary: { type: "string", description: "The issue summary" },
                issueType: { type: "string", description: "The issue type (e.g., Bug, Task)" },
                description: { type: "string" },
                assignee: { type: "string", description: "Jira Account ID" },
                priority: { type: "string" },
                labels: { type: "array", items: { type: "string" } },
            },
            required: ["projectKey", "summary", "issueType"],
        },
    },
];

export const ListSaasConnectorsInput = z.object({});
export const SyncSaasConnectorInput = z.object({
    platform: z.string(),
    syncType: z.enum(["full", "incremental", "metadata"]).default("full"),
});

export const GetSaasConnectorSchemaInput = z.object({
    platform: z.string(),
    projectKey: z.string().optional(),
});

export const UpdateSaasSyncConfigInput = z.object({
    platform: z.string(),
    config: z.object({
        enabled: z.boolean().optional(),
        sync_interval: z.number().optional(),
        conflict_resolution: z.string().optional(),
        mappings: z.record(z.string()).optional(),
        filters: z.record(z.any()).optional(),
    }),
});

export const AddJiraCommentInput = z.object({
    issueKey: z.string(),
    comment: z.string(),
});

export const TransitionJiraIssueInput = z.object({
    issueKey: z.string(),
    status: z.string(),
});

export const UpdateJiraIssueInput = z.object({
    issueKey: z.string(),
    summary: z.string().optional(),
    description: z.string().optional(),
    priority: z.string().optional(),
    assignee: z.string().optional(),
    labels: z.array(z.string()).optional(),
});

export const CreateJiraIssueInput = z.object({
    projectKey: z.string(),
    summary: z.string(),
    issueType: z.string(),
    description: z.string().optional(),
    assignee: z.string().optional(),
    priority: z.string().optional(),
    labels: z.array(z.string()).optional(),
});

