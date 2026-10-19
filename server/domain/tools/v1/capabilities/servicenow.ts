import { z } from "zod";
import type { ToolDefinition } from "./types.js";

export interface ServiceNowConfig {
    /** Fully-qualified instance URL, e.g. https://acme.service-now.com */
    instanceUrl: string;
    username?: string;
    password?: string;
    /** OAuth bearer token; takes precedence over basic auth when present. */
    accessToken?: string;
}

/**
 * Accepts a bare instance name ("acme"), a host ("acme.service-now.com"), or a
 * full URL, and always returns a scheme-qualified origin with no trailing slash.
 */
export function resolveInstanceUrl(raw: string): string {
    const value = String(raw).trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(value)) return value;
    return value.includes(".") ? `https://${value}` : `https://${value}.service-now.com`;
}

/**
 * Resolves ServiceNow credentials for an org. Checks the SaaS connector record
 * first (what the Connectors dashboard writes), then a `servicenow` credential,
 * then process env — so the tools work regardless of how the org connected.
 */
export async function getServiceNowConfig(orgId?: number | null): Promise<ServiceNowConfig | null> {
    if (orgId) {
        try {
            const { db } = await import("@server/database_service.js");
            const { saasConnectors, credentials } = await import("@shared/schema/index.js");
            const { eq, and } = await import("drizzle-orm");

            const [connector] = await db
                .select()
                .from(saasConnectors)
                .where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, "servicenow")))
                .limit(1);

            if (connector && connector.status === "connected") {
                const creds = (connector.credentials || {}) as any;
                const instance = creds.endpoint || creds.instance || creds.base_url;
                if (instance) {
                    return {
                        instanceUrl: resolveInstanceUrl(instance),
                        username: creds.username,
                        password: creds.password || creds.api_token || creds.api_key,
                        accessToken: creds.access_token,
                    };
                }
            }

            const [cred] = await db
                .select()
                .from(credentials)
                .where(and(eq(credentials.organizationId, orgId), eq(credentials.type, "servicenow")))
                .limit(1);

            const meta = cred?.metadata as any;
            if (meta?.instanceUrl || meta?.instance) {
                return {
                    instanceUrl: resolveInstanceUrl(meta.instanceUrl || meta.instance),
                    username: meta.username,
                    password: meta.password || meta.apiToken,
                    accessToken: meta.accessToken,
                };
            }
        } catch {
            /* fall through to env */
        }
    }

    const envInstance = process.env.SERVICENOW_INSTANCE;
    if (envInstance && (process.env.SERVICENOW_PASSWORD || process.env.SERVICENOW_ACCESS_TOKEN)) {
        return {
            instanceUrl: resolveInstanceUrl(envInstance),
            username: process.env.SERVICENOW_USERNAME,
            password: process.env.SERVICENOW_PASSWORD,
            accessToken: process.env.SERVICENOW_ACCESS_TOKEN,
        };
    }
    return null;
}

const NOT_CONFIGURED =
    "ServiceNow is not configured. Add a ServiceNow connector under Connections, or set SERVICENOW_INSTANCE/SERVICENOW_USERNAME/SERVICENOW_PASSWORD.";

export async function snRequest(config: ServiceNowConfig, path: string, method = "GET", body?: any) {
    const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
    };
    if (config.accessToken) {
        headers.Authorization = `Bearer ${config.accessToken}`;
    } else {
        const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");
        headers.Authorization = `Basic ${auth}`;
    }

    const res = await fetch(`${config.instanceUrl}/api/now${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
        const errText = await res.text();
        // ServiceNow wraps failures in { error: { message, detail } } — surface the
        // useful part rather than a wall of HTML from an auth redirect.
        let detail = errText;
        try {
            const parsed = JSON.parse(errText);
            detail = parsed?.error?.message
                ? `${parsed.error.message}${parsed.error.detail ? ` — ${parsed.error.detail}` : ""}`
                : errText;
        } catch {
            /* non-JSON body (e.g. SSO login page) — keep the raw text */
        }
        throw new Error(`ServiceNow API error ${res.status}: ${detail.substring(0, 500)}`);
    }
    if (res.status === 204) return { result: null };
    return res.json();
}

/** Builds a Table API query string from the common sysparm_* options. */
function tableQuery(opts: { query?: string; fields?: string[]; limit?: number; displayValue?: boolean }): string {
    const params = new URLSearchParams();
    if (opts.query) params.set("sysparm_query", opts.query);
    if (opts.fields?.length) params.set("sysparm_fields", opts.fields.join(","));
    params.set("sysparm_limit", String(opts.limit ?? 20));
    params.set("sysparm_display_value", opts.displayValue === false ? "false" : "true");
    params.set("sysparm_exclude_reference_link", "true");
    return params.toString();
}

const INCIDENT_FIELDS = [
    "sys_id",
    "number",
    "short_description",
    "description",
    "state",
    "priority",
    "urgency",
    "impact",
    "category",
    "assigned_to",
    "assignment_group",
    "caller_id",
    "opened_at",
    "sys_updated_on",
];

/** Incident state values are numeric in the Table API; expose the labels agents actually know. */
const INCIDENT_STATES: Record<string, string> = {
    new: "1",
    in_progress: "2",
    on_hold: "3",
    resolved: "6",
    closed: "7",
    canceled: "8",
};

/** Urgency/impact drive the derived priority in a stock ServiceNow instance. */
const LEVELS: Record<string, string> = { high: "1", medium: "2", low: "3" };

function incidentUrl(config: ServiceNowConfig, sysId: string): string {
    return `${config.instanceUrl}/nav_to.do?uri=incident.do?sys_id=${sysId}`;
}

export const SERVICENOW_TOOLS: Record<string, ToolDefinition> = {
    servicenow_search_incidents: {
        name: "servicenow_search_incidents",
        label: "Search ServiceNow Incidents",
        group: "ServiceNow",
        description:
            "Search ServiceNow incidents using encoded query syntax (e.g. 'active=true^priority=1', " +
            "'state=2^assigned_toISEMPTY', 'short_descriptionLIKEvpn').",
        parameters: z.object({
            query: z
                .string()
                .optional()
                .describe("ServiceNow encoded query. Omit to list the most recently updated active incidents."),
            limit: z.number().min(1).max(100).default(20).optional(),
        }),
        riskLevel: "low",
        idempotency: "read-safe",
        sideEffects: ["external-api"],
        execute: async (params, context) => {
            const config = await getServiceNowConfig(context?.organizationId);
            if (!config) return NOT_CONFIGURED;
            const query = params.query || "active=true^ORDERBYDESCsys_updated_on";
            const data = await snRequest(
                config,
                `/table/incident?${tableQuery({ query, fields: INCIDENT_FIELDS, limit: params.limit || 20 })}`
            );
            const incidents = (data.result || []).map((i: any) => ({
                ...i,
                url: incidentUrl(config, i.sys_id),
            }));
            return JSON.stringify(incidents, null, 2);
        },
    },

    servicenow_get_incident: {
        name: "servicenow_get_incident",
        label: "Get ServiceNow Incident",
        group: "ServiceNow",
        description: "Get the full record for a single ServiceNow incident by its number (INC0010023) or sys_id.",
        parameters: z.object({
            incident: z.string().describe("Incident number (e.g. INC0010023) or sys_id"),
        }),
        riskLevel: "low",
        idempotency: "read-safe",
        sideEffects: ["external-api"],
        execute: async (params, context) => {
            const config = await getServiceNowConfig(context?.organizationId);
            if (!config) return NOT_CONFIGURED;
            const value = params.incident.trim();
            // sys_ids are 32-char hex; anything else is treated as a display number.
            const field = /^[0-9a-f]{32}$/i.test(value) ? "sys_id" : "number";
            const data = await snRequest(
                config,
                `/table/incident?${tableQuery({ query: `${field}=${value}`, limit: 1 })}`
            );
            const record = (data.result || [])[0];
            if (!record) return `No ServiceNow incident found for "${params.incident}".`;
            return JSON.stringify({ ...record, url: incidentUrl(config, record.sys_id) }, null, 2);
        },
    },

    servicenow_create_incident: {
        name: "servicenow_create_incident",
        label: "Create ServiceNow Incident",
        group: "ServiceNow",
        description: "Open a new incident in ServiceNow.",
        parameters: z.object({
            short_description: z.string().describe("One-line summary of the issue"),
            description: z.string().optional().describe("Full description / reproduction detail"),
            caller_id: z.string().optional().describe("sys_id or user_name of the caller"),
            category: z.string().optional().describe("Incident category (e.g. software, hardware, network)"),
            urgency: z.enum(["high", "medium", "low"]).optional(),
            impact: z.enum(["high", "medium", "low"]).optional(),
            assignment_group: z.string().optional().describe("sys_id or name of the assignment group"),
        }),
        riskLevel: "medium",
        idempotency: "none",
        sideEffects: ["external-api"],
        execute: async (params, context) => {
            const config = await getServiceNowConfig(context?.organizationId);
            if (!config) return NOT_CONFIGURED;
            const payload: Record<string, string> = { short_description: params.short_description };
            if (params.description) payload.description = params.description;
            if (params.caller_id) payload.caller_id = params.caller_id;
            if (params.category) payload.category = params.category;
            if (params.urgency) payload.urgency = LEVELS[params.urgency];
            if (params.impact) payload.impact = LEVELS[params.impact];
            if (params.assignment_group) payload.assignment_group = params.assignment_group;

            const data = await snRequest(config, `/table/incident?${tableQuery({ limit: 1 })}`, "POST", payload);
            const record = data.result || {};
            return JSON.stringify({
                sys_id: record.sys_id,
                number: record.number,
                state: record.state,
                url: incidentUrl(config, record.sys_id),
                created: true,
            });
        },
    },

    servicenow_update_incident: {
        name: "servicenow_update_incident",
        label: "Update ServiceNow Incident",
        group: "ServiceNow",
        description:
            "Update a ServiceNow incident — change state, reassign, or append a work note or customer-visible comment.",
        parameters: z.object({
            incident: z.string().describe("Incident number (e.g. INC0010023) or sys_id"),
            state: z.enum(["new", "in_progress", "on_hold", "resolved", "closed", "canceled"]).optional(),
            urgency: z.enum(["high", "medium", "low"]).optional(),
            assigned_to: z.string().optional().describe("sys_id or user_name to assign the incident to"),
            work_notes: z.string().optional().describe("Internal work note (not visible to the caller)"),
            comments: z.string().optional().describe("Customer-visible comment"),
            close_code: z.string().optional().describe("Resolution code — required by most instances to resolve/close"),
            close_notes: z.string().optional().describe("Resolution notes"),
        }),
        riskLevel: "medium",
        idempotency: "none",
        sideEffects: ["external-api"],
        execute: async (params, context) => {
            const config = await getServiceNowConfig(context?.organizationId);
            if (!config) return NOT_CONFIGURED;

            const value = params.incident.trim();
            let sysId = value;
            if (!/^[0-9a-f]{32}$/i.test(value)) {
                const lookup = await snRequest(
                    config,
                    `/table/incident?${tableQuery({ query: `number=${value}`, fields: ["sys_id"], limit: 1, displayValue: false })}`
                );
                sysId = (lookup.result || [])[0]?.sys_id;
                if (!sysId) return `No ServiceNow incident found for "${params.incident}".`;
            }

            const payload: Record<string, string> = {};
            if (params.state) payload.state = INCIDENT_STATES[params.state];
            if (params.urgency) payload.urgency = LEVELS[params.urgency];
            if (params.assigned_to) payload.assigned_to = params.assigned_to;
            if (params.work_notes) payload.work_notes = params.work_notes;
            if (params.comments) payload.comments = params.comments;
            if (params.close_code) payload.close_code = params.close_code;
            if (params.close_notes) payload.close_notes = params.close_notes;

            if (Object.keys(payload).length === 0) {
                return "Nothing to update — supply at least one of state, urgency, assigned_to, work_notes, comments, close_code or close_notes.";
            }

            const data = await snRequest(config, `/table/incident/${sysId}?${tableQuery({ limit: 1 })}`, "PATCH", payload);
            const record = data.result || {};
            return JSON.stringify({
                sys_id: sysId,
                number: record.number,
                state: record.state,
                url: incidentUrl(config, sysId),
                updated: true,
            });
        },
    },

    servicenow_search_knowledge: {
        name: "servicenow_search_knowledge",
        label: "Search ServiceNow Knowledge Base",
        group: "ServiceNow",
        description: "Search published ServiceNow knowledge articles for a resolution or how-to.",
        parameters: z.object({
            query: z.string().describe("Free-text search term matched against article title and body"),
            limit: z.number().min(1).max(50).default(10).optional(),
        }),
        riskLevel: "low",
        idempotency: "read-safe",
        sideEffects: ["external-api"],
        execute: async (params, context) => {
            const config = await getServiceNowConfig(context?.organizationId);
            if (!config) return NOT_CONFIGURED;
            const term = params.query.replace(/\^/g, " ");
            const query = `workflow_state=published^short_descriptionLIKE${term}^ORtextLIKE${term}`;
            const data = await snRequest(
                config,
                `/table/kb_knowledge?${tableQuery({
                    query,
                    fields: ["sys_id", "number", "short_description", "text", "kb_category", "sys_updated_on"],
                    limit: params.limit || 10,
                })}`
            );
            const articles = (data.result || []).map((a: any) => ({
                number: a.number,
                title: a.short_description,
                // Article bodies are HTML and frequently enormous — strip and cap for the context window.
                excerpt: String(a.text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().substring(0, 800),
                category: a.kb_category,
                updated: a.sys_updated_on,
                url: `${config.instanceUrl}/kb_view.do?sysparm_article=${a.number}`,
            }));
            return JSON.stringify(articles, null, 2);
        },
    },

    servicenow_create_change_request: {
        name: "servicenow_create_change_request",
        label: "Create ServiceNow Change Request",
        group: "ServiceNow",
        description: "Raise a change request in ServiceNow for a planned production change.",
        parameters: z.object({
            short_description: z.string().describe("One-line summary of the change"),
            description: z.string().optional().describe("Full change detail"),
            type: z.enum(["standard", "normal", "emergency"]).default("normal").optional(),
            risk: z.enum(["high", "medium", "low"]).optional(),
            implementation_plan: z.string().optional(),
            backout_plan: z.string().optional(),
            assignment_group: z.string().optional().describe("sys_id or name of the assignment group"),
        }),
        riskLevel: "high",
        idempotency: "none",
        sideEffects: ["external-api"],
        approvalPolicy: {
            requiresApproval: true,
            rationale: "Creates a change record in the customer's ServiceNow instance, visible to CAB and auditors.",
        },
        execute: async (params, context) => {
            const config = await getServiceNowConfig(context?.organizationId);
            if (!config) return NOT_CONFIGURED;
            const payload: Record<string, string> = {
                short_description: params.short_description,
                type: params.type || "normal",
            };
            if (params.description) payload.description = params.description;
            // change_request.risk uses the same 1/2/3 high→low scale as urgency.
            if (params.risk) payload.risk = LEVELS[params.risk];
            if (params.implementation_plan) payload.implementation_plan = params.implementation_plan;
            if (params.backout_plan) payload.backout_plan = params.backout_plan;
            if (params.assignment_group) payload.assignment_group = params.assignment_group;

            const data = await snRequest(config, `/table/change_request?${tableQuery({ limit: 1 })}`, "POST", payload);
            const record = data.result || {};
            return JSON.stringify({
                sys_id: record.sys_id,
                number: record.number,
                state: record.state,
                url: `${config.instanceUrl}/nav_to.do?uri=change_request.do?sys_id=${record.sys_id}`,
                created: true,
            });
        },
    },
};
