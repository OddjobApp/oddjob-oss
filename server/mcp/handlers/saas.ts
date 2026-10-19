import { successResponse, errorResponse, getOrgContext, type ToolContext } from "./utils.js";
import {
    ListSaasConnectorsInput,
    SyncSaasConnectorInput,
    GetSaasConnectorSchemaInput,
    UpdateSaasSyncConfigInput,
    AddJiraCommentInput,
    TransitionJiraIssueInput,
    UpdateJiraIssueInput,
    CreateJiraIssueInput
} from "../tools/saas.js";
import { requireToolPermission } from "../auth.js";
import { auditService } from "@domain/audit/index.js";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://localhost:8001";

export async function handleListSaasConnectors(args: unknown, context?: ToolContext) {
    try {
        const input = ListSaasConnectorsInput.parse(args);

        // Permission Check
        if (context) {
            const perm = requireToolPermission("list_saas_connectors", (context as any).permissions || []);
            if (!perm.allowed) return errorResponse(perm.error);
        }

        const response = await fetch(`${PYTHON_SERVICE_URL}/api/saas/connectors`);
        if (!response.ok) {
            throw new Error(`Python service returned ${response.status}`);
        }
        const data = await response.json();

        return successResponse(data, "Fetched SaaS connectors status");
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleSyncSaasConnector(args: unknown, context?: ToolContext) {
    try {
        const input = SyncSaasConnectorInput.parse(args);

        // Permission Check
        if (context) {
            const perm = requireToolPermission("sync_saas_connector", (context as any).permissions || []);
            if (!perm.allowed) return errorResponse(perm.error);
        }

        const response = await fetch(`${PYTHON_SERVICE_URL}/api/saas/connectors/${input.platform}/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sync_type: input.syncType || "projects",
                parameters: {}
            }),
        });

        if (!response.ok) {
            throw new Error(`Python service returned ${response.status}`);
        }
        const data = await response.json();
        return successResponse(data, `Triggered ${input.syncType || 'default'} sync for ${input.platform}`);
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleGetSaasConnectorSchema(args: unknown, context?: ToolContext) {
    try {
        const input = GetSaasConnectorSchemaInput.parse(args);

        // Permission Check
        if (context) {
            const perm = requireToolPermission("get_saas_connector_schema", (context as any).permissions || []);
            if (!perm.allowed) return errorResponse(perm.error);
        }

        let url = `${PYTHON_SERVICE_URL}/api/saas/connectors/${input.platform}/schema`;
        if (input.projectKey) {
            url += `?project_key=${input.projectKey}`;
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Python service returned ${response.status}`);
        }
        const data = await response.json();

        return successResponse(data, `Fetched schema for ${input.platform}${input.projectKey ? ` (Project: ${input.projectKey})` : ''}`);
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleUpdateSaasSyncConfig(args: unknown, context?: ToolContext) {
    try {
        const input = UpdateSaasSyncConfigInput.parse(args);

        // Permission Check
        if (context) {
            const perm = requireToolPermission("update_saas_sync_config", (context as any).permissions || []);
            if (!perm.allowed) return errorResponse(perm.error);
        }

        const response = await fetch(`${PYTHON_SERVICE_URL}/api/saas/connectors/${input.platform}/bidirectional-sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input.config),
        });

        if (!response.ok) {
            throw new Error(`Python service returned ${response.status}`);
        }
        const data = await response.json();
        return successResponse(data, `Updated sync configuration for ${input.platform}`);
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleAddJiraComment(args: unknown, context?: ToolContext) {
    try {
        const input = AddJiraCommentInput.parse(args);
        const orgId = context ? (await getOrgContext(context)).organizationId : 1;

        if (context) {
            const perm = requireToolPermission("add_jira_comment", (context as any).permissions || []);
            if (!perm.allowed) return errorResponse(perm.error);
        }

        const response = await fetch(`${PYTHON_SERVICE_URL}/api/saas/jira/comment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                issue_key: input.issueKey,
                comment: input.comment,
                organization_id: orgId
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `Python service returned ${response.status}`);
        }

        const data = await response.json();

        // Audit Logging
        await auditService.log({
            action: "add_jira_comment",
            entityType: "saas_action",
            entityId: input.issueKey,
            userId: context?.userId || "mcp-agent",
            organizationId: orgId,
            metadata: { platform: "jira", issueKey: input.issueKey }
        }).catch(err => console.error("Audit log failed", err));

        return successResponse(data, `Added comment to Jira issue ${input.issueKey}`);
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleTransitionJiraIssue(args: unknown, context?: ToolContext) {
    try {
        const input = TransitionJiraIssueInput.parse(args);
        const orgId = context ? (await getOrgContext(context)).organizationId : 1;

        if (context) {
            const perm = requireToolPermission("transition_jira_issue", (context as any).permissions || []);
            if (!perm.allowed) return errorResponse(perm.error);
        }

        const response = await fetch(`${PYTHON_SERVICE_URL}/api/saas/jira/transition`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                issue_key: input.issueKey,
                status: input.status,
                organization_id: orgId
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `Python service returned ${response.status}`);
        }

        const data = await response.json();

        // Audit Logging
        await auditService.log({
            action: "transition_jira_issue",
            entityType: "saas_action",
            entityId: input.issueKey,
            userId: context?.userId || "mcp-agent",
            organizationId: orgId,
            metadata: { platform: "jira", issueKey: input.issueKey, status: input.status }
        }).catch(err => console.error("Audit log failed", err));

        return successResponse(data, `Transitioned Jira issue ${input.issueKey} to ${input.status}`);
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleUpdateJiraIssue(args: unknown, context?: ToolContext) {
    try {
        const input = UpdateJiraIssueInput.parse(args);
        const orgId = context ? (await getOrgContext(context)).organizationId : 1;

        if (context) {
            const perm = requireToolPermission("update_jira_issue", (context as any).permissions || []);
            if (!perm.allowed) return errorResponse(perm.error);
        }

        const response = await fetch(`${PYTHON_SERVICE_URL}/api/saas/jira/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                issue_key: input.issueKey,
                summary: input.summary,
                description: input.description,
                priority: input.priority,
                assignee: input.assignee,
                labels: input.labels,
                organization_id: orgId
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `Python service returned ${response.status}`);
        }

        const data = await response.json();

        // Audit Logging
        await auditService.log({
            action: "update_jira_issue",
            entityType: "saas_action",
            entityId: input.issueKey,
            userId: context?.userId || "mcp-agent",
            organizationId: orgId,
            metadata: {
                platform: "jira",
                issueKey: input.issueKey,
                fields: {
                    summary: input.summary,
                    priority: input.priority,
                    assignee: input.assignee,
                    labels: input.labels
                }
            }
        }).catch(err => console.error("Audit log failed", err));

        return successResponse(data, `Updated Jira issue ${input.issueKey}`);
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

export async function handleCreateJiraIssue(args: unknown, context?: ToolContext) {
    try {
        const input = CreateJiraIssueInput.parse(args);
        const orgId = context ? (await getOrgContext(context)).organizationId : 1;

        if (context) {
            const perm = requireToolPermission("saas:write", (context as any).permissions || []);
            if (!perm.allowed) return errorResponse(perm.error);
        }

        const response = await fetch(`${PYTHON_SERVICE_URL}/api/saas/jira/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                project_key: input.projectKey,
                summary: input.summary,
                issue_type: input.issueType,
                description: input.description,
                assignee: input.assignee,
                priority: input.priority,
                labels: input.labels,
                organization_id: orgId
            }),
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.detail || `Python service returned ${response.status}`);
        }

        const data = await response.json();

        // Audit Logging
        await auditService.log({
            action: "create_jira_issue",
            entityType: "saas_action",
            entityId: data.result?.key || "new",
            userId: context?.userId || "mcp-agent",
            organizationId: orgId,
            metadata: {
                platform: "jira",
                projectKey: input.projectKey,
                summary: input.summary,
                issueType: input.issueType
            }
        }).catch(err => console.error("Audit log failed", err));

        return successResponse(data, `Created Jira issue ${data.result?.key || ''}`);
    } catch (error: any) {
        return errorResponse(error.message);
    }
}

