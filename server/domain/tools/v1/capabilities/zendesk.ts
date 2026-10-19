import { z } from "zod";
import type { ToolDefinition } from "./types.js";

async function getZendeskConfig(orgId?: number | null): Promise<{ subdomain: string; email: string; apiToken: string } | null> {
    if (!orgId) return null;
    try {
        const { db } = await import("@server/database_service.js");
        const { credentials } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");
        const [cred] = await db
            .select()
            .from(credentials)
            .where(and(eq(credentials.organizationId, orgId), eq(credentials.type, "zendesk")))
            .limit(1);
        if (cred?.metadata) return cred.metadata as any;
    } catch {}
    return null;
}

async function zdRequest(config: { subdomain: string; email: string; apiToken: string }, path: string, method = "GET", body?: any) {
    const auth = Buffer.from(`${config.email}/token:${config.apiToken}`).toString("base64");
    const res = await fetch(`https://${config.subdomain}.zendesk.com/api/v2${path}`, {
        method,
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Zendesk API error ${res.status}: ${err}`);
    }
    if (res.status === 204) return { success: true };
    return res.json();
}

export const ZENDESK_TOOLS: Record<string, ToolDefinition> = {
    zendesk_search_tickets: {
        name: "zendesk_search_tickets",

        idempotency: "read-safe",
        label: "Search Zendesk Tickets",
        group: "Zendesk",
        description: "Search Zendesk support tickets by query string. Supports Zendesk search syntax.",
        parameters: z.object({
            query: z.string().describe("Search query (e.g. 'status:open priority:high', 'subject:billing')"),
            per_page: z.number().min(1).max(100).default(20).optional(),
        }),
        execute: async (params, context) => {
            const config = await getZendeskConfig(context?.organizationId);
            if (!config) return "Zendesk is not configured. Add a Zendesk credential in Settings.";
            const encoded = encodeURIComponent(params.query);
            const data = await zdRequest(config, `/search.json?query=type:ticket ${encoded}&per_page=${params.per_page || 20}`);
            const tickets = (data.results || []).map((t: any) => ({
                id: t.id,
                subject: t.subject,
                status: t.status,
                priority: t.priority,
                requester_id: t.requester_id,
                assignee_id: t.assignee_id,
                created_at: t.created_at,
                updated_at: t.updated_at,
                url: `https://${config.subdomain}.zendesk.com/agent/tickets/${t.id}`,
            }));
            return JSON.stringify(tickets, null, 2);
        },
    },

    zendesk_get_ticket: {
        name: "zendesk_get_ticket",

        idempotency: "read-safe",
        label: "Get Zendesk Ticket",
        group: "Zendesk",
        description: "Get details and comments for a specific Zendesk ticket by ID.",
        parameters: z.object({
            ticket_id: z.number().describe("Zendesk ticket ID"),
        }),
        execute: async (params, context) => {
            const config = await getZendeskConfig(context?.organizationId);
            if (!config) return "Zendesk is not configured. Add a Zendesk credential in Settings.";
            const [ticket, comments] = await Promise.all([
                zdRequest(config, `/tickets/${params.ticket_id}.json`),
                zdRequest(config, `/tickets/${params.ticket_id}/comments.json`),
            ]);
            const t = ticket.ticket;
            const commentList = (comments.comments || []).map((c: any) => ({
                author_id: c.author_id,
                body: c.body?.substring(0, 500),
                created_at: c.created_at,
                public: c.public,
            }));
            return JSON.stringify({ ...t, comments: commentList }, null, 2);
        },
    },

    zendesk_create_ticket: {
        name: "zendesk_create_ticket",

        idempotency: "none",
        label: "Create Zendesk Ticket",
        group: "Zendesk",
        description: "Create a new Zendesk support ticket.",
        parameters: z.object({
            subject: z.string().describe("Ticket subject"),
            body: z.string().describe("Ticket description/body"),
            requester_email: z.string().email().optional().describe("Email of the requester"),
            priority: z.enum(["low", "normal", "high", "urgent"]).optional().default("normal"),
            tags: z.array(z.string()).optional().describe("Tags to apply to the ticket"),
        }),
        execute: async (params, context) => {
            const config = await getZendeskConfig(context?.organizationId);
            if (!config) return "Zendesk is not configured. Add a Zendesk credential in Settings.";
            const ticketData: any = {
                subject: params.subject,
                comment: { body: params.body },
                priority: params.priority || "normal",
            };
            if (params.requester_email) ticketData.requester = { email: params.requester_email };
            if (params.tags?.length) ticketData.tags = params.tags;
            const data = await zdRequest(config, "/tickets.json", "POST", { ticket: ticketData });
            return JSON.stringify({ id: data.ticket.id, subject: data.ticket.subject, status: data.ticket.status });
        },
    },

    zendesk_update_ticket: {
        name: "zendesk_update_ticket",

        idempotency: "idempotent",
        label: "Update Zendesk Ticket",
        group: "Zendesk",
        description: "Update a Zendesk ticket status, priority, or add a comment.",
        parameters: z.object({
            ticket_id: z.number().describe("Zendesk ticket ID"),
            status: z.enum(["new", "open", "pending", "hold", "solved", "closed"]).optional(),
            priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
            comment: z.string().optional().describe("Comment to add (set public=false for internal note)"),
            public_comment: z.boolean().optional().default(true).describe("Whether the comment is public"),
        }),
        execute: async (params, context) => {
            const config = await getZendeskConfig(context?.organizationId);
            if (!config) return "Zendesk is not configured. Add a Zendesk credential in Settings.";
            const ticketData: any = {};
            if (params.status) ticketData.status = params.status;
            if (params.priority) ticketData.priority = params.priority;
            if (params.comment) ticketData.comment = { body: params.comment, public: params.public_comment ?? true };
            const data = await zdRequest(config, `/tickets/${params.ticket_id}.json`, "PUT", { ticket: ticketData });
            return JSON.stringify({ id: data.ticket.id, status: data.ticket.status, updated: true });
        },
    },
};
