import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import type { DatadogClient, PagerDutyClient } from "../../../integrations/monitoring-service.js";

async function resolveMonitoringCredential(orgId?: number | null, provider?: string): Promise<number | undefined> {
    if (!orgId || !provider) return undefined;
    try {
        const { db } = await import("@server/database_service.js");
        const { saasConnectors } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");
        const [connector] = await db
            .select({ id: saasConnectors.id })
            .from(saasConnectors)
            .where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, provider)))
            .limit(1);
        return connector?.id;
    } catch {
        return undefined;
    }
}

export const MONITORING_TOOLS: Record<string, ToolDefinition> = {
    monitoring_query_metrics: {
        name: "monitoring_query_metrics",

        idempotency: "read-safe",
        label: "Query Metrics",
        group: "Monitoring",
        description: "Query time-series metrics from Datadog. Returns series data for the specified query and time range.",
        parameters: z.object({
            query: z.string().describe("Datadog metrics query string (e.g. 'avg:system.cpu.user{*}')"),
            from: z.string().optional().describe("ISO 8601 start time (defaults to 1 hour ago)"),
            to: z.string().optional().describe("ISO 8601 end time (defaults to now)"),
        }),
        execute: async (params, context) => {
            const { getMonitoringClient, DatadogClient } = await import("../../../integrations/monitoring-service.js");
            const credentialId = await resolveMonitoringCredential(context?.organizationId, "datadog");
            if (!credentialId) return JSON.stringify({ error: "No Datadog credential configured. Add one in Settings." });
            const client = await getMonitoringClient(credentialId, context?.organizationId || null, "datadog") as DatadogClient;
            const from = params.from ? Math.floor(new Date(params.from).getTime() / 1000) : Math.floor(Date.now() / 1000) - 3600;
            const to = params.to ? Math.floor(new Date(params.to).getTime() / 1000) : Math.floor(Date.now() / 1000);
            const result = await client.queryMetrics(params.query, from, to);
            return JSON.stringify(result);
        },
    },

    monitoring_list_alerts: {
        name: "monitoring_list_alerts",

        idempotency: "read-safe",
        label: "List Active Monitors",
        group: "Monitoring",
        description: "List active monitors/alerts from Datadog.",
        parameters: z.object({
            tags: z.array(z.string()).optional().describe("Filter monitors by tags (e.g. ['env:prod', 'team:backend'])"),
            limit: z.number().optional().describe("Maximum number of monitors to return (default 50)"),
        }),
        execute: async (params, context) => {
            const { getMonitoringClient, DatadogClient } = await import("../../../integrations/monitoring-service.js");
            const credentialId = await resolveMonitoringCredential(context?.organizationId, "datadog");
            if (!credentialId) return JSON.stringify({ error: "No Datadog credential configured." });
            const client = await getMonitoringClient(credentialId, context?.organizationId || null, "datadog") as DatadogClient;
            const monitors = await client.listMonitors(params.tags, params.limit || 50);
            return JSON.stringify(monitors.map((m: any) => ({
                id: m.id,
                name: m.name,
                type: m.type,
                status: m.overall_state,
                tags: m.tags,
                query: m.query,
            })));
        },
    },

    monitoring_get_incidents: {
        name: "monitoring_get_incidents",

        idempotency: "read-safe",
        label: "Get Incidents",
        group: "Monitoring",
        description: "Get current incidents from PagerDuty.",
        parameters: z.object({
            status: z.enum(["triggered", "acknowledged", "resolved"]).optional().describe("Filter by incident status (default: all open)"),
            limit: z.number().optional().describe("Maximum number of incidents to return (default 50)"),
        }),
        execute: async (params, context) => {
            const { getMonitoringClient, PagerDutyClient } = await import("../../../integrations/monitoring-service.js");
            const credentialId = await resolveMonitoringCredential(context?.organizationId, "pagerduty");
            if (!credentialId) return JSON.stringify({ error: "No PagerDuty credential configured. Add one in Settings." });
            const client = await getMonitoringClient(credentialId, context?.organizationId || null, "pagerduty") as PagerDutyClient;
            const incidents = await client.listIncidents(params.limit || 50, params.status);
            return JSON.stringify(incidents.map((i: any) => ({
                id: i.id,
                title: i.title,
                status: i.status,
                urgency: i.urgency,
                service: i.service?.summary,
                created: i.created_at,
                resolvedAt: i.resolved_at,
            })));
        },
    },

    monitoring_resolve_incident: {
        name: "monitoring_resolve_incident",

        idempotency: "idempotent",
        label: "Resolve Incident",
        group: "Monitoring",
        description: "Resolve a PagerDuty incident by ID.",
        parameters: z.object({
            incidentId: z.string().describe("PagerDuty incident ID"),
        }),
        execute: async (params, context) => {
            const { getMonitoringClient, PagerDutyClient } = await import("../../../integrations/monitoring-service.js");
            const credentialId = await resolveMonitoringCredential(context?.organizationId, "pagerduty");
            if (!credentialId) return JSON.stringify({ error: "No PagerDuty credential configured." });
            const client = await getMonitoringClient(credentialId, context?.organizationId || null, "pagerduty") as PagerDutyClient;
            const result = await client.resolveIncident(params.incidentId, "oddjob@system");
            return JSON.stringify({ status: "resolved", incident: result?.incident?.id });
        },
    },

    monitoring_trigger_alert: {
        name: "monitoring_trigger_alert",

        idempotency: "none",
        label: "Trigger PagerDuty Alert",
        group: "Monitoring",
        description: "Trigger a new alert/event in PagerDuty via an integration routing key.",
        parameters: z.object({
            routingKey: z.string().describe("PagerDuty Events API v2 integration key (routing key)"),
            summary: z.string().describe("Alert summary / title"),
            severity: z.enum(["critical", "error", "warning", "info"]).default("error").describe("Alert severity"),
            details: z.string().optional().describe("Additional context for the alert"),
        }),
        execute: async (params, context) => {
            const { PagerDutyClient } = await import("../../../integrations/monitoring-service.js");
            // Events API uses routing key auth, not the REST API key
            const client = new PagerDutyClient("");
            const result = await client.triggerEvent(
                params.routingKey,
                params.summary,
                params.severity || "error",
                params.details ? { message: params.details } : undefined
            );
            return JSON.stringify(result);
        },
    },

    monitoring_list_dashboards: {
        name: "monitoring_list_dashboards",

        idempotency: "read-safe",
        label: "List Datadog Dashboards",
        group: "Monitoring",
        description: "List available Datadog dashboards.",
        parameters: z.object({}),
        execute: async (params, context) => {
            const { getMonitoringClient, DatadogClient } = await import("../../../integrations/monitoring-service.js");
            const credentialId = await resolveMonitoringCredential(context?.organizationId, "datadog");
            if (!credentialId) return JSON.stringify({ error: "No Datadog credential configured." });
            const client = await getMonitoringClient(credentialId, context?.organizationId || null, "datadog") as DatadogClient;
            const dashboards = await client.listDashboards();
            return JSON.stringify(dashboards.map((d: any) => ({ id: d.id, title: d.title, url: d.url })));
        },
    },
};
