import { z } from "zod";
import type { ToolDefinition } from "./types.js";

async function getLinearToken(orgId?: number | null): Promise<string | null> {
    if (!orgId) return process.env.LINEAR_API_KEY || null;
    try {
        const { db } = await import("@server/database_service.js");
        const { credentials } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");
        const [cred] = await db
            .select()
            .from(credentials)
            .where(and(eq(credentials.organizationId, orgId), eq(credentials.type, "linear")))
            .limit(1);
        if (cred?.metadata) return cred.metadata as string;
    } catch {}
    return process.env.LINEAR_API_KEY || null;
}

async function linearGql(token: string, query: string, variables?: any) {
    const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
            Authorization: token,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Linear API error ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors.map((e: any) => e.message).join(", "));
    return json.data;
}

export const LINEAR_TOOLS: Record<string, ToolDefinition> = {
    linear_search_issues: {
        name: "linear_search_issues",

        idempotency: "read-safe",
        label: "Search Linear Issues",
        group: "Linear",
        description: "Search for Linear issues by title, status, assignee, or team.",
        parameters: z.object({
            query: z.string().optional().describe("Text to search in issue titles"),
            team_key: z.string().optional().describe("Team key (e.g. ENG) to filter by"),
            state: z.string().optional().describe("State filter (e.g. 'In Progress', 'Todo', 'Done')"),
            assignee_email: z.string().optional().describe("Filter by assignee email"),
            limit: z.number().min(1).max(50).default(20).optional(),
        }),
        execute: async (params, context) => {
            const token = await getLinearToken(context?.organizationId);
            if (!token) return "Linear is not configured. Add a Linear credential in Settings.";
            const filter: any = {};
            if (params.query) filter.title = { containsIgnoreCase: params.query };
            if (params.state) filter.state = { name: { eqIgnoreCase: params.state } };
            if (params.assignee_email) filter.assignee = { email: { eq: params.assignee_email } };
            if (params.team_key) filter.team = { key: { eqIgnoreCase: params.team_key } };
            const data = await linearGql(token, `
                query($filter: IssueFilter, $first: Int) {
                    issues(filter: $filter, first: $first) {
                        nodes { id identifier title state { name } assignee { email name } priority url createdAt updatedAt }
                    }
                }
            `, { filter, first: params.limit || 20 });
            return JSON.stringify(data.issues.nodes, null, 2);
        },
    },

    linear_get_issue: {
        name: "linear_get_issue",

        idempotency: "read-safe",
        label: "Get Linear Issue",
        group: "Linear",
        description: "Get full details of a Linear issue by its identifier (e.g. ENG-123).",
        parameters: z.object({
            identifier: z.string().describe("Linear issue identifier (e.g. ENG-123)"),
        }),
        execute: async (params, context) => {
            const token = await getLinearToken(context?.organizationId);
            if (!token) return "Linear is not configured. Add a Linear credential in Settings.";
            const data = await linearGql(token, `
                query($filter: IssueFilter) {
                    issues(filter: $filter, first: 1) {
                        nodes { id identifier title description state { name } assignee { email name } priority labels { nodes { name } } comments { nodes { body createdAt user { name } } } url createdAt updatedAt }
                    }
                }
            `, { filter: { identifier: { eq: params.identifier } } });
            const issue = data.issues.nodes[0];
            if (!issue) return `Issue ${params.identifier} not found.`;
            return JSON.stringify(issue, null, 2);
        },
    },

    linear_create_issue: {
        name: "linear_create_issue",

        idempotency: "none",
        label: "Create Linear Issue",
        group: "Linear",
        description: "Create a new Linear issue in a team.",
        parameters: z.object({
            team_key: z.string().describe("Team key (e.g. ENG)"),
            title: z.string().describe("Issue title"),
            description: z.string().optional().describe("Issue description (markdown supported)"),
            priority: z.number().min(0).max(4).optional().describe("Priority: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low"),
            assignee_email: z.string().optional().describe("Email of the assignee"),
        }),
        execute: async (params, context) => {
            const token = await getLinearToken(context?.organizationId);
            if (!token) return "Linear is not configured. Add a Linear credential in Settings.";
            const teamsData = await linearGql(token, `query { teams { nodes { id key } } }`);
            const team = teamsData.teams.nodes.find((t: any) => t.key.toUpperCase() === params.team_key.toUpperCase());
            if (!team) return `Team with key "${params.team_key}" not found.`;
            const input: any = { teamId: team.id, title: params.title };
            if (params.description) input.description = params.description;
            if (params.priority !== undefined) input.priority = params.priority;
            if (params.assignee_email) {
                const usersData = await linearGql(token, `query($email: String) { users(filter: { email: { eq: $email } }) { nodes { id } } }`, { email: params.assignee_email });
                if (usersData.users.nodes[0]) input.assigneeId = usersData.users.nodes[0].id;
            }
            const data = await linearGql(token, `
                mutation($input: IssueCreateInput!) {
                    issueCreate(input: $input) { success issue { id identifier title url } }
                }
            `, { input });
            return JSON.stringify(data.issueCreate.issue);
        },
    },

    linear_update_issue: {
        name: "linear_update_issue",

        idempotency: "idempotent",
        label: "Update Linear Issue",
        group: "Linear",
        description: "Update a Linear issue's title, description, state, or priority.",
        parameters: z.object({
            identifier: z.string().describe("Linear issue identifier (e.g. ENG-123)"),
            title: z.string().optional().describe("New title"),
            description: z.string().optional().describe("New description"),
            state_name: z.string().optional().describe("New state name (e.g. 'In Progress', 'Done')"),
            priority: z.number().min(0).max(4).optional().describe("New priority"),
        }),
        execute: async (params, context) => {
            const token = await getLinearToken(context?.organizationId);
            if (!token) return "Linear is not configured. Add a Linear credential in Settings.";
            const issueData = await linearGql(token, `
                query($filter: IssueFilter) {
                    issues(filter: $filter, first: 1) { nodes { id team { id states { nodes { id name } } } } }
                }
            `, { filter: { identifier: { eq: params.identifier } } });
            const issue = issueData.issues.nodes[0];
            if (!issue) return `Issue ${params.identifier} not found.`;
            const input: any = {};
            if (params.title) input.title = params.title;
            if (params.description) input.description = params.description;
            if (params.priority !== undefined) input.priority = params.priority;
            if (params.state_name) {
                const state = issue.team.states.nodes.find((s: any) => s.name.toLowerCase() === params.state_name!.toLowerCase());
                if (state) input.stateId = state.id;
            }
            const data = await linearGql(token, `
                mutation($id: String!, $input: IssueUpdateInput!) {
                    issueUpdate(id: $id, input: $input) { success issue { id identifier title state { name } url } }
                }
            `, { id: issue.id, input });
            return JSON.stringify(data.issueUpdate.issue);
        },
    },

    linear_add_comment: {
        name: "linear_add_comment",

        idempotency: "none",
        label: "Add Linear Comment",
        group: "Linear",
        description: "Add a comment to a Linear issue.",
        parameters: z.object({
            identifier: z.string().describe("Linear issue identifier (e.g. ENG-123)"),
            body: z.string().describe("Comment body (markdown supported)"),
        }),
        execute: async (params, context) => {
            const token = await getLinearToken(context?.organizationId);
            if (!token) return "Linear is not configured. Add a Linear credential in Settings.";
            const issueData = await linearGql(token, `
                query($filter: IssueFilter) { issues(filter: $filter, first: 1) { nodes { id } } }
            `, { filter: { identifier: { eq: params.identifier } } });
            const issue = issueData.issues.nodes[0];
            if (!issue) return `Issue ${params.identifier} not found.`;
            const data = await linearGql(token, `
                mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id url } } }
            `, { input: { issueId: issue.id, body: params.body } });
            return JSON.stringify({ success: data.commentCreate.success, url: data.commentCreate.comment?.url });
        },
    },
};
