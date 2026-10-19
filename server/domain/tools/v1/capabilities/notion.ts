import { z } from "zod";
import type { ToolDefinition } from "./types.js";

async function getNotionToken(orgId?: number | null): Promise<string | null> {
    if (!orgId) return process.env.NOTION_TOKEN || null;
    try {
        const { db } = await import("@server/database_service.js");
        const { credentials } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");
        const [cred] = await db
            .select()
            .from(credentials)
            .where(and(eq(credentials.organizationId, orgId), eq(credentials.type, "notion")))
            .limit(1);
        if (cred?.metadata) return cred.metadata as string;
    } catch {}
    return process.env.NOTION_TOKEN || null;
}

async function notionRequest(path: string, method: string, token: string, body?: any) {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Notion API error ${res.status}: ${err}`);
    }
    return res.json();
}

export const NOTION_TOOLS: Record<string, ToolDefinition> = {
    notion_search: {
        name: "notion_search",

        idempotency: "read-safe",
        label: "Search Notion",
        group: "Notion",
        description: "Search pages and databases in Notion by keyword.",
        parameters: z.object({
            query: z.string().describe("Search keyword"),
            filter_type: z.enum(["page", "database"]).optional().describe("Filter results by type"),
        }),
        execute: async (params, context) => {
            const token = await getNotionToken(context?.organizationId);
            if (!token) return "Notion is not configured. Add a Notion credential in Settings.";
            const body: any = { query: params.query, page_size: 20 };
            if (params.filter_type) body.filter = { value: params.filter_type, property: "object" };
            const data = await notionRequest("/search", "POST", token, body);
            const results = (data.results || []).map((r: any) => ({
                id: r.id,
                type: r.object,
                title: r.properties?.title?.title?.[0]?.plain_text || r.title?.[0]?.plain_text || "Untitled",
                url: r.url,
                lastEdited: r.last_edited_time,
            }));
            return JSON.stringify(results, null, 2);
        },
    },

    notion_get_page: {
        name: "notion_get_page",

        idempotency: "read-safe",
        label: "Get Notion Page",
        group: "Notion",
        description: "Retrieve the content of a Notion page by its ID.",
        parameters: z.object({
            page_id: z.string().describe("Notion page ID (UUID format)"),
        }),
        execute: async (params, context) => {
            const token = await getNotionToken(context?.organizationId);
            if (!token) return "Notion is not configured. Add a Notion credential in Settings.";
            const [page, blocks] = await Promise.all([
                notionRequest(`/pages/${params.page_id}`, "GET", token),
                notionRequest(`/blocks/${params.page_id}/children?page_size=100`, "GET", token),
            ]);
            const title = page.properties?.title?.title?.[0]?.plain_text || "Untitled";
            const content = (blocks.results || [])
                .map((b: any) => {
                    const text = b[b.type]?.rich_text?.map((t: any) => t.plain_text).join("") || "";
                    return text;
                })
                .filter(Boolean)
                .join("\n");
            return `# ${title}\n\n${content}`;
        },
    },

    notion_create_page: {
        name: "notion_create_page",

        idempotency: "none",
        label: "Create Notion Page",
        group: "Notion",
        description: "Create a new page in a Notion database or as a child of another page.",
        parameters: z.object({
            parent_id: z.string().describe("ID of parent page or database"),
            parent_type: z.enum(["page", "database"]).describe("Whether the parent is a page or database"),
            title: z.string().describe("Page title"),
            content: z.string().optional().describe("Page body content as plain text"),
        }),
        execute: async (params, context) => {
            const token = await getNotionToken(context?.organizationId);
            if (!token) return "Notion is not configured. Add a Notion credential in Settings.";
            const parent = params.parent_type === "database"
                ? { database_id: params.parent_id }
                : { page_id: params.parent_id };
            const body: any = {
                parent,
                properties: {
                    title: { title: [{ text: { content: params.title } }] },
                },
            };
            if (params.content) {
                body.children = [{
                    object: "block",
                    type: "paragraph",
                    paragraph: { rich_text: [{ type: "text", text: { content: params.content } }] },
                }];
            }
            const page = await notionRequest("/pages", "POST", token, body);
            return JSON.stringify({ id: page.id, url: page.url, title: params.title });
        },
    },

    notion_update_page: {
        name: "notion_update_page",

        idempotency: "idempotent",
        label: "Update Notion Page",
        group: "Notion",
        description: "Update the title or properties of an existing Notion page.",
        parameters: z.object({
            page_id: z.string().describe("Notion page ID"),
            title: z.string().optional().describe("New title for the page"),
            archived: z.boolean().optional().describe("Set to true to archive the page"),
        }),
        execute: async (params, context) => {
            const token = await getNotionToken(context?.organizationId);
            if (!token) return "Notion is not configured. Add a Notion credential in Settings.";
            const body: any = {};
            if (params.title) body.properties = { title: { title: [{ text: { content: params.title } }] } };
            if (params.archived !== undefined) body.archived = params.archived;
            const page = await notionRequest(`/pages/${params.page_id}`, "PATCH", token, body);
            return JSON.stringify({ id: page.id, url: page.url, archived: page.archived });
        },
    },

    notion_query_database: {
        name: "notion_query_database",

        idempotency: "read-safe",
        label: "Query Notion Database",
        group: "Notion",
        description: "Query rows from a Notion database with optional filters.",
        parameters: z.object({
            database_id: z.string().describe("Notion database ID"),
            filter: z.record(z.any()).optional().describe("Notion filter object (see Notion API docs)"),
            page_size: z.number().min(1).max(100).default(20).optional().describe("Number of results to return"),
        }),
        execute: async (params, context) => {
            const token = await getNotionToken(context?.organizationId);
            if (!token) return "Notion is not configured. Add a Notion credential in Settings.";
            const body: any = { page_size: params.page_size || 20 };
            if (params.filter) body.filter = params.filter;
            const data = await notionRequest(`/databases/${params.database_id}/query`, "POST", token, body);
            const rows = (data.results || []).map((r: any) => {
                const props: Record<string, any> = {};
                for (const [key, val] of Object.entries<any>(r.properties || {})) {
                    if (val.title) props[key] = val.title.map((t: any) => t.plain_text).join("");
                    else if (val.rich_text) props[key] = val.rich_text.map((t: any) => t.plain_text).join("");
                    else if (val.number !== undefined) props[key] = val.number;
                    else if (val.select) props[key] = val.select?.name;
                    else if (val.multi_select) props[key] = val.multi_select.map((s: any) => s.name);
                    else if (val.date) props[key] = val.date?.start;
                    else if (val.checkbox !== undefined) props[key] = val.checkbox;
                }
                return { id: r.id, url: r.url, properties: props };
            });
            return JSON.stringify(rows, null, 2);
        },
    },
};
