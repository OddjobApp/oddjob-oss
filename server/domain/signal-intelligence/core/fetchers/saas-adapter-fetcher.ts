/**
 * SaaS Adapter Feed Fetcher
 *
 * Connects enterprise SaaS adapters (Jira, GitHub, Slack, ServiceNow, Confluence)
 * into the Signal Intelligence feed ingestion pipeline.
 *
 * When polled, it queries recent CloudEvents and integration activity for the
 * feed's organization, mapping them into standard FeedEntry[] items ready for
 * JSONPath extraction, CEL rule evaluation, and downstream CREW playbooks.
 */

import { and, desc, eq, gt, or, ilike } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { eventLog } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import type { FeedEntry, FeedFetcher } from "../signal-ingestion.service.js";
import type { SignalFeedConfig } from "@shared/schema/index.js";

const logger = createLogger("SaasAdapterFetcher");

function resolvePlatformFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    if (host.includes("jira") || pathname.includes("jira") || host.includes("atlassian.net")) {
      return "jira";
    }
    if (host.includes("github") || pathname.includes("github")) {
      return "github";
    }
    if (host.includes("slack") || pathname.includes("slack")) {
      return "slack";
    }
    if (host.includes("servicenow") || pathname.includes("servicenow")) {
      return "servicenow";
    }
    if (host.includes("confluence") || pathname.includes("confluence")) {
      return "confluence";
    }
    return null;
  } catch {
    return null;
  }
}

function extractTitle(payload: any, type: string, platform: string): string {
  if (!payload || typeof payload !== "object") {
    return `${platform.toUpperCase()} Event: ${type}`;
  }
  if (payload.title && typeof payload.title === "string") return payload.title;
  if (payload.summary && typeof payload.summary === "string") return payload.summary;
  if (payload.issue?.key && payload.issue?.fields?.summary) {
    return `[${payload.issue.key}] ${payload.issue.fields.summary}`;
  }
  if (payload.pull_request?.title) {
    return `PR #${payload.pull_request.number}: ${payload.pull_request.title}`;
  }
  if (payload.message?.text) {
    const text = String(payload.message.text).slice(0, 100);
    return `Slack: ${text}`;
  }
  return `${platform.toUpperCase()} ${type}`;
}

function extractContent(payload: any): string {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.description === "string") return payload.description;
  if (typeof payload.text === "string") return payload.text;
  if (payload.issue?.fields?.description) {
    return typeof payload.issue.fields.description === "string"
      ? payload.issue.fields.description
      : JSON.stringify(payload.issue.fields.description);
  }
  return JSON.stringify(payload, null, 2);
}

export const saasAdapterFetcher: FeedFetcher = async (
  feed: SignalFeedConfig,
  since: Date
): Promise<FeedEntry[]> => {
  const orgId = feed.organizationId;
  const platform = resolvePlatformFromUrl(feed.url) || "saas";

  logger.info(`Polling SaaS adapter feed "${feed.name}" (id=${feed.id}) for org ${orgId}, platform=${platform} since ${since.toISOString()}`);

  const conditions = [
    eq(eventLog.organizationId, orgId),
    gt(eventLog.emittedAt, since),
  ];

  if (platform !== "saas") {
    conditions.push(
      or(
        eq(eventLog.source, platform),
        ilike(eventLog.type, `${platform}.%`),
        ilike(eventLog.source, `%${platform}%`)
      )!
    );
  }

  const rows = await db
    .select()
    .from(eventLog)
    .where(and(...conditions))
    .orderBy(desc(eventLog.emittedAt))
    .limit(50);

  const entries: FeedEntry[] = rows.map((row) => {
    const payload = (row.payload as Record<string, unknown>) || {};
    const title = extractTitle(payload, row.type, platform);
    const content = extractContent(payload);

    return {
      id: `saas-${row.eventId}`,
      feedId: feed.id,
      organizationId: orgId,
      sourceUrl: feed.url,
      title,
      content,
      publishedAt: row.emittedAt,
      retrievedAt: new Date(),
      rawData: {
        ...payload,
        platform,
        eventType: row.type,
        source: row.source,
        subject: row.subject,
        eventId: row.eventId,
      },
    };
  });

  logger.info(`SaaS adapter feed "${feed.name}" returned ${entries.length} entries`);
  return entries;
};
