import { z } from "zod";
import type { ToolDefinition } from "./types.js";

async function getAirtableToken(orgId?: number | null): Promise<string | null> {
    if (!orgId) return process.env.AIRTABLE_API_KEY || null;
    try {
        const { db } = await import("@server/database_service.js");
        const { credentials } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");
        const [cred] = await db
            .select()
            .from(credentials)
            .where(and(eq(credentials.organizationId, orgId), eq(credentials.type, "airtable")))
            .limit(1);
        if (cred?.metadata) return cred.metadata as string;
    } catch {}
    return process.env.AIRTABLE_API_KEY || null;
}

async function atRequest(token: string, path: string, method = "GET", body?: any) {
    const res = await fetch(`https://api.airtable.com/v0${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Airtable API error ${res.status}: ${await res.text()}`);
    if (res.status === 204) return { success: true };
    return res.json();
}

export const AIRTABLE_TOOLS: Record<string, ToolDefinition> = {
    airtable_list_records: {
        name: "airtable_list_records",

        idempotency: "read-safe",
        label: "List Airtable Records",
        group: "Airtable",
        description: "List records from an Airtable table with optional filtering and field selection.",
        parameters: z.object({
            base_id: z.string().describe("Airtable base ID (appXXXXXXXX)"),
            table_name: z.string().describe("Table name or table ID"),
            filter_formula: z.string().optional().describe("Airtable formula to filter records (e.g. \"{Status}='Active'\")"),
            fields: z.array(z.string()).optional().describe("Specific field names to return"),
            max_records: z.number().min(1).max(100).default(20).optional(),
        }),
        execute: async (params, context) => {
            const token = await getAirtableToken(context?.organizationId);
            if (!token) return "Airtable is not configured. Add an Airtable credential in Settings.";
            const queryParams = new URLSearchParams();
            queryParams.set("pageSize", String(params.max_records || 20));
            if (params.filter_formula) queryParams.set("filterByFormula", params.filter_formula);
            if (params.fields?.length) params.fields.forEach((f: any) => queryParams.append("fields[]", f));
            const encoded = encodeURIComponent(params.table_name);
            const data = await atRequest(token, `/${params.base_id}/${encoded}?${queryParams.toString()}`);
            return JSON.stringify((data.records || []).map((r: any) => ({ id: r.id, ...r.fields })), null, 2);
        },
    },

    airtable_get_record: {
        name: "airtable_get_record",

        idempotency: "read-safe",
        label: "Get Airtable Record",
        group: "Airtable",
        description: "Get a single record from an Airtable table by its record ID.",
        parameters: z.object({
            base_id: z.string().describe("Airtable base ID"),
            table_name: z.string().describe("Table name or table ID"),
            record_id: z.string().describe("Airtable record ID (recXXXXXXXX)"),
        }),
        execute: async (params, context) => {
            const token = await getAirtableToken(context?.organizationId);
            if (!token) return "Airtable is not configured. Add an Airtable credential in Settings.";
            const encoded = encodeURIComponent(params.table_name);
            const data = await atRequest(token, `/${params.base_id}/${encoded}/${params.record_id}`);
            return JSON.stringify({ id: data.id, ...data.fields }, null, 2);
        },
    },

    airtable_create_record: {
        name: "airtable_create_record",

        idempotency: "none",
        label: "Create Airtable Record",
        group: "Airtable",
        description: "Create a new record in an Airtable table.",
        parameters: z.object({
            base_id: z.string().describe("Airtable base ID"),
            table_name: z.string().describe("Table name or table ID"),
            fields: z.record(z.any()).describe("Field values as key-value pairs matching the table's field names"),
        }),
        execute: async (params, context) => {
            const token = await getAirtableToken(context?.organizationId);
            if (!token) return "Airtable is not configured. Add an Airtable credential in Settings.";
            const encoded = encodeURIComponent(params.table_name);
            const data = await atRequest(token, `/${params.base_id}/${encoded}`, "POST", { fields: params.fields });
            return JSON.stringify({ id: data.id, ...data.fields });
        },
    },

    airtable_update_record: {
        name: "airtable_update_record",

        idempotency: "idempotent",
        label: "Update Airtable Record",
        group: "Airtable",
        description: "Update fields on an existing Airtable record.",
        parameters: z.object({
            base_id: z.string().describe("Airtable base ID"),
            table_name: z.string().describe("Table name or table ID"),
            record_id: z.string().describe("Airtable record ID (recXXXXXXXX)"),
            fields: z.record(z.any()).describe("Fields to update as key-value pairs"),
        }),
        execute: async (params, context) => {
            const token = await getAirtableToken(context?.organizationId);
            if (!token) return "Airtable is not configured. Add an Airtable credential in Settings.";
            const encoded = encodeURIComponent(params.table_name);
            const data = await atRequest(token, `/${params.base_id}/${encoded}/${params.record_id}`, "PATCH", { fields: params.fields });
            return JSON.stringify({ id: data.id, ...data.fields });
        },
    },

    airtable_delete_record: {
        name: "airtable_delete_record",

        idempotency: "idempotent",
        label: "Delete Airtable Record",
        group: "Airtable",
        description: "Delete a record from an Airtable table. Always confirm with user before executing.",
        parameters: z.object({
            base_id: z.string().describe("Airtable base ID"),
            table_name: z.string().describe("Table name or table ID"),
            record_id: z.string().describe("Airtable record ID (recXXXXXXXX)"),
        }),
        execute: async (params, context) => {
            const token = await getAirtableToken(context?.organizationId);
            if (!token) return "Airtable is not configured. Add an Airtable credential in Settings.";
            const encoded = encodeURIComponent(params.table_name);
            await atRequest(token, `/${params.base_id}/${encoded}/${params.record_id}`, "DELETE");
            return JSON.stringify({ deleted: true, id: params.record_id });
        },
    },
};
