/**
 * HubSpot Integration Connector — Product Launch Cycle
 *
 * Provides CRM and marketing automation capabilities:
 * - Contact management (beta cohort tracking)
 * - Campaign creation and tracking
 * - Deal pipeline visibility
 * - Email analytics for content performance
 *
 * Credentials are loaded from the platform's saasConnectors table (org-scoped).
 */
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

const logger = createLogger("HubSpotConnector");

export interface HubSpotConfig {
  apiKey: string;
  portalId: string;
}

export interface HubSpotContact {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  lifecycle_stage: string;
  properties: Record<string, string>;
}

export interface HubSpotCampaign {
  id: string;
  name: string;
  type: string;
  status: string;
  metrics?: { sent: number; opened: number; clicked: number; converted: number };
}

export const hubspotConnector = {
  config: null as HubSpotConfig | null,

  configure(config: HubSpotConfig) {
    this.config = config;
    logger.info("[HubSpot] Connector configured");
  },

  /** Load credentials from the platform's saasConnectors table for an org */
  async loadFromPlatform(orgId: number): Promise<boolean> {
    try {
      const [connector] = await db.select().from(saasConnectors)
        .where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, "hubspot")))
        .limit(1);
      if (!connector || connector.status !== "connected") return false;
      const creds = connector.credentials as any;
      const config = connector.config as any;
      this.config = { apiKey: creds?.apiKey || creds?.access_token || "", portalId: config?.portalId || "" };
      logger.info(`[HubSpot] Loaded credentials from platform for org ${orgId}`);
      return true;
    } catch (err: any) {
      logger.warn(`[HubSpot] Failed to load from platform: ${err.message}`);
      return false;
    }
  },

  isConfigured(): boolean {
    return this.config !== null && !!this.config.apiKey;
  },

  async createContact(contact: Partial<HubSpotContact>): Promise<{ success: boolean; contactId?: string; error?: string }> {
    if (!this.isConfigured()) return { success: false, error: "HubSpot not configured" };
    try {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config!.apiKey}` },
        body: JSON.stringify({ properties: { email: contact.email, firstname: contact.firstName, lastname: contact.lastName, company: contact.company } }),
      });
      if (!res.ok) return { success: false, error: `HubSpot API error: ${res.status}` };
      const data = await res.json();
      return { success: true, contactId: data.id };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  async searchContacts(query: string, limit = 10): Promise<HubSpotContact[]> {
    if (!this.isConfigured()) return [];
    try {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config!.apiKey}` },
        body: JSON.stringify({ query, limit }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.results || [];
    } catch { return []; }
  },

  async getCampaigns(limit = 20): Promise<HubSpotCampaign[]> {
    if (!this.isConfigured()) return [];
    try {
      const res = await fetch(`https://api.hubapi.com/marketing/v3/campaigns?limit=${limit}`, {
        headers: { Authorization: `Bearer ${this.config!.apiKey}` },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.results || [];
    } catch { return []; }
  },

  async getEmailAnalytics(campaignId: string): Promise<{ sent: number; opened: number; clicked: number; bounced: number } | null> {
    if (!this.isConfigured()) return null;
    try {
      const res = await fetch(`https://api.hubapi.com/marketing/v3/emails/${campaignId}/statistics`, {
        headers: { Authorization: `Bearer ${this.config!.apiKey}` },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  async getDealPipeline(): Promise<any[]> {
    if (!this.isConfigured()) return [];
    try {
      const res = await fetch(`https://api.hubapi.com/crm/v3/pipelines/deals`,
        {
          headers: { Authorization: `Bearer ${this.config!.apiKey}` },
        }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.results || [];
    } catch { return []; }
  },

  async getContact(contactId: string): Promise<HubSpotContact | null> {
    if (!this.isConfigured()) return null;
    try {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
        {
          headers: { Authorization: `Bearer ${this.config!.apiKey}` },
        }
      );
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  async getDeal(dealId: string): Promise<any | null> {
    if (!this.isConfigured()) return null;
    try {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
        {
          headers: { Authorization: `Bearer ${this.config!.apiKey}` },
        }
      );
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  async getAccount(accountId: string): Promise<any | null> {
    if (!this.isConfigured()) return null;
    try {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${accountId}`,
        {
          headers: { Authorization: `Bearer ${this.config!.apiKey}` },
        }
      );
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  },

  async updateContact(contactId: string, data: Partial<HubSpotContact>): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) return { success: false, error: "HubSpot not configured" };
    try {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config!.apiKey}` },
          body: JSON.stringify({ properties: data }),
        }
      );
      if (!res.ok) return { success: false, error: `HubSpot API error: ${res.status}` };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  async updateDeal(dealId: string, data: any): Promise<{ success: boolean; error?: string }> {
    if (!this.isConfigured()) return { success: false, error: "HubSpot not configured" };
    try {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config!.apiKey}` },
          body: JSON.stringify({ properties: data }),
        }
      );
      if (!res.ok) return { success: false, error: `HubSpot API error: ${res.status}` };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
};
