import { z } from "zod";
import { randomBytes } from "crypto";
import type { ToolDefinition, ToolContext } from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SaasDiscoveryTools");

/**
 * What a project COULD bind, as opposed to what it already reaches.
 *
 * `list_saas_adapters` answers the second question from the database. This pair
 * answers the first by asking the remote system, so a room can say "list my
 * Confluence spaces" and get the real list off the connected site.
 *
 * The clients already existed — ConfluenceClient.getAllSpaces and
 * JiraClient.getAllProjects — with no agent tool exposing either, so the only
 * way to learn a space key was to already know it.
 *
 * These deliberately return a `saas_discovered_resources` payload rather than
 * assembly pieces: an unbound space is not part of the assembly, and turning
 * every space in the organization into a rail piece would bury the ones the
 * project actually uses. Binding is a separate, approved step.
 */

/** Marks which discovered resources this project has already bound. */
async function markAlreadyBound(
    orgId: number,
    projectId: number | null,
    kind: string,
    resources: Array<{ key: string }>,
): Promise<Set<string>> {
    if (projectId == null || resources.length === 0) return new Set();
    try {
        const { db } = await import("@server/database_service.js");
        const { projectSaasBindings } = await import("@shared/schema/index.js");
        const { and, eq } = await import("drizzle-orm");
        const rows = await db
            .select({ resourceKey: projectSaasBindings.resourceKey })
            .from(projectSaasBindings)
            .where(and(
                eq(projectSaasBindings.orgId, orgId),
                eq(projectSaasBindings.projectId, projectId),
                eq(projectSaasBindings.resourceKind, kind),
            ));
        return new Set(rows.map((r) => r.resourceKey));
    } catch (error: any) {
        // A failed lookup must not hide the discovery result; it only means we
        // cannot say which are already bound.
        logger.warn(`Could not read existing bindings: ${error?.message}`);
        return new Set();
    }
}

/** approverId carries an FK to users.id; crew passes the literal "crew" when no user is attached. */
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SAAS_DISCOVERY_TOOLS: Record<string, ToolDefinition> = {
    /**
     * Binding changes what a project can reach, so it is proposed and approved
     * rather than done inline.
     *
     * Every other assembly surface sends a scoped instruction and persists
     * nothing; this one writes a row. A human decides, for the same reason
     * propose_assembly_deployment does — and because the auto-approve gate is a
     * fixed set of predicates that would not catch a silent widening of reach.
     */
    propose_adapter_binding: {
        name: "propose_adapter_binding",
        idempotency: "idempotent",
        label: "Propose Binding a SaaS Resource to This Project",
        group: "Integrations",
        riskLevel: "medium",
        description:
            "Propose binding a Confluence space or Jira project to this project space. " +
            "Call list_confluence_spaces or list_jira_projects first and propose only a key that exists — " +
            "an invented key is rejected. Requires human approval before it takes effect.",
        parameters: z.object({
            resourceKind: z.enum(["confluence_space", "jira_project"])
                .describe("What is being bound"),
            resourceKey: z.string().min(1)
                .describe("The space key or Jira project key, exactly as discovery reported it"),
            resourceName: z.string().optional().describe("Human name, as discovered"),
            resourceType: z.string().optional().describe("Space type or Jira project type, as discovered"),
            externalId: z.string().optional(),
            webUrl: z.string().optional(),
            reason: z.string().describe("Why this project should reach that resource"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const orgId = context?.organizationId != null ? Number(context.organizationId) : null;
            const projectId = (context as any)?.projectId != null ? Number((context as any).projectId) : null;
            const projectKey = (context as any)?.projectKey ?? null;
            const requestedBy = context?.userId || "crew";

            if (orgId == null) return JSON.stringify({ error: "No organization in context." });
            if (projectId == null) {
                // Binding is meaningless without a project. Saying so beats
                // creating an approval a human cannot act on.
                return JSON.stringify({
                    error: "This room is not scoped to a project space, so there is nothing to bind the resource to. " +
                        "Open the room inside a project and try again.",
                });
            }

            let proposalId = Date.now();
            try {
                const { db } = await import("@server/database_service.js");
                const { approvalRequests } = await import("@shared/schema/index.js");
                const { v4: uuidv4 } = await import("uuid");

                const [inserted] = await db
                    .insert(approvalRequests)
                    .values({
                        executionId: `adapter_binding_${uuidv4()}`,
                        toolName: "propose_adapter_binding",
                        toolArgs: { ...params, kind: "adapter_binding", projectId, projectKey } as any,
                        approverType: "user",
                        ...(USER_ID_PATTERN.test(String(requestedBy)) ? { approverId: String(requestedBy) } : {}),
                        approverEmail: String(requestedBy),
                        status: "pending",
                        comments: params.reason,
                        organizationId: orgId,
                        token: randomBytes(16).toString("hex"),
                    })
                    .returning({ id: approvalRequests.id });
                if (inserted?.id) proposalId = inserted.id;
            } catch (dbErr: any) {
                logger.warn(`Failed to insert adapter binding approvalRequest: ${dbErr.message}`);
            }

            const label = params.resourceKind === "confluence_space" ? "Confluence space" : "Jira project";
            return JSON.stringify({
                type: "approval_request",
                kind: "adapter_binding",
                proposalId,
                title: `Bind ${label} "${params.resourceName || params.resourceKey}" to ${projectKey || "this project"}`,
                resourceKind: params.resourceKind,
                resourceKey: params.resourceKey,
                resourceName: params.resourceName ?? null,
                projectKey,
                reason: params.reason,
                // Stated on the proposal itself: approving this organizes access,
                // it does not restrict the credential, which stays on the connector.
                note: "Binding organizes which resources this project works with. Credentials remain on the connection, so this does not restrict what the token can read.",
            });
        },
    },

    /**
     * Reads a ServiceNow table's field definitions live, without writing a
     * snapshot. Capturing one is a write and happens on sync, or through the
     * schema-snapshot route — this is the read a room can make freely.
     */
    get_servicenow_schema: {
        name: "get_servicenow_schema",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get ServiceNow Table Schema",
        group: "Integrations",
        riskLevel: "low",
        description:
            "Read the field definitions of a ServiceNow table (incident, change_request, sc_task, …) from sys_dictionary. " +
            "Use when asked what fields a ServiceNow table has, or to compare against a captured snapshot.",
        parameters: z.object({
            tableName: z.string().default("incident").describe("ServiceNow table name, e.g. 'incident'"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const orgId = context?.organizationId != null ? Number(context.organizationId) : null;
            if (orgId == null) return JSON.stringify({ error: "No organization in context." });
            const tableName = String(params?.tableName || "incident");

            try {
                const { getServiceNowConfig } = await import("./servicenow.js");
                const config = await getServiceNowConfig(orgId);
                if (!config) {
                    return JSON.stringify({
                        error: `No ServiceNow connection for this organization. Connect ServiceNow first.`,
                    });
                }
                const { fetchServiceNowSchemaFields } = await import(
                    "@domain/integrations/servicenow-schema.service.js"
                );
                const fields = await fetchServiceNowSchemaFields(config, tableName);

                return JSON.stringify({
                    type: "assistant_table",
                    title: `ServiceNow · ${tableName} schema`,
                    description: `${fields.length} field${fields.length === 1 ? "" : "s"} from sys_dictionary`,
                    columns: [
                        { key: "id", label: "Field", type: "text" },
                        { key: "name", label: "Label", type: "text" },
                        { key: "type", label: "Type", type: "text" },
                        { key: "mandatory", label: "Mandatory", type: "text" },
                        { key: "custom", label: "Custom", type: "text" },
                    ],
                    rows: fields.map((field) => ({
                        id: field.id,
                        name: field.name,
                        type: field.schema.type ?? "—",
                        mandatory: field.schema.mandatory ? "yes" : "no",
                        custom: field.custom ? "yes" : "no",
                    })),
                });
            } catch (error: any) {
                return JSON.stringify({
                    error: `Could not read the ServiceNow schema: ${error?.message ?? "unknown error"}`,
                });
            }
        },
    },

    list_confluence_spaces: {
        name: "list_confluence_spaces",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Confluence Spaces",
        group: "Integrations",
        riskLevel: "low",
        description:
            "List the Confluence spaces available on the connected site, so one can be bound to this project. " +
            "Use when asked which spaces exist, or before binding a space.",
        parameters: z.object({}),
        execute: async (_params: any, context: ToolContext) => {
            const orgId = context?.organizationId != null ? Number(context.organizationId) : null;
            if (orgId == null) return JSON.stringify({ error: "No organization in context." });
            const projectId = (context as any)?.projectId != null ? Number((context as any).projectId) : null;

            const { getConfluenceClientForOrg } = await import(
                "@domain/integrations/atlassian-connector-bridge.js"
            );

            let spaces: any[];
            try {
                const client = await getConfluenceClientForOrg(orgId);
                spaces = await client.getAllSpaces();
            } catch (error: any) {
                // Say what actually failed. "No spaces" and "no Confluence
                // connection" are different answers, and reporting the first
                // when the second is true is how a room concludes the space
                // does not exist.
                return JSON.stringify({
                    error: `Could not reach Confluence: ${error?.message ?? "unknown error"}`,
                });
            }

            const bound = await markAlreadyBound(orgId, projectId, "confluence_space", spaces.map((s) => ({ key: s.key })));

            return JSON.stringify({
                type: "saas_discovered_resources",
                title: "Confluence spaces",
                resourceKind: "confluence_space",
                platform: "confluence",
                projectId,
                projectKey: (context as any)?.projectKey ?? null,
                resources: spaces.map((space) => ({
                    key: space.key,
                    name: space.name,
                    externalId: space.id != null ? String(space.id) : null,
                    resourceType: space.type ?? null,
                    webUrl: space?._links?.webui ?? null,
                    alreadyBound: bound.has(space.key),
                })),
            });
        },
    },

    list_jira_projects: {
        name: "list_jira_projects",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Jira Projects",
        group: "Integrations",
        riskLevel: "low",
        description:
            "List the Jira projects available on the connected site, so one can be bound to this project. " +
            "Use when asked which Jira projects exist, or before binding one.",
        parameters: z.object({}),
        execute: async (_params: any, context: ToolContext) => {
            const orgId = context?.organizationId != null ? Number(context.organizationId) : null;
            if (orgId == null) return JSON.stringify({ error: "No organization in context." });
            const projectId = (context as any)?.projectId != null ? Number((context as any).projectId) : null;

            const { getJiraClientForOrg } = await import(
                "@domain/integrations/atlassian-connector-bridge.js"
            );

            let jiraProjects: any[];
            try {
                const client = await getJiraClientForOrg(orgId);
                jiraProjects = await client.getAllProjects();
            } catch (error: any) {
                return JSON.stringify({
                    error: `Could not reach Jira: ${error?.message ?? "unknown error"}`,
                });
            }

            const bound = await markAlreadyBound(orgId, projectId, "jira_project", jiraProjects.map((p) => ({ key: p.key })));

            return JSON.stringify({
                type: "saas_discovered_resources",
                title: "Jira projects",
                resourceKind: "jira_project",
                platform: "jira",
                projectId,
                projectKey: (context as any)?.projectKey ?? null,
                resources: jiraProjects.map((project) => ({
                    key: project.key,
                    name: project.name,
                    externalId: project.id != null ? String(project.id) : null,
                    resourceType: project.projectTypeKey ?? null,
                    webUrl: null,
                    alreadyBound: bound.has(project.key),
                })),
            });
        },
    },
};
