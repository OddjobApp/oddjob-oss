import { createLogger } from "@server/utils/logger.js";
import { credentialsService } from "../auth/core/credentials-service.js";

const logger = createLogger("MonitoringService");

// ── Datadog ──────────────────────────────────────────────────────────────────

export class DatadogClient {
    private apiKey: string;
    private appKey: string;
    private site: string;

    constructor(apiKey: string, appKey: string, site = "datadoghq.com") {
        this.apiKey = apiKey;
        this.appKey = appKey;
        this.site = site;
    }

    private get headers(): Record<string, string> {
        return {
            "DD-API-KEY": this.apiKey,
            "DD-APPLICATION-KEY": this.appKey,
            "Content-Type": "application/json",
        };
    }

    async queryMetrics(query: string, from: number, to: number): Promise<any> {
        const url = `https://api.${this.site}/api/v1/query?query=${encodeURIComponent(query)}&from=${from}&to=${to}`;
        const res = await fetch(url, { headers: this.headers });
        if (!res.ok) throw new Error(`Datadog metrics query failed: ${res.status} ${await res.text()}`);
        return res.json();
    }

    async listMonitors(tags?: string[], limit = 50): Promise<any[]> {
        let url = `https://api.${this.site}/api/v1/monitor?count=${limit}`;
        if (tags?.length) url += `&monitor_tags=${encodeURIComponent(tags.join(","))}`;
        const res = await fetch(url, { headers: this.headers });
        if (!res.ok) throw new Error(`Datadog list monitors failed: ${res.status} ${await res.text()}`);
        return res.json();
    }

    async getMonitor(monitorId: string): Promise<any> {
        const url = `https://api.${this.site}/api/v1/monitor/${monitorId}`;
        const res = await fetch(url, { headers: this.headers });
        if (!res.ok) throw new Error(`Datadog get monitor failed: ${res.status}`);
        return res.json();
    }

    async listDashboards(): Promise<any[]> {
        const url = `https://api.${this.site}/api/v1/dashboard`;
        const res = await fetch(url, { headers: this.headers });
        if (!res.ok) throw new Error(`Datadog list dashboards failed: ${res.status}`);
        const data = await res.json();
        return data.dashboards || [];
    }

    async postEvent(title: string, text: string, alertType: string, tags?: string[]): Promise<any> {
        const payload: any = { title, text, alert_type: alertType };
        if (tags?.length) payload.tags = tags;
        const url = `https://api.${this.site}/api/v1/events`;
        const res = await fetch(url, { method: "POST", headers: this.headers, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(`Datadog post event failed: ${res.status} ${await res.text()}`);
        return res.json();
    }
}

// ── PagerDuty ────────────────────────────────────────────────────────────────

export class PagerDutyClient {
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    private get headers(): Record<string, string> {
        return {
            Authorization: `Token token=${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.pagerduty+json;version=2",
        };
    }

    async listIncidents(limit = 50, status?: string): Promise<any[]> {
        let url = `https://api.pagerduty.com/incidents?limit=${limit}&sort_by=created_at:desc`;
        if (status) url += `&statuses[]=${status}`;
        const res = await fetch(url, { headers: this.headers });
        if (!res.ok) throw new Error(`PagerDuty list incidents failed: ${res.status} ${await res.text()}`);
        const data = await res.json();
        return data.incidents || [];
    }

    async getIncident(incidentId: string): Promise<any> {
        const res = await fetch(`https://api.pagerduty.com/incidents/${incidentId}`, { headers: this.headers });
        if (!res.ok) throw new Error(`PagerDuty get incident failed: ${res.status}`);
        const data = await res.json();
        return data.incident;
    }

    async resolveIncident(incidentId: string, fromEmail: string): Promise<any> {
        const payload = { incident: { type: "incident_reference", status: "resolved" } };
        const res = await fetch(`https://api.pagerduty.com/incidents/${incidentId}`, {
            method: "PUT",
            headers: { ...this.headers, From: fromEmail },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`PagerDuty resolve incident failed: ${res.status} ${await res.text()}`);
        return res.json();
    }

    async acknowledgeIncident(incidentId: string, fromEmail: string): Promise<any> {
        const payload = { incident: { type: "incident_reference", status: "acknowledged" } };
        const res = await fetch(`https://api.pagerduty.com/incidents/${incidentId}`, {
            method: "PUT",
            headers: { ...this.headers, From: fromEmail },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`PagerDuty acknowledge incident failed: ${res.status}`);
        return res.json();
    }

    async listServices(limit = 50): Promise<any[]> {
        const res = await fetch(`https://api.pagerduty.com/services?limit=${limit}`, { headers: this.headers });
        if (!res.ok) throw new Error(`PagerDuty list services failed: ${res.status}`);
        const data = await res.json();
        return data.services || [];
    }

    async triggerEvent(routingKey: string, summary: string, severity: string, customDetails?: any): Promise<any> {
        const payload = {
            routing_key: routingKey,
            event_action: "trigger",
            payload: {
                summary,
                severity: severity || "error",
                source: "oddjob",
                ...(customDetails ? { custom_details: customDetails } : {}),
            },
        };
        const res = await fetch("https://events.pagerduty.com/v2/enqueue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`PagerDuty trigger event failed: ${res.status} ${await res.text()}`);
        return res.json();
    }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export async function getMonitoringClient(
    credentialId: number,
    orgId: number | null,
    provider: string
): Promise<DatadogClient | PagerDutyClient> {
    const cred = await credentialsService.getById(credentialId, orgId);

    if (provider === "datadog") {
        const apiKey = (cred as any).apiKey || (cred as any).ddApiKey;
        const appKey = (cred as any).appKey || (cred as any).ddAppKey;
        const site = (cred as any).site || "datadoghq.com";
        if (!apiKey || !appKey) throw new Error("Datadog credential requires apiKey and appKey fields");
        return new DatadogClient(apiKey, appKey, site);
    }

    if (provider === "pagerduty") {
        const apiKey = (cred as any).apiKey || (cred as any).token;
        if (!apiKey) throw new Error("PagerDuty credential requires apiKey or token field");
        return new PagerDutyClient(apiKey);
    }

    throw new Error(`Unsupported monitoring provider: ${provider}. Supported: datadog, pagerduty`);
}
