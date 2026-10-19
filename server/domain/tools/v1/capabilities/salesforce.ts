import { z } from "zod";
import type { ToolDefinition } from "./types.js";

async function getSalesforceToken(orgId?: number | null): Promise<{ instanceUrl: string; accessToken: string } | null> {
    if (!orgId) return null;
    try {
        const { db } = await import("@server/database_service.js");
        const { credentials } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");
        const [cred] = await db
            .select()
            .from(credentials)
            .where(and(eq(credentials.organizationId, orgId), eq(credentials.type, "salesforce")))
            .limit(1);
        if (cred?.metadata) {
            const val = cred.metadata as any;
            return { instanceUrl: val.instanceUrl, accessToken: val.accessToken };
        }
    } catch {}
    return null;
}

async function sfRequest(instanceUrl: string, token: string, path: string, method = "GET", body?: any) {
    const res = await fetch(`${instanceUrl}/services/data/v59.0${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Salesforce API error ${res.status}: ${err}`);
    }
    if (res.status === 204) return { success: true };
    return res.json();
}

export const SALESFORCE_TOOLS: Record<string, ToolDefinition> = {
    salesforce_query: {
        name: "salesforce_query",

        idempotency: "read-safe",
        label: "Salesforce SOQL Query",
        group: "Salesforce",
        description: "Run a SOQL query against Salesforce to retrieve records (Leads, Opportunities, Contacts, Accounts, etc.).",
        parameters: z.object({
            soql: z.string().describe("SOQL query string, e.g. SELECT Id, Name FROM Account LIMIT 10"),
        }),
        execute: async (params, context) => {
            const auth = await getSalesforceToken(context?.organizationId);
            if (!auth) return "Salesforce is not configured. Add a Salesforce credential in Settings.";
            const encoded = encodeURIComponent(params.soql);
            const data = await sfRequest(auth.instanceUrl, auth.accessToken, `/query?q=${encoded}`);
            return JSON.stringify({ totalSize: data.totalSize, records: data.records }, null, 2);
        },
    },

    salesforce_create_record: {
        name: "salesforce_create_record",

        idempotency: "none",
        label: "Create Salesforce Record",
        group: "Salesforce",
        description: "Create a new Salesforce record (Lead, Contact, Opportunity, Account, Case, etc.).",
        parameters: z.object({
            object_type: z.string().describe("Salesforce object API name (e.g. Lead, Contact, Opportunity)"),
            fields: z.record(z.any()).describe("Field values as key-value pairs"),
        }),
        execute: async (params, context) => {
            const auth = await getSalesforceToken(context?.organizationId);
            if (!auth) return "Salesforce is not configured. Add a Salesforce credential in Settings.";
            const data = await sfRequest(auth.instanceUrl, auth.accessToken, `/sobjects/${params.object_type}`, "POST", params.fields);
            return JSON.stringify(data);
        },
    },

    salesforce_update_record: {
        name: "salesforce_update_record",

        idempotency: "idempotent",
        label: "Update Salesforce Record",
        group: "Salesforce",
        description: "Update fields on an existing Salesforce record.",
        parameters: z.object({
            object_type: z.string().describe("Salesforce object API name (e.g. Lead, Opportunity)"),
            record_id: z.string().describe("Salesforce record ID (18-char)"),
            fields: z.record(z.any()).describe("Fields to update as key-value pairs"),
        }),
        execute: async (params, context) => {
            const auth = await getSalesforceToken(context?.organizationId);
            if (!auth) return "Salesforce is not configured. Add a Salesforce credential in Settings.";
            await sfRequest(auth.instanceUrl, auth.accessToken, `/sobjects/${params.object_type}/${params.record_id}`, "PATCH", params.fields);
            return JSON.stringify({ success: true, id: params.record_id });
        },
    },

    salesforce_get_record: {
        name: "salesforce_get_record",

        idempotency: "read-safe",
        label: "Get Salesforce Record",
        group: "Salesforce",
        description: "Retrieve a specific Salesforce record by ID.",
        parameters: z.object({
            object_type: z.string().describe("Salesforce object API name (e.g. Account, Contact)"),
            record_id: z.string().describe("Salesforce record ID"),
            fields: z.array(z.string()).optional().describe("Specific fields to retrieve (defaults to all)"),
        }),
        execute: async (params, context) => {
            const auth = await getSalesforceToken(context?.organizationId);
            if (!auth) return "Salesforce is not configured. Add a Salesforce credential in Settings.";
            const fieldParam = params.fields?.length ? `?fields=${params.fields.join(",")}` : "";
            const data = await sfRequest(auth.instanceUrl, auth.accessToken, `/sobjects/${params.object_type}/${params.record_id}${fieldParam}`);
            return JSON.stringify(data, null, 2);
        },
    },

    salesforce_search: {
        name: "salesforce_search",

        idempotency: "read-safe",
        label: "Salesforce SOSL Search",
        group: "Salesforce",
        description: "Full-text search across multiple Salesforce objects using SOSL.",
        parameters: z.object({
            search_term: z.string().describe("Search term to find across Salesforce records"),
            objects: z.array(z.string()).optional().default(["Lead", "Contact", "Account", "Opportunity"]).describe("Object types to search"),
        }),
        execute: async (params, context) => {
            const auth = await getSalesforceToken(context?.organizationId);
            if (!auth) return "Salesforce is not configured. Add a Salesforce credential in Settings.";
            const objs = (params.objects || ["Lead", "Contact", "Account", "Opportunity"]).join(", ");
            const sosl = `FIND {${params.search_term}} IN ALL FIELDS RETURNING ${objs}`;
            const encoded = encodeURIComponent(sosl);
            const data = await sfRequest(auth.instanceUrl, auth.accessToken, `/search?q=${encoded}`);
            return JSON.stringify(data.searchRecords || [], null, 2);
        },
    },
};
