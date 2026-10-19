import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

const logger = createLogger("SalesforceConnector");

export interface SalesforceConfig {
  instanceUrl: string;
  accessToken: string;
}

export const salesforceConnector = {
  config: null as SalesforceConfig | null,

  configure(config: SalesforceConfig) {
    this.config = config;
    logger.info("[Salesforce] Connector configured");
  },

  async loadFromPlatform(orgId: number): Promise<boolean> {
    try {
      const [connector] = await db.select().from(saasConnectors)
        .where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, "salesforce")))
        .limit(1);
      if (!connector || connector.status !== "connected") return false;
      const creds = connector.credentials as any;
      this.config = { instanceUrl: creds?.instance_url, accessToken: creds?.access_token };
      logger.info(`[Salesforce] Loaded credentials from platform for org ${orgId}`);
      return true;
    } catch (err: any) {
      logger.warn(`[Salesforce] Failed to load from platform: ${err.message}`);
      return false;
    }
  },

  isConfigured(): boolean {
    return this.config !== null && !!this.config.accessToken;
  },

  async sfRequest(path: string, method = "GET", body?: any) {
    if (!this.isConfigured()) throw new Error("Salesforce not configured");
    const res = await fetch(`${this.config!.instanceUrl}/services/data/v59.0${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${this.config!.accessToken}`,
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
  },

  async getRecord(objectType: string, recordId: string, fields?: string[]): Promise<any | null> {
    const fieldParam = fields?.length ? `?fields=${fields.join(",")}` : "";
    return this.sfRequest(`/sobjects/${objectType}/${recordId}${fieldParam}`);
  },

  async createRecord(objectType: string, data: any): Promise<any> {
    return this.sfRequest(`/sobjects/${objectType}`, "POST", data);
  },

  async updateRecord(objectType: string, recordId: string, data: any): Promise<any> {
    return this.sfRequest(`/sobjects/${objectType}/${recordId}`, "PATCH", data);
  },
};