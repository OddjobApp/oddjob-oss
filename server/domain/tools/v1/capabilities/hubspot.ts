import { z } from "zod";
import type { ToolDefinition } from "./types.js";

async function getHubspotToken(orgId?: number | null): Promise<string | null> {
    if (!orgId) return process.env.HUBSPOT_API_KEY || null;
    try {
        const { db } = await import("@server/database_service.js");
        const { credentials } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");
        const [cred] = await db
            .select()
            .from(credentials)
            .where(and(eq(credentials.organizationId, orgId), eq(credentials.type, "hubspot")))
            .limit(1);
        if (cred?.metadata) return cred.metadata as string;
    } catch {}
    return process.env.HUBSPOT_API_KEY || null;
}

async function hsRequest(token: string, path: string, method = "GET", body?: any) {
    const res = await fetch(`https://api.hubapi.com${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HubSpot API error ${res.status}: ${await res.text()}`);
    if (res.status === 204) return { success: true };
    return res.json();
}

export const HUBSPOT_TOOLS: Record<string, ToolDefinition> = {
    hubspot_search_contacts: {
        name: "hubspot_search_contacts",

        idempotency: "read-safe",
        label: "Search HubSpot Contacts",
        group: "HubSpot",
        description: "Search HubSpot contacts by email, name, or company.",
        parameters: z.object({
            query: z.string().describe("Search term (email, first/last name, or company)"),
            limit: z.number().min(1).max(100).default(10).optional(),
        }),
        execute: async (params, context) => {
            const token = await getHubspotToken(context?.organizationId);
            if (!token) return "HubSpot is not configured. Add a HubSpot credential in Settings.";
            const data = await hsRequest(token, "/crm/v3/objects/contacts/search", "POST", {
                query: params.query,
                limit: params.limit || 10,
                properties: ["firstname", "lastname", "email", "company", "phone", "lifecyclestage"],
            });
            return JSON.stringify(data.results || [], null, 2);
        },
    },

    hubspot_create_contact: {
        name: "hubspot_create_contact",

        idempotency: "none",
        label: "Create HubSpot Contact",
        group: "HubSpot",
        description: "Create a new contact in HubSpot CRM.",
        parameters: z.object({
            email: z.string().email().describe("Contact email address"),
            firstname: z.string().optional().describe("First name"),
            lastname: z.string().optional().describe("Last name"),
            company: z.string().optional().describe("Company name"),
            phone: z.string().optional().describe("Phone number"),
            lifecyclestage: z.enum(["subscriber", "lead", "marketingqualifiedlead", "salesqualifiedlead", "opportunity", "customer"]).optional(),
        }),
        execute: async (params, context) => {
            const token = await getHubspotToken(context?.organizationId);
            if (!token) return "HubSpot is not configured. Add a HubSpot credential in Settings.";
            const properties: Record<string, string> = { email: params.email };
            if (params.firstname) properties.firstname = params.firstname;
            if (params.lastname) properties.lastname = params.lastname;
            if (params.company) properties.company = params.company;
            if (params.phone) properties.phone = params.phone;
            if (params.lifecyclestage) properties.lifecyclestage = params.lifecyclestage;
            const data = await hsRequest(token, "/crm/v3/objects/contacts", "POST", { properties });
            return JSON.stringify({ id: data.id, email: params.email, created: true });
        },
    },

    hubspot_create_deal: {
        name: "hubspot_create_deal",

        idempotency: "none",
        label: "Create HubSpot Deal",
        group: "HubSpot",
        description: "Create a new deal in HubSpot CRM pipeline.",
        parameters: z.object({
            dealname: z.string().describe("Deal name"),
            amount: z.number().optional().describe("Deal value in USD"),
            dealstage: z.string().optional().describe("Pipeline stage (e.g. 'appointmentscheduled', 'closedwon')"),
            closedate: z.string().optional().describe("Expected close date (ISO 8601, e.g. 2026-12-31)"),
            contact_id: z.string().optional().describe("HubSpot contact ID to associate"),
        }),
        execute: async (params, context) => {
            const token = await getHubspotToken(context?.organizationId);
            if (!token) return "HubSpot is not configured. Add a HubSpot credential in Settings.";
            const properties: Record<string, any> = { dealname: params.dealname };
            if (params.amount !== undefined) properties.amount = params.amount;
            if (params.dealstage) properties.dealstage = params.dealstage;
            if (params.closedate) properties.closedate = new Date(params.closedate).getTime();
            const dealData = await hsRequest(token, "/crm/v3/objects/deals", "POST", { properties });
            if (params.contact_id) {
                await hsRequest(token, `/crm/v3/objects/deals/${dealData.id}/associations/contacts/${params.contact_id}/deal_to_contact`, "PUT");
            }
            return JSON.stringify({ id: dealData.id, dealname: params.dealname, created: true });
        },
    },

    hubspot_update_deal: {
        name: "hubspot_update_deal",

        idempotency: "idempotent",
        label: "Update HubSpot Deal",
        group: "HubSpot",
        description: "Update a HubSpot deal's stage, amount, or close date.",
        parameters: z.object({
            deal_id: z.string().describe("HubSpot deal ID"),
            dealstage: z.string().optional().describe("New pipeline stage"),
            amount: z.number().optional().describe("New deal value"),
            closedate: z.string().optional().describe("New close date (ISO 8601)"),
        }),
        execute: async (params, context) => {
            const token = await getHubspotToken(context?.organizationId);
            if (!token) return "HubSpot is not configured. Add a HubSpot credential in Settings.";
            const properties: Record<string, any> = {};
            if (params.dealstage) properties.dealstage = params.dealstage;
            if (params.amount !== undefined) properties.amount = params.amount;
            if (params.closedate) properties.closedate = new Date(params.closedate).getTime();
            await hsRequest(token, `/crm/v3/objects/deals/${params.deal_id}`, "PATCH", { properties });
            return JSON.stringify({ id: params.deal_id, updated: true });
        },
    },

    hubspot_search_deals: {
        name: "hubspot_search_deals",

        idempotency: "read-safe",
        label: "Search HubSpot Deals",
        group: "HubSpot",
        description: "Search HubSpot deals by name or pipeline stage.",
        parameters: z.object({
            query: z.string().optional().describe("Text to search in deal name"),
            dealstage: z.string().optional().describe("Filter by pipeline stage"),
            limit: z.number().min(1).max(100).default(10).optional(),
        }),
        execute: async (params, context) => {
            const token = await getHubspotToken(context?.organizationId);
            if (!token) return "HubSpot is not configured. Add a HubSpot credential in Settings.";
            const body: any = {
                limit: params.limit || 10,
                properties: ["dealname", "amount", "dealstage", "closedate", "pipeline"],
            };
            if (params.query) body.query = params.query;
            if (params.dealstage) {
                body.filterGroups = [{ filters: [{ propertyName: "dealstage", operator: "EQ", value: params.dealstage }] }];
            }
            const data = await hsRequest(token, "/crm/v3/objects/deals/search", "POST", body);
            return JSON.stringify(data.results || [], null, 2);
        },
    },

    hubspot_log_activity: {
        name: "hubspot_log_activity",

        idempotency: "none",
        label: "Log HubSpot Activity",
        group: "HubSpot",
        description: "Log a note or activity against a HubSpot contact or deal.",
        parameters: z.object({
            body: z.string().describe("Note content"),
            contact_id: z.string().optional().describe("HubSpot contact ID to associate"),
            deal_id: z.string().optional().describe("HubSpot deal ID to associate"),
        }),
        execute: async (params, context) => {
            const token = await getHubspotToken(context?.organizationId);
            if (!token) return "HubSpot is not configured. Add a HubSpot credential in Settings.";
            const noteData = await hsRequest(token, "/crm/v3/objects/notes", "POST", {
                properties: { hs_note_body: params.body, hs_timestamp: Date.now() },
            });
            if (params.contact_id) {
                await hsRequest(token, `/crm/v3/objects/notes/${noteData.id}/associations/contacts/${params.contact_id}/note_to_contact`, "PUT");
            }
            if (params.deal_id) {
                await hsRequest(token, `/crm/v3/objects/notes/${noteData.id}/associations/deals/${params.deal_id}/note_to_deal`, "PUT");
            }
            return JSON.stringify({ id: noteData.id, logged: true });
        },
    },
};
