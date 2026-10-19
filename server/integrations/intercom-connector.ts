/**
 * Intercom Integration Connector — Product Launch Cycle
 *
 * Provides customer communication and feedback capabilities:
 * - Conversation reading (feedback ingestion)
 * - NPS survey results
 * - In-app message sending (beta participant communication)
 * - User segment queries
 *
 * Credentials are loaded from the platform's saasConnectors table (org-scoped).
 */
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

const logger = createLogger("IntercomConnector");

export interface IntercomConfig {
  appId: string;
  apiToken: string;
}

export interface IntercomConversation {
  id: string;
  title: string;
  state: string;
  createdAt: string;
  tags: string[];
  rating?: number;
  body: string;
  user: { name: string; email: string };
}

export interface IntercomNPSResponse {
  score: number;
  comment: string;
  user: { name: string; email: string; segment: string };
  createdAt: string;
}

export const intercomConnector = {
  config: null as IntercomConfig | null,

  configure(config: IntercomConfig) {
    this.config = config;
    logger.info("[Intercom] Connector configured");
  },

  /** Load credentials from the platform's saasConnectors table for an org */
  async loadFromPlatform(orgId: number): Promise<boolean> {
    try {
      const [connector] = await db.select().from(saasConnectors)
        .where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, "intercom")))
        .limit(1);
      if (!connector || connector.status !== "connected") return false;
      const creds = connector.credentials as any;
      const config = connector.config as any;
      this.config = { appId: config?.appId || creds?.appId || "", apiToken: creds?.apiToken || creds?.access_token || "" };
      logger.info(`[Intercom] Loaded credentials from platform for org ${orgId}`);
      return true;
    } catch (err: any) {
      logger.warn(`[Intercom] Failed to load from platform: ${err.message}`);
      return false;
    }
  },

  isConfigured(): boolean {
    return this.config !== null && !!this.config.apiToken;
  },

  async getConversations(tag?: string, limit = 50): Promise<IntercomConversation[]> {
    if (!this.isConfigured()) return [];
    try {
      const url = `https://api.intercom.io/conversations?per_page=${limit}${tag ? `&tag_id=${tag}` : ""}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config!.apiToken}`, Accept: "application/json" },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.conversations || []).map((c: any) => ({
        id: c.id,
        title: c.source?.subject || "No subject",
        state: c.state,
        createdAt: c.created_at,
        tags: (c.tags?.tags || []).map((t: any) => t.name),
        rating: c.conversation_rating?.rating,
        body: c.source?.body || "",
        user: { name: c.source?.author?.name || "Unknown", email: c.source?.author?.email || "" },
      }));
    } catch { return []; }
  },

  async getNPSResponses(since?: string): Promise<IntercomNPSResponse[]> {
    if (!this.isConfigured()) return [];
    // Intercom NPS is accessed via data export or events API
    logger.info("[Intercom] Fetching NPS responses");
    return []; // Stub — requires Intercom NPS feature
  },

  async sendMessage(userId: string, message: string, messageType: "inapp" | "email" = "inapp"): Promise<{ success: boolean; messageId?: string }> {
    if (!this.isConfigured()) return { success: false };
    try {
      const res = await fetch("https://api.intercom.io/messages", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config!.apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message_type: messageType, subject: "Product Update", body: message, from: { type: "admin", id: "1" }, to: { type: "user", id: userId } }),
      });
      if (!res.ok) return { success: false };
      const data = await res.json();
      return { success: true, messageId: data.id };
    } catch { return { success: false }; }
  },

  async getUserSegment(segmentId: string): Promise<Array<{ id: string; name: string; email: string }>> {
    if (!this.isConfigured()) return [];
    try {
      const res = await fetch(`https://api.intercom.io/contacts/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config!.apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: { field: "segment_id", operator: "=", value: segmentId } }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map((u: any) => ({ id: u.id, name: u.name, email: u.email }));
    } catch { return []; }
  },

  /**
   * Ingest feedback from Intercom conversations into the beta_feedback dataset.
   * Converts conversations tagged with a specific tag into structured feedback items.
   */
  async ingestFeedback(tag: string): Promise<Array<{ content: string; source: string; sentiment: number; persona: string }>> {
    const conversations = await this.getConversations(tag, 100);
    return conversations.map(c => ({
      content: c.body.replace(/<[^>]*>/g, "").slice(0, 500), // Strip HTML
      source: "intercom",
      sentiment: c.rating ? (c.rating - 3) / 2 : 0, // Convert 1-5 to -1 to +1
      persona: "unknown", // Would need enrichment from user data
      date: c.createdAt,
      conversationId: c.id,
    }));
  },
};
