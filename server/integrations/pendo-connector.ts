/**
 * Pendo Integration Connector — Product Launch Cycle
 *
 * Provides product analytics and in-app guidance capabilities:
 * - Feature adoption tracking (which features are being used post-launch)
 * - NPS/Poll survey results
 * - Guide engagement metrics (onboarding completion rates)
 * - Page/feature usage analytics
 * - Visitor and account metadata
 * - Feedback collection from in-app polls
 *
 * Credentials are loaded from the platform's saasConnectors table (org-scoped).
 */
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

const logger = createLogger("PendoConnector");

export interface PendoConfig {
  apiKey: string;       // Pendo Integration API key
  appId: string;        // Pendo App ID
  baseUrl?: string;     // Defaults to https://app.pendo.io
}

export interface PendoFeatureUsage {
  featureId: string;
  name: string;
  pageId: string;
  numVisitors: number;
  numEvents: number;
  avgDuration: number;
  firstSeen: string;
  lastSeen: string;
}

export interface PendoNPSResponse {
  visitorId: string;
  accountId: string;
  score: number;
  comment: string;
  createdAt: string;
}

export interface PendoGuideMetrics {
  guideId: string;
  name: string;
  state: string;
  views: number;
  completions: number;
  dismissals: number;
  completionRate: number;
}

export interface PendoPageUsage {
  pageId: string;
  name: string;
  url: string;
  numVisitors: number;
  numViews: number;
  avgTimeOnPage: number;
}

export interface PendoPollResponse {
  pollId: string;
  question: string;
  visitorId: string;
  answer: string | number;
  createdAt: string;
}

export const pendoConnector = {
  config: null as PendoConfig | null,

  configure(config: PendoConfig) {
    this.config = { ...config, baseUrl: config.baseUrl || "https://app.pendo.io" };
    logger.info("[Pendo] Connector configured");
  },

  /** Load credentials from the platform's saasConnectors table for an org */
  async loadFromPlatform(orgId: number): Promise<boolean> {
    try {
      const [connector] = await db.select().from(saasConnectors)
        .where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, "pendo")))
        .limit(1);
      if (!connector || connector.status !== "connected") return false;
      const creds = connector.credentials as any;
      const config = connector.config as any;
      this.config = { apiKey: creds?.apiKey || creds?.integration_key || "", appId: config?.appId || "", baseUrl: config?.baseUrl || "https://app.pendo.io" };
      logger.info(`[Pendo] Loaded credentials from platform for org ${orgId}`);
      return true;
    } catch (err: any) {
      logger.warn(`[Pendo] Failed to load from platform: ${err.message}`);
      return false;
    }
  },

  isConfigured(): boolean {
    return this.config !== null && !!this.config.apiKey;
  },

  /** Internal helper for Pendo API requests */
  async _request<T>(path: string, method = "GET", body?: any): Promise<T | null> {
    if (!this.isConfigured()) return null;
    try {
      const url = `${this.config!.baseUrl}/api/v1${path}`;
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Pendo-Integration-Key": this.config!.apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        logger.warn(`[Pendo] API error: ${res.status} on ${method} ${path}`);
        return null;
      }
      return await res.json() as T;
    } catch (err: any) {
      logger.error(`[Pendo] Request failed: ${err.message}`);
      return null;
    }
  },

  /**
   * Get feature usage data — shows which features are being adopted post-launch.
   * Critical for measuring launch success and identifying underused capabilities.
   */
  async getFeatureUsage(period: { start: string; end: string }, limit = 50): Promise<PendoFeatureUsage[]> {
    const data = await this._request<any>("/aggregation", "POST", {
      response: { mimeType: "application/json" },
      request: {
        pipeline: [
          { source: { features: null, timeSeries: { period: "dayRange", first: period.start, last: period.end } } },
          { sort: ["numVisitors"] },
          { limit: limit },
        ],
      },
    });
    if (!data?.results) return [];
    return data.results.map((r: any) => ({
      featureId: r.featureId,
      name: r.name || r.featureId,
      pageId: r.pageId || "",
      numVisitors: r.numVisitors || 0,
      numEvents: r.numEvents || 0,
      avgDuration: r.avgDuration || 0,
      firstSeen: r.firstTime || "",
      lastSeen: r.lastTime || "",
    }));
  },

  /**
   * Get NPS survey responses — primary metric for product-market fit validation.
   */
  async getNPSResponses(since?: string): Promise<PendoNPSResponse[]> {
    const filter = since ? `&startTime=${since}` : "";
    const data = await this._request<any>(`/aggregation`, "POST", {
      response: { mimeType: "application/json" },
      request: {
        pipeline: [
          { source: { nps: null, timeSeries: since ? { period: "dayRange", first: since, last: new Date().toISOString().split("T")[0] } : undefined } },
          { sort: ["-browserTime"] },
          { limit: 200 },
        ],
      },
    });
    if (!data?.results) return [];
    return data.results.map((r: any) => ({
      visitorId: r.visitorId || "",
      accountId: r.accountId || "",
      score: r.npsRating ?? 0,
      comment: r.npsComment || "",
      createdAt: r.browserTime || "",
    }));
  },

  /**
   * Calculate NPS score from responses.
   */
  calculateNPS(responses: PendoNPSResponse[]): { score: number; promoters: number; passives: number; detractors: number; total: number } {
    if (responses.length === 0) return { score: 0, promoters: 0, passives: 0, detractors: 0, total: 0 };
    const promoters = responses.filter(r => r.score >= 9).length;
    const detractors = responses.filter(r => r.score <= 6).length;
    const passives = responses.length - promoters - detractors;
    const score = Math.round(((promoters - detractors) / responses.length) * 100);
    return { score, promoters, passives, detractors, total: responses.length };
  },

  /**
   * Get guide engagement metrics — measures onboarding and in-app education effectiveness.
   */
  async getGuideMetrics(guideIds?: string[]): Promise<PendoGuideMetrics[]> {
    const data = await this._request<any>("/aggregation", "POST", {
      response: { mimeType: "application/json" },
      request: {
        pipeline: [
          { source: { guides: guideIds ? { guideId: { $in: guideIds } } : null } },
          { sort: ["-views"] },
          { limit: 50 },
        ],
      },
    });
    if (!data?.results) return [];
    return data.results.map((r: any) => ({
      guideId: r.guideId || r.id,
      name: r.name || "Unnamed Guide",
      state: r.state || "unknown",
      views: r.numViews || r.views || 0,
      completions: r.numCompletions || 0,
      dismissals: r.numDismissals || 0,
      completionRate: r.numViews > 0 ? Math.round((r.numCompletions / r.numViews) * 100) : 0,
    }));
  },

  /**
   * Get page usage analytics — identifies which pages users visit most post-launch.
   */
  async getPageUsage(period: { start: string; end: string }, limit = 30): Promise<PendoPageUsage[]> {
    const data = await this._request<any>("/aggregation", "POST", {
      response: { mimeType: "application/json" },
      request: {
        pipeline: [
          { source: { pages: null, timeSeries: { period: "dayRange", first: period.start, last: period.end } } },
          { sort: ["-numVisitors"] },
          { limit },
        ],
      },
    });
    if (!data?.results) return [];
    return data.results.map((r: any) => ({
      pageId: r.pageId || r.id,
      name: r.name || "Unknown Page",
      url: r.url || "",
      numVisitors: r.numVisitors || 0,
      numViews: r.numViews || 0,
      avgTimeOnPage: r.avgDuration || 0,
    }));
  },

  /**
   * Get poll/survey responses — captures structured in-app feedback.
   */
  async getPollResponses(pollId: string): Promise<PendoPollResponse[]> {
    const data = await this._request<any>(`/aggregation`, "POST", {
      response: { mimeType: "application/json" },
      request: {
        pipeline: [
          { source: { pollResponses: { pollId } } },
          { sort: ["-browserTime"] },
          { limit: 500 },
        ],
      },
    });
    if (!data?.results) return [];
    return data.results.map((r: any) => ({
      pollId: r.pollId || pollId,
      question: r.pollQuestion || "",
      visitorId: r.visitorId || "",
      answer: r.pollResponse ?? r.npsRating ?? "",
      createdAt: r.browserTime || "",
    }));
  },

  /**
   * Ingest Pendo data into the launch cycle's feedback and metrics datasets.
   * Converts Pendo NPS + poll responses into structured feedback items.
   */
  async ingestForLaunchCycle(period: { start: string; end: string }): Promise<{
    nps: { score: number; responses: number };
    features: { total: number; topAdopted: string[] };
    guides: { total: number; avgCompletionRate: number };
    feedback: Array<{ content: string; source: string; sentiment: number; date: string }>;
  }> {
    const [npsResponses, features, guides] = await Promise.all([
      this.getNPSResponses(period.start),
      this.getFeatureUsage(period, 20),
      this.getGuideMetrics(),
    ]);

    const nps = this.calculateNPS(npsResponses);
    const topFeatures = features.slice(0, 5).map(f => f.name);
    const avgGuideCompletion = guides.length > 0
      ? Math.round(guides.reduce((sum, g) => sum + g.completionRate, 0) / guides.length)
      : 0;

    // Convert NPS comments into feedback items
    const feedback = npsResponses
      .filter(r => r.comment && r.comment.trim().length > 0)
      .map(r => ({
        content: r.comment,
        source: "pendo_nps",
        sentiment: r.score >= 9 ? 0.8 : r.score >= 7 ? 0.3 : r.score >= 5 ? -0.2 : -0.7,
        date: r.createdAt,
        visitorId: r.visitorId,
      }));

    return {
      nps: { score: nps.score, responses: nps.total },
      features: { total: features.length, topAdopted: topFeatures },
      guides: { total: guides.length, avgCompletionRate: avgGuideCompletion },
      feedback,
    };
  },
};
