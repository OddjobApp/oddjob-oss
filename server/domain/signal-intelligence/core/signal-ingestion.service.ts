/**
 * Signal Ingestion Service
 * Handles feed configuration, polling, deduplication, and enqueuing for the
 * Signal Intelligence pipeline.
 *
 * Responsibilities:
 * - Configure and validate feed connections (URL, interval, auth)
 * - Poll feeds on their configured interval, retrieving new entries
 * - Deduplicate entries via SHA-256 content hash with 72h Redis TTL
 * - Enqueue new entries to Redis Streams for extraction pipeline
 * - Exponential backoff on poll failure (30s, 60s, 120s)
 * - Mark feeds "degraded" after 3 consecutive failures, double interval
 * - Restore normal status on next successful poll
 * - Enforce max 50 concurrent active feeds per organization
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8
 */

import { db } from "@server/database_service.js";
import { and, eq, sql, isNull, or } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { ValidationError } from "@server/utils/errors.js";
import {
  signalFeeds,
  eventPrimitives,
  type SignalFeedConfig,
  type InsertSignalFeed,
  feedSourceTypes,
  type FeedSourceType,
} from "@shared/schema/index.js";
import { createHash } from "crypto";
import { XMLParser } from "fast-xml-parser";
import { validateUrlForSSRF } from "@server/utils/security.js";
import {
  storeFeedCredentials,
  resolveFeedCredentials,
} from "./feed-credentials.service.js";

const logger = createLogger("SignalIngestionService");

// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_POLLING_INTERVAL_SECONDS = 30;
const MAX_POLLING_INTERVAL_SECONDS = 86400;
const MAX_CONCURRENT_FEEDS_PER_ORG = 50;
const DEDUP_TTL_SECONDS = 72 * 60 * 60; // 72 hours
const EXTRACTION_STREAM_KEY = "signal:extraction:queue";
const DEDUP_KEY_PREFIX = "signal:dedup:";
const BACKOFF_DELAYS_MS = [30_000, 60_000, 120_000]; // 30s, 60s, 120s
const MAX_CONSECUTIVE_FAILURES = 3;
const ENQUEUE_DEADLINE_MS = 5_000; // 5 seconds

// ============================================================================
// INTERFACES
// ============================================================================

export interface FeedEntry {
  id: string;
  feedId: number;
  organizationId: number;
  sourceUrl: string;
  title: string;
  content: string;
  publishedAt: Date | null;
  retrievedAt: Date;
  rawData: Record<string, unknown>;
}

export interface SignalFeedCreateInput {
  name: string;
  sourceType: FeedSourceType;
  url: string;
  authCredentials?: { type: string; token: string };
  pollingIntervalSeconds: number;
  enabled?: boolean;
}

// ============================================================================
// FETCHER REGISTRY
// ============================================================================

/**
 * Retrieves entries from one feed that are newer than `since`.
 *
 * Implementations own their transport and their parsing. They should throw on
 * failure rather than returning an empty array — `pollFeed` distinguishes the
 * two, and swallowing an error inside a fetcher makes a broken feed look like a
 * quiet one, which is how a feed stays "active" forever while ingesting nothing.
 */
export type FeedFetcher = (
  feed: SignalFeedConfig,
  since: Date
) => Promise<FeedEntry[]>;

const FETCHER_REGISTRY = new Map<FeedSourceType, FeedFetcher>();

/**
 * Register a source-type-specific fetcher.
 *
 * WHY THIS EXISTS: `getFetcher` previously took a `sourceType` and ignored it,
 * returning the generic HTTP fetcher for every type. That made adding a value
 * to `feedSourceTypes` an inert change — the new type would validate, persist
 * and display, while being fetched exactly like an RSS URL. Any source that is
 * not "GET a URL and parse RSS/JSON" (an OAuth-signed API, a cursor-paginated
 * endpoint, a platform SDK) must register here or it is not really supported.
 */
export function registerFeedFetcher(
  sourceType: FeedSourceType,
  fetcher: FeedFetcher
): void {
  if (!feedSourceTypes.includes(sourceType)) {
    throw new ValidationError(
      `Cannot register a fetcher for unknown source type "${sourceType}".`
    );
  }
  if (FETCHER_REGISTRY.has(sourceType)) {
    logger.warn(
      `Replacing the already-registered fetcher for source type "${sourceType}".`
    );
  }
  FETCHER_REGISTRY.set(sourceType, fetcher);
  logger.info(`Registered feed fetcher for source type "${sourceType}".`);
}

/** Remove a registered fetcher, restoring the generic HTTP fallback. For tests. */
export function unregisterFeedFetcher(sourceType: FeedSourceType): void {
  FETCHER_REGISTRY.delete(sourceType);
}

/** Source types backed by a dedicated fetcher rather than the generic fallback. */
export function registeredFetcherTypes(): FeedSourceType[] {
  return [...FETCHER_REGISTRY.keys()];
}

// ============================================================================
// SERVICE
// ============================================================================

export class SignalIngestionService {
  /**
   * Configure a new signal feed for an organization.
   * Validates URL format, polling interval bounds, auth credentials, and org feed limit.
   */
  async configureFeed(
    orgId: number,
    config: SignalFeedCreateInput
  ): Promise<SignalFeedConfig> {
    // Validate URL format
    this.validateUrl(config.url);

    // Validate polling interval bounds [30, 86400]
    this.validatePollingInterval(config.pollingIntervalSeconds);

    // Validate source type
    if (!feedSourceTypes.includes(config.sourceType)) {
      throw new ValidationError(
        `Invalid source type "${config.sourceType}". Must be one of: ${feedSourceTypes.join(", ")}`
      );
    }

    // Validate auth credentials if provided
    if (config.authCredentials) {
      this.validateAuthCredentials(config.authCredentials);
    }

    // Enforce max 50 concurrent active feeds per org
    const activeFeedCount = await this.getActiveFeedCount(orgId);
    if (activeFeedCount >= MAX_CONCURRENT_FEEDS_PER_ORG) {
      throw new ValidationError(
        `Organization has reached the maximum of ${MAX_CONCURRENT_FEEDS_PER_ORG} concurrent active feeds`
      );
    }

    // Validate name is non-empty
    if (!config.name || config.name.trim().length === 0) {
      throw new ValidationError("Feed name is required");
    }

    // Persist to database. The token is deliberately NOT part of this insert:
    // `auth_credentials` is plain jsonb, so anything written here is cleartext
    // at rest and in backups. The row is created first only because the
    // encrypted store is keyed by feed id.
    const insertData: InsertSignalFeed = {
      organizationId: orgId,
      name: config.name.trim(),
      sourceType: config.sourceType,
      url: config.url,
      authCredentials: null,
      pollingIntervalSeconds: config.pollingIntervalSeconds,
      enabled: config.enabled ?? true,
      status: "active",
      consecutiveFailures: 0,
      lastPollAt: null,
      lastSuccessAt: null,
    };

    const [created] = await db
      .insert(signalFeeds)
      .values(insertData)
      .returning();

    if (!config.authCredentials) {
      logger.info(
        `Configured signal feed "${created.name}" (id=${created.id}) for org ${orgId}, type=${config.sourceType}, interval=${config.pollingIntervalSeconds}s`
      );
      return created;
    }

    try {
      const descriptor = await storeFeedCredentials(
        orgId,
        created.id,
        config.authCredentials
      );

      const [withDescriptor] = await db
        .update(signalFeeds)
        .set({ authCredentials: descriptor, updatedAt: new Date() })
        .where(eq(signalFeeds.id, created.id))
        .returning();

      logger.info(
        `Configured signal feed "${created.name}" (id=${created.id}) for org ${orgId}, type=${config.sourceType}, interval=${config.pollingIntervalSeconds}s, credentials encrypted`
      );

      return withDescriptor;
    } catch (err) {
      // Leaving a credential-less feed behind would poll unauthenticated and
      // look merely "broken"; the caller asked for an authenticated feed, so
      // fail the whole operation rather than half-create one.
      await db.delete(signalFeeds).where(eq(signalFeeds.id, created.id));
      throw err;
    }
  }

  /**
   * Poll a feed to retrieve new entries since the last successful poll.
   * Handles backoff delays, failure counting, and status transitions.
   * Returns raw FeedEntry[] for downstream processing.
   */
  async pollFeed(feed: SignalFeedConfig): Promise<FeedEntry[]> {
    const since = feed.lastSuccessAt ?? new Date(0);

    try {
      // Fetch new entries from the feed source
      const entries = await this.fetchFeedEntries(feed, since);

      // On success: reset failure count and restore status if degraded
      await this.handlePollSuccess(feed);

      logger.info(
        `Poll succeeded for feed "${feed.name}" (id=${feed.id}): ${entries.length} new entries`
      );

      return entries;
    } catch (error: unknown) {
      // On failure: increment failure count and apply backoff logic
      await this.handlePollFailure(feed, error);
      return [];
    }
  }

  /**
   * Check if a feed entry is a duplicate using SHA-256 content hash.
   * Stores hash in Redis with 72h TTL.
   * @returns true if the entry is a duplicate (already seen within 72h)
   */
  async deduplicateEntry(entry: FeedEntry): Promise<boolean> {
    const { redis } = await import(
      "@domain/core/infrastructure/redis/redis-client.js"
    );

    const contentHash = this.computeContentHash(entry);
    const dedupKey = `${DEDUP_KEY_PREFIX}${contentHash}`;

    // Try to SET with NX (only if not exists) and expiry
    const result = await redis.set(dedupKey, "1", "EX", DEDUP_TTL_SECONDS, "NX");

    if (result === null) {
      // Key already existed — this is a duplicate
      logger.debug(
        `Duplicate entry detected for feed ${entry.feedId}: hash=${contentHash}`
      );
      return true;
    }

    // New entry — hash was stored
    return false;
  }

  /**
   * Enqueue feed entries for extraction via Redis Streams (XADD).
   * Must complete within 5 seconds of retrieval.
   */
  async enqueueForExtraction(entries: FeedEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const { redis } = await import(
      "@domain/core/infrastructure/redis/redis-client.js"
    );

    const startTime = Date.now();

    for (const entry of entries) {
      // Check we're within the 5-second deadline
      if (Date.now() - startTime > ENQUEUE_DEADLINE_MS) {
        logger.warn(
          `Enqueue deadline exceeded after ${entries.indexOf(entry)} of ${entries.length} entries for feed ${entry.feedId}`
        );
        break;
      }

      const payload = JSON.stringify({
        id: entry.id,
        feedId: entry.feedId,
        organizationId: entry.organizationId,
        sourceUrl: entry.sourceUrl,
        title: entry.title,
        content: entry.content,
        publishedAt: entry.publishedAt?.toISOString() ?? null,
        retrievedAt: entry.retrievedAt.toISOString(),
        rawData: entry.rawData,
      });

      await redis.xadd(
        EXTRACTION_STREAM_KEY,
        "*",
        "entry",
        payload,
        "feedId",
        String(entry.feedId),
        "orgId",
        String(entry.organizationId)
      );
    }

    const elapsedMs = Date.now() - startTime;
    logger.info(
      `Enqueued ${entries.length} entries to extraction stream in ${elapsedMs}ms`
    );
  }

  /** Poll and run entries through Oddjob's existing extraction, causal graph,
   * world-model, and cycle subscription services in one auditable path. */
  async pollAndProcess(feed: SignalFeedConfig): Promise<{ entries: number; events: number; transitions: number }> {
    const entries = await this.pollFeed(feed);
    let eventCount = 0;
    let transitionCount = 0;
    const { eventExtractionService } = await import("./event-extraction.service.js");
    const { causalGraphService } = await import("./causal-graph.service.js");
    const { worldModelBridgeService } = await import("./world-model-bridge.service.js");
    const { spatialTelemetryResolver } = await import("./spatial-telemetry-resolver.service.js");
    const { eventPrimitives } = await import("@shared/schema/index.js");

    for (const entry of entries) {
      if (await this.deduplicateEntry(entry)) continue;
      const extracted = await eventExtractionService.extractFromEntry(entry);
      for (const primitive of extracted) {
        // Feed entries carry no telemetry, so placement comes from a named hub
        // in the text, falling back to the extracted jurisdiction. The resolver
        // records which, and the predicate engine gates on that precision.
        const spatial = await spatialTelemetryResolver.resolve({
          organizationId: primitive.organizationId,
          text: [primitive.rawText, entry.title, entry.content].filter(Boolean).join(" \n "),
          jurisdiction: primitive.jurisdiction,
        });

        const [event] = await db.insert(eventPrimitives).values({
          id: primitive.id,
          organizationId: primitive.organizationId,
          sourceEntryId: primitive.sourceEntryId,
          eventType: primitive.eventType,
          targetSector: primitive.targetSector,
          jurisdiction: primitive.jurisdiction,
          severity: primitive.severity,
          sourceUrl: primitive.sourceUrl,
          extractionTimestamp: new Date(primitive.extractionTimestamp),
          confidenceScore: primitive.confidenceScore,
          rawText: primitive.rawText,
          flags: primitive.flags,
          contentHash: createHash("sha256").update(`${primitive.sourceEntryId}:${primitive.rawText}`).digest("hex"),
          ...spatial,
        }).returning();
        eventCount++;
        if (event.confidenceScore < 0.3) continue;
        const links = await causalGraphService.mapEventToGraph(event);
        await worldModelBridgeService.emitStateTransition(event, links);
        transitionCount++;
      }
    }
    return { entries: entries.length, events: eventCount, transitions: transitionCount };
  }

  // ============================================================================
  // POLLING LIFECYCLE HELPERS
  // ============================================================================

  /**
   * Handle a successful poll: update lastPollAt, lastSuccessAt, reset failures,
   * and restore status from "degraded" to "active" if applicable.
   */
  private async handlePollSuccess(feed: SignalFeedConfig): Promise<void> {
    const now = new Date();
    const updates: Record<string, unknown> = {
      lastPollAt: now,
      lastSuccessAt: now,
      consecutiveFailures: 0,
      updatedAt: now,
    };

    // If feed was degraded, restore to active
    if (feed.status === "degraded") {
      updates.status = "active";
      logger.info(
        `Feed "${feed.name}" (id=${feed.id}) restored from degraded to active`
      );
    }

    await db
      .update(signalFeeds)
      .set(updates)
      .where(eq(signalFeeds.id, feed.id));
  }

  /**
   * Handle a poll failure: increment consecutive failures, apply exponential backoff.
   * After 3 consecutive failures, mark feed as "degraded" and double the polling interval.
   */
  private async handlePollFailure(
    feed: SignalFeedConfig,
    error: unknown
  ): Promise<void> {
    const now = new Date();
    const newFailureCount = feed.consecutiveFailures + 1;
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    logger.warn(
      `Poll failed for feed "${feed.name}" (id=${feed.id}), failure #${newFailureCount}: ${errorMessage}`
    );

    const updates: Record<string, unknown> = {
      lastPollAt: now,
      consecutiveFailures: newFailureCount,
      updatedAt: now,
    };

    // After 3 consecutive failures, mark as degraded and double interval
    if (newFailureCount >= MAX_CONSECUTIVE_FAILURES && feed.status !== "degraded") {
      updates.status = "degraded";
      updates.pollingIntervalSeconds = feed.pollingIntervalSeconds * 2;
      logger.warn(
        `Feed "${feed.name}" (id=${feed.id}) marked as degraded after ${newFailureCount} consecutive failures. Interval doubled to ${feed.pollingIntervalSeconds * 2}s`
      );
    }

    await db
      .update(signalFeeds)
      .set(updates)
      .where(eq(signalFeeds.id, feed.id));
  }

  /**
   * Get the backoff delay for the current failure count.
   * Uses exponential backoff: 30s, 60s, 120s (capped).
   */
  getBackoffDelayMs(consecutiveFailures: number): number {
    const index = Math.min(consecutiveFailures, BACKOFF_DELAYS_MS.length - 1);
    return BACKOFF_DELAYS_MS[index];
  }

  // ============================================================================
  // VALIDATION HELPERS
  // ============================================================================

  private validateUrl(url: string): void {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new ValidationError(
          `Invalid feed URL protocol "${parsed.protocol}". Must be http or https.`
        );
      }
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      throw new ValidationError(
        `Invalid feed URL format: "${url}". Must be a valid HTTP/HTTPS URL.`
      );
    }
  }

  private validatePollingInterval(seconds: number): void {
    if (
      typeof seconds !== "number" ||
      !Number.isFinite(seconds) ||
      seconds < MIN_POLLING_INTERVAL_SECONDS ||
      seconds > MAX_POLLING_INTERVAL_SECONDS
    ) {
      throw new ValidationError(
        `Polling interval must be between ${MIN_POLLING_INTERVAL_SECONDS} and ${MAX_POLLING_INTERVAL_SECONDS} seconds. Received: ${seconds}`
      );
    }
  }

  private validateAuthCredentials(creds: { type: string; token: string }): void {
    if (!creds.type || creds.type.trim().length === 0) {
      throw new ValidationError(
        "Auth credentials type is required when credentials are provided"
      );
    }
    if (!creds.token || creds.token.trim().length === 0) {
      throw new ValidationError(
        "Auth credentials token is required when credentials are provided"
      );
    }
  }

  // ============================================================================
  // DATA HELPERS
  // ============================================================================

  /**
   * Count active (enabled, non-disabled) feeds for an organization.
   */
  private async getActiveFeedCount(orgId: number): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(signalFeeds)
      .where(
        and(
          eq(signalFeeds.organizationId, orgId),
          eq(signalFeeds.enabled, true)
        )
      );

    return result[0]?.count ?? 0;
  }

  /**
   * Compute SHA-256 hash of entry content for deduplication.
   */
  private computeContentHash(entry: FeedEntry): string {
    const hashInput = `${entry.sourceUrl}:${entry.title}:${entry.content}`;
    return createHash("sha256").update(hashInput).digest("hex");
  }

  /**
   * Fetch entries from the configured feed source since the given date.
   * This is the I/O boundary — in production this calls the actual feed API.
   * Subclassed or mocked per source type in integration tests.
   */
  private async fetchFeedEntries(
    feed: SignalFeedConfig,
    since: Date
  ): Promise<FeedEntry[]> {
    const fetcher = this.getFetcher(feed.sourceType as FeedSourceType);
    return fetcher(feed, since);
  }

  /**
   * Resolve the fetcher for a source type: the registered one if there is one,
   * otherwise the generic HTTP fetcher.
   *
   * The fallback is deliberate and load-bearing — `rss`, `rest_api` and
   * `webhook` are genuinely "GET a URL and parse the body", so they need no
   * dedicated implementation. It is only a bug when a source type that needs
   * real transport work silently rides the fallback, which is why
   * `registerFeedFetcher` logs and `registeredFetcherTypes` is exposed.
   */
  getFetcher(sourceType: FeedSourceType): FeedFetcher {
    const registered = FETCHER_REGISTRY.get(sourceType);
    if (registered) return registered;
    return this.baseFetcher.bind(this);
  }

  /**
   * Generic HTTP fetcher — retrieves and parses RSS/Atom or JSON over plain
   * HTTP. Used for any source type without a registered fetcher.
   */
  private async baseFetcher(
    feed: SignalFeedConfig,
    since: Date
  ): Promise<FeedEntry[]> {
    validateUrlForSSRF(feed.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      // Resolved through the encrypted store rather than read off the row —
      // the row holds only a non-secret descriptor. Legacy cleartext rows are
      // still honoured so an un-migrated deployment keeps polling.
      const credentials = await resolveFeedCredentials(feed);
      const headers: Record<string, string> = { accept: "application/rss+xml, application/atom+xml, application/json, text/plain;q=0.8" };
      if (credentials?.token) headers.authorization = credentials.type === "basic" ? `Basic ${credentials.token}` : `Bearer ${credentials.token}`;
      const response = await fetch(feed.url, { headers, signal: controller.signal });
      if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();
      const rows: any[] = contentType.includes("json") ? this.parseJsonFeed(body) : this.parseXmlFeed(body);
      return rows.map((row, index) => {
        const published = row.publishedAt ? new Date(row.publishedAt) : null;
        return {
          id: String(row.id ?? `${feed.id}-${index}-${createHash("sha1").update(String(row.title ?? row.content)).digest("hex")}`),
          feedId: feed.id,
          organizationId: feed.organizationId,
          sourceUrl: String(row.url ?? feed.url),
          title: String(row.title ?? "Untitled signal"),
          content: String(row.content ?? row.summary ?? row.title ?? ""),
          publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
          retrievedAt: new Date(),
          rawData: row,
        } satisfies FeedEntry;
      }).filter(entry => !entry.publishedAt || entry.publishedAt > since);
    } finally {
      clearTimeout(timer);
    }
  }

  private parseJsonFeed(body: string): any[] {
    const parsed = JSON.parse(body);
    const rows = Array.isArray(parsed) ? parsed : parsed.items ?? parsed.data ?? parsed.results ?? [parsed];
    return rows.map((row: any) => ({
      id: row.id ?? row.guid ?? row.key,
      title: row.title ?? row.name ?? row.eventType,
      content: row.content ?? row.description ?? row.summary ?? JSON.stringify(row),
      summary: row.summary,
      url: row.url ?? row.link,
      publishedAt: row.publishedAt ?? row.published_at ?? row.pubDate ?? row.date ?? row.timestamp,
    }));
  }

  private parseXmlFeed(body: string): any[] {
    const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(body);
    const raw = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
    const rows = Array.isArray(raw) ? raw : [raw];
    return rows.filter(Boolean).map((row: any) => ({
      id: row.guid?.["#text"] ?? row.guid ?? row.id,
      title: row.title?.["#text"] ?? row.title,
      content: row["content:encoded"] ?? row.content?.["#text"] ?? row.content ?? row.description ?? row.summary?.["#text"] ?? row.summary,
      url: row.link?.["@_href"] ?? row.link,
      publishedAt: row.pubDate ?? row.published ?? row.updated,
    }));
  }

  async getFeedById(id: number, orgId: number) {
    const [feed] = await db
      .select()
      .from(signalFeeds)
      .where(and(eq(signalFeeds.id, id), eq(signalFeeds.organizationId, orgId)))
      .limit(1);
    return feed ?? null;
  }

  async injectManualEvent(values: any) {
    const [event] = await db.insert(eventPrimitives).values(values).returning();
    return event;
  }

  async findEvent(id: string, orgId: number, projectId?: number) {
    const [event] = await db
      .select({ id: eventPrimitives.id })
      .from(eventPrimitives)
      .where(
        and(
          eq(eventPrimitives.id, id),
          eq(eventPrimitives.organizationId, orgId),
          projectId == null
            ? isNull(eventPrimitives.projectId)
            : or(eq(eventPrimitives.projectId, projectId), isNull(eventPrimitives.projectId))
        )
      )
      .limit(1);
    return event ?? null;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const signalIngestionService = new SignalIngestionService();
