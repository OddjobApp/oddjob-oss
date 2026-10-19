
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";

export const ListSaasConnectorsInput = z.object({});
export const SyncSaasConnectorInput = z.object({
    platform: z.string(),
    syncType: z.string().optional(),
});
export const GetSaasConnectorSchemaInput = z.object({
    platform: z.string(),
    projectKey: z.string().optional(),
});
export const UpdateSaasSyncConfigInput = z.object({
    platform: z.string(),
    config: z.record(z.any()),
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

export const SAAS_TOOLS: Record<string, ToolDefinition> = {
    /**
     * The adapters a room can actually reason about, read from the database.
     *
     * `list_saas_connectors` answers a neighbouring question by calling the
     * Python service, so it reports nothing when that service is down and knows
     * nothing about project ownership. This one reads `saas_connectors` directly
     * and returns the room surface: which platform, bound to which Jira project
     * or Confluence space, owned by this project space or inherited from the
     * organization, and whether a schema has ever been captured.
     */
    list_saas_adapters: {
        name: "list_saas_adapters",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List SaaS Adapters",
        group: "Integrations",
        riskLevel: "low",
        description:
            "List the SaaS adapters available to this project — Jira projects, Confluence spaces, Slack, GitHub — " +
            "with their connection status, sync cadence, and whether a schema snapshot has been captured.",
        parameters: z.object({}),
        execute: async (_params: any, context: ToolContext) => {
            const organizationId = context?.organizationId != null ? Number(context.organizationId) : null;
            if (organizationId == null) {
                return JSON.stringify({ error: "No organization in context; cannot list adapters." });
            }
            const projectId = (context as any)?.projectId != null ? Number((context as any).projectId) : null;
            const projectKey = (context as any)?.projectKey ?? null;

            const { saasAdapterInventoryService } = await import(
                "@domain/integrations/saas-adapter-inventory.service.js"
            );
            const adapters = await saasAdapterInventoryService.listForProject(organizationId, projectId);

            return JSON.stringify({
                type: "saas_adapters",
                title: projectKey ? `SaaS Adapters · ${projectKey}` : "SaaS Adapters",
                projectKey,
                projectId,
                adapters,
            });
        },
    },
    list_saas_connectors: {
        name: "list_saas_connectors",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List SaaS Connectors",
        group: "Integrations",
        description: "List all configured SaaS connectors and their current status.",
        parameters: z.object({}),
        execute: async (params, context) => {
            const { handleListSaasConnectors } = await import("../../../../mcp/handlers.js");
            const result = await handleListSaasConnectors(params, context);
            return extractMcpText(result);
        }
    },
    sync_saas_connector: {
        name: "sync_saas_connector",

        idempotency: "idempotent",
        label: "Sync SaaS Data",
        group: "Integrations",
        description: "Trigger a manual data synchronization for a specific SaaS platform.",
        parameters: z.object({
            platform: z.string().describe("SaaS platform name (slack, github, jira, teams)"),
            syncType: z.string().optional().describe("Type of data to sync (e.g., 'projects', 'issues', 'full')"),
        }),
        execute: async (params, context) => {
            const { handleSyncSaasConnector } = await import("../../../../mcp/handlers.js");
            const result = await handleSyncSaasConnector(params, context);
            return extractMcpText(result);
        }
    },
    get_saas_connector_schema: {
        name: "get_saas_connector_schema",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Connector Schema",
        group: "Integrations",
        description: "Get metadata schema (field definitions) for a SaaS platform.",
        parameters: z.object({
            platform: z.string().describe("SaaS platform name"),
            projectKey: z.string().optional().describe("Optional project key for platform-specific schemas (e.g. JIRA project key)"),
        }),
        execute: async (params, context) => {
            const { handleGetSaasConnectorSchema } = await import("../../../../mcp/handlers.js");
            const result = await handleGetSaasConnectorSchema(params, context);
            return extractMcpText(result);
        }
    },
    update_saas_sync_config: {
        name: "update_saas_sync_config",

        idempotency: "idempotent",
        label: "Update Sync Config",
        group: "Integrations",
        description: "Update synchronization configuration for a SaaS connector.",
        parameters: z.object({
            platform: z.string().describe("SaaS platform name"),
            config: z.record(z.any()).describe("New configuration object"),
        }),
        execute: async (params, context) => {
            const { handleUpdateSaasSyncConfig } = await import("../../../../mcp/handlers.js");
            const result = await handleUpdateSaasSyncConfig(params, context);
            return extractMcpText(result);
        }
    },

    // --- Jira Write-Back Tools ---
    add_jira_comment: {
        name: "add_jira_comment",

        idempotency: "none",
        label: "Add Jira Comment",
        group: "Integrations",
        description: "Add a comment to an existing Jira issue.",
        parameters: z.object({
            issueKey: z.string().describe("The Jira issue key (e.g., PROJ-123)"),
            comment: z.string().describe("The comment text to add"),
        }),
        execute: async (params, context) => {
            const { handleAddJiraComment } = await import("../../../../mcp/handlers.js");
            const result = await handleAddJiraComment(params, context);
            return extractMcpText(result);
        }
    },
    transition_jira_issue: {
        name: "transition_jira_issue",

        idempotency: "none",
        label: "Transition Jira Issue",
        group: "Integrations",
        description: "Change the status of a Jira issue (e.g., move to 'Done').",
        parameters: z.object({
            issueKey: z.string().describe("The Jira issue key (e.g., PROJ-123)"),
            status: z.string().describe("The target status name or transition name"),
        }),
        execute: async (params, context) => {
            const { handleTransitionJiraIssue } = await import("../../../../mcp/handlers.js");
            const result = await handleTransitionJiraIssue(params, context);
            return extractMcpText(result);
        }
    },
    update_jira_issue: {
        name: "update_jira_issue",

        idempotency: "idempotent",
        label: "Update Jira Issue",
        group: "Integrations",
        description: "Update fields of an existing Jira issue (summary, description, priority, etc.).",
        parameters: z.object({
            issueKey: z.string().describe("The Jira issue key"),
            summary: z.string().optional().describe("New summary for the issue"),
            description: z.string().optional().describe("New description for the issue"),
            priority: z.string().optional().describe("New priority name"),
            assignee: z.string().optional().describe("Jira Account ID of the assignee"),
            labels: z.array(z.string()).optional().describe("List of labels"),
        }),
        execute: async (params, context) => {
            const { handleUpdateJiraIssue } = await import("../../../../mcp/handlers.js");
            const result = await handleUpdateJiraIssue(params, context);
            return extractMcpText(result);
        }
    },
    create_jira_issue: {
        name: "create_jira_issue",

        idempotency: "none",
        label: "Create Jira Issue",
        group: "Integrations",
        description: "Create a new Jira issue with summary, type, and optional fields.",
        parameters: z.object({
            projectKey: z.string().describe("The Jira project key (e.g., PROJ)"),
            summary: z.string().describe("The issue summary"),
            issueType: z.string().describe("The issue type (e.g., Bug, Task)"),
            description: z.string().optional().describe("Detailed description"),
            assignee: z.string().optional().describe("Jira Account ID of the assignee"),
            priority: z.string().optional().describe("Priority name"),
            labels: z.array(z.string()).optional().describe("List of labels"),
        }),
        execute: async (params, context) => {
            const orgId = (context as any)?.organizationId ?? (context as any)?.orgId;
            const { isSaaSConfigured, writeKbArtifact } = await import("@domain/integrations/core/local-artifact.service.js");
            const ticketBody = `# ${params.summary}\n\n**Type:** ${params.issueType}\n**Project:** ${params.projectKey}\n${params.priority ? `**Priority:** ${params.priority}\n` : ""}${params.labels?.length ? `**Labels:** ${params.labels.join(", ")}\n` : ""}\n${params.description || ""}`;

            // Fast path: no usable Jira credential → persist the ticket to the knowledge
            // base (and graph / Memory Library) instead of failing and making the agent
            // retry an unreachable Jira until it exhausts its iteration budget.
            if (!(await isSaaSConfigured(orgId, "jira"))) {
                const art = await writeKbArtifact(orgId, {
                    title: `[Backlog] ${params.summary}`,
                    content: ticketBody,
                    sourceType: "backlog_ticket",
                    metadata: { projectKey: params.projectKey, issueType: params.issueType, labels: params.labels, missionId: (context as any)?.missionId },
                });
                return `Jira is not configured for this organization; created a local backlog ticket instead. Ticket LOCAL-${art.id} — "${params.summary}" stored in the knowledge base / Memory Library.`;
            }
            try {
                const { handleCreateJiraIssue } = await import("../../../../mcp/handlers.js");
                const result = await handleCreateJiraIssue(params, context);
                return extractMcpText(result);
            } catch (err: any) {
                const art = await writeKbArtifact(orgId, {
                    title: `[Backlog] ${params.summary}`,
                    content: `${ticketBody}\n\n_(Jira call failed: ${err.message})_`,
                    sourceType: "backlog_ticket",
                    metadata: { projectKey: params.projectKey, issueType: params.issueType, jiraError: err.message },
                });
                return `Jira call failed (${err.message}); created a local backlog ticket LOCAL-${art.id} in the knowledge base instead.`;
            }
        }
    },
};


