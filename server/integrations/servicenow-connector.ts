import { createLogger } from "@server/utils/logger.js";
import {
    getServiceNowConfig,
    resolveInstanceUrl,
    snRequest,
    type ServiceNowConfig,
} from "@domain/tools/v1/capabilities/servicenow.js";

const logger = createLogger("ServiceNowConnector");

export type { ServiceNowConfig };

/**
 * Platform-level ServiceNow gateway, mirroring the other SaaS connectors.
 * Credential resolution is shared with the agent tools so a connector
 * configured in the Connections dashboard powers both paths.
 */
export const servicenowConnector = {
    config: null as ServiceNowConfig | null,

    configure(config: ServiceNowConfig) {
        this.config = { ...config, instanceUrl: resolveInstanceUrl(config.instanceUrl) };
        logger.info("[ServiceNow] Connector configured");
    },

    async loadFromPlatform(orgId: number): Promise<boolean> {
        try {
            const config = await getServiceNowConfig(orgId);
            if (!config) return false;
            this.config = config;
            logger.info(`[ServiceNow] Loaded credentials from platform for org ${orgId}`);
            return true;
        } catch (err: any) {
            logger.warn(`[ServiceNow] Failed to load from platform: ${err.message}`);
            return false;
        }
    },

    isConfigured(): boolean {
        return !!this.config?.instanceUrl && !!(this.config.accessToken || this.config.password);
    },

    async request(path: string, method = "GET", body?: any) {
        if (!this.isConfigured()) throw new Error("ServiceNow not configured");
        return snRequest(this.config!, path, method, body);
    },

    /** Verifies credentials and returns the authenticated user's display name. */
    async testConnection(): Promise<{ name: string }> {
        const data = await this.request("/table/sys_user?sysparm_limit=1&sysparm_fields=name");
        return { name: (data.result || [])[0]?.name || "unknown user" };
    },

    async getRecords(table: string, query?: string, limit = 20) {
        const params = new URLSearchParams();
        if (query) params.set("sysparm_query", query);
        params.set("sysparm_limit", String(limit));
        params.set("sysparm_display_value", "true");
        const data = await this.request(`/table/${table}?${params.toString()}`);
        return data.result || [];
    },

    async getRecord(table: string, sysId: string) {
        const data = await this.request(`/table/${table}/${sysId}?sysparm_display_value=true`);
        return data.result || null;
    },

    async createRecord(table: string, values: Record<string, any>) {
        const data = await this.request(`/table/${table}`, "POST", values);
        return data.result;
    },

    async updateRecord(table: string, sysId: string, values: Record<string, any>) {
        const data = await this.request(`/table/${table}/${sysId}`, "PATCH", values);
        return data.result;
    },
};
