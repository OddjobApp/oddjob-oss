/**
 * Property-based tests for Signal Ingestion Service
 *
 * Feature: hat-menu-intent-router
 *
 * Properties tested:
 * - Property 21: Feed validation rejects invalid configurations — bad URLs, intervals outside [30, 86400]
 * - Property 22: Feed degradation after consecutive failures — 3 failures → degraded + doubled interval
 * - Property 23: Deduplication by content hash — duplicate within 72h discarded
 *
 * **Validates: Requirements 13.2, 13.5, 13.6, 13.8**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { createHash } from "crypto";

// ─── Mock setup ─────────────────────────────────────────────────────────────

// Track db operations
let dbUpdateCaptured: Record<string, unknown> = {};
let dbSelectResult: any[] = [{ count: 0 }];
let dbInsertResult: any[] = [{
  id: 1,
  organizationId: 1,
  name: "test-feed",
  sourceType: "rss",
  url: "https://example.com/feed",
  authCredentials: null,
  pollingIntervalSeconds: 300,
  enabled: true,
  status: "active",
  consecutiveFailures: 0,
  lastPollAt: null,
  lastSuccessAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}];

vi.mock("@server/database_service.js", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => dbInsertResult),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => dbSelectResult),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((updates: Record<string, unknown>) => {
        dbUpdateCaptured = updates;
        return {
          where: vi.fn(async () => undefined),
        };
      }),
    })),
  },
}));

// Mock Redis with in-memory store
const mockRedisStore = new Map<string, string>();

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: {
    set: vi.fn(async (key: string, value: string, _ex: string, _ttl: number, nx: string) => {
      if (nx === "NX") {
        if (mockRedisStore.has(key)) {
          return null; // Key exists → duplicate
        }
        mockRedisStore.set(key, value);
        return "OK";
      }
      mockRedisStore.set(key, value);
      return "OK";
    }),
    xadd: vi.fn(async () => "stream-id-1"),
  },
}));

// Mock logger
vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock errors module
vi.mock("@server/utils/errors.js", () => {
  class ValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ValidationError";
    }
  }
  return { ValidationError };
});

// Mock drizzle-orm (partial — keep actual exports for schema loading)
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    and: vi.fn((...args: any[]) => args),
    eq: vi.fn((a: any, b: any) => ({ field: a, value: b })),
  };
});

// Import AFTER mocks are established
import { SignalIngestionService, type FeedEntry } from "./signal-ingestion.service.js";
import { ValidationError } from "@server/utils/errors.js";

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Generate an invalid URL string (not parseable as http/https URL) */
const invalidUrlArb = fc.oneof(
  fc.stringOf(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*".split("")),
    { minLength: 1, maxLength: 30 }
  ).filter((s) => {
    try {
      const parsed = new URL(s);
      return !["http:", "https:"].includes(parsed.protocol);
    } catch {
      return true;
    }
  }),
  fc.constantFrom(
    "ftp://example.com/feed",
    "file:///etc/passwd",
    "ws://example.com/feed",
    "not-a-url",
    "://missing-protocol.com",
    "javascript:alert(1)",
    "data:text/html,hi",
    "abc",
    "123.456",
    "/relative/path"
  )
);

/** Generate a valid URL string */
const validUrlArb = fc.tuple(
  fc.constantFrom("http", "https"),
  fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), { minLength: 3, maxLength: 15 }),
  fc.constantFrom(".com", ".org", ".io", ".gov", ".net"),
  fc.stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz/".split("")), { minLength: 0, maxLength: 10 })
).map(([protocol, domain, tld, path]) => `${protocol}://${domain}${tld}/${path}`);

/** Generate an interval outside the valid range [30, 86400] */
const invalidIntervalArb = fc.oneof(
  fc.integer({ min: -10000, max: 29 }),
  fc.integer({ min: 86401, max: 1000000 })
);

/** Generate a valid interval within [30, 86400] */
const validIntervalArb = fc.integer({ min: 30, max: 86400 });

/** Generate a valid feed source type */
const feedSourceTypeArb = fc.constantFrom(
  "rss" as const,
  "sec_filing" as const,
  "eu_legislative" as const,
  "central_bank" as const,
  "trade_policy" as const,
  "geo_spatial" as const
);

/** Generate a valid feed name */
const feedNameArb = fc.stringOf(
  fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_".split("")),
  { minLength: 1, maxLength: 30 }
).filter((s) => s.trim().length > 0);

/** Generate a feed entry for deduplication testing */
const feedEntryArb: fc.Arbitrary<FeedEntry> = fc.record({
  id: fc.uuid(),
  feedId: fc.integer({ min: 1, max: 1000 }),
  organizationId: fc.integer({ min: 1, max: 1000 }),
  sourceUrl: validUrlArb,
  title: fc.string({ minLength: 1, maxLength: 50 }),
  content: fc.string({ minLength: 1, maxLength: 200 }),
  publishedAt: fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
  retrievedAt: fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
  rawData: fc.constant({} as Record<string, unknown>),
}) as fc.Arbitrary<FeedEntry>;

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Feature: hat-menu-intent-router, Property 21: Feed validation rejects invalid configurations", () => {
  let service: SignalIngestionService;

  beforeEach(() => {
    service = new SignalIngestionService();
  });

  /**
   * Property 21: Feed validation rejects invalid configurations
   *
   * For any signal feed configuration with an invalid URL format,
   * the system SHALL reject the configuration with a descriptive validation error.
   *
   * **Validates: Requirements 13.2**
   */
  it("rejects feeds with invalid URLs", async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidUrlArb,
        validIntervalArb,
        feedSourceTypeArb,
        feedNameArb,
        async (url, interval, sourceType, name) => {
          await expect(
            service.configureFeed(1, {
              name,
              sourceType,
              url,
              pollingIntervalSeconds: interval,
            })
          ).rejects.toThrow(ValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 21: Feed validation rejects invalid configurations
   *
   * For any signal feed configuration with a polling interval outside [30, 86400],
   * the system SHALL reject the configuration with a descriptive validation error.
   *
   * **Validates: Requirements 13.2**
   */
  it("rejects feeds with intervals outside [30, 86400]", async () => {
    await fc.assert(
      fc.asyncProperty(
        validUrlArb,
        invalidIntervalArb,
        feedSourceTypeArb,
        feedNameArb,
        async (url, interval, sourceType, name) => {
          await expect(
            service.configureFeed(1, {
              name,
              sourceType,
              url,
              pollingIntervalSeconds: interval,
            })
          ).rejects.toThrow(ValidationError);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 21: Feed validation rejects invalid configurations
   *
   * For any valid configuration (valid URL + interval within bounds),
   * the system SHALL accept the configuration without throwing.
   *
   * **Validates: Requirements 13.2**
   */
  it("accepts feeds with valid URLs and intervals within [30, 86400]", async () => {
    dbSelectResult = [{ count: 0 }];

    await fc.assert(
      fc.asyncProperty(
        validUrlArb,
        validIntervalArb,
        feedSourceTypeArb,
        feedNameArb,
        async (url, interval, sourceType, name) => {
          const result = await service.configureFeed(1, {
            name,
            sourceType,
            url,
            pollingIntervalSeconds: interval,
          });
          expect(result).toBeDefined();
        }
      ),
      { numRuns: 50 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 22: Feed degradation after consecutive failures", () => {
  let service: SignalIngestionService;

  beforeEach(() => {
    service = new SignalIngestionService();
    dbUpdateCaptured = {};
  });

  /**
   * Property 22: Feed degradation after consecutive failures
   *
   * For any signal feed with exactly 2 consecutive failures (next will be 3rd),
   * its status SHALL become "degraded" and its effective polling interval
   * SHALL be double the configured interval.
   *
   * **Validates: Requirements 13.5, 13.6**
   */
  it("marks feed as degraded after 3 consecutive failures and doubles interval", async () => {
    await fc.assert(
      fc.asyncProperty(
        validIntervalArb,
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        async (interval, feedId, orgId) => {
          dbUpdateCaptured = {};

          const feed = {
            id: feedId,
            organizationId: orgId,
            name: "test-feed",
            sourceType: "rss" as const,
            url: "https://example.com/feed",
            authCredentials: null,
            pollingIntervalSeconds: interval,
            enabled: true,
            status: "active" as const,
            consecutiveFailures: 2, // Next failure = 3rd → triggers degradation
            lastPollAt: null,
            lastSuccessAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          // Make fetch throw to trigger handlePollFailure
          vi.spyOn(service as any, "fetchFeedEntries").mockRejectedValueOnce(
            new Error("Network timeout")
          );

          await service.pollFeed(feed as any);

          // Verify degraded status and doubled interval
          expect(dbUpdateCaptured.status).toBe("degraded");
          expect(dbUpdateCaptured.pollingIntervalSeconds).toBe(interval * 2);
          expect(dbUpdateCaptured.consecutiveFailures).toBe(3);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 22: Feed degradation after consecutive failures
   *
   * A subsequent successful poll SHALL restore status to "active" and reset
   * the failure count.
   *
   * **Validates: Requirements 13.5, 13.6**
   */
  it("restores feed to active status after a successful poll when degraded", async () => {
    await fc.assert(
      fc.asyncProperty(
        validIntervalArb,
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        async (interval, feedId, orgId) => {
          dbUpdateCaptured = {};

          const feed = {
            id: feedId,
            organizationId: orgId,
            name: "test-feed",
            sourceType: "rss" as const,
            url: "https://example.com/feed",
            authCredentials: null,
            pollingIntervalSeconds: interval,
            enabled: true,
            status: "degraded" as const,
            consecutiveFailures: 3,
            lastPollAt: null,
            lastSuccessAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          // Make fetch succeed
          vi.spyOn(service as any, "fetchFeedEntries").mockResolvedValueOnce([]);

          await service.pollFeed(feed as any);

          // Verify restored to active and failures reset
          expect(dbUpdateCaptured.status).toBe("active");
          expect(dbUpdateCaptured.consecutiveFailures).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 22: Feed degradation after consecutive failures
   *
   * Feeds with fewer than 3 consecutive failures (0 or 1 current → next will be 1 or 2)
   * should NOT be marked as degraded.
   *
   * **Validates: Requirements 13.5, 13.6**
   */
  it("does not mark feed as degraded with fewer than 3 consecutive failures", async () => {
    await fc.assert(
      fc.asyncProperty(
        validIntervalArb,
        fc.integer({ min: 0, max: 1 }), // current failures = 0 or 1 → next = 1 or 2
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 1000 }),
        async (interval, currentFailures, feedId, orgId) => {
          dbUpdateCaptured = {};

          const feed = {
            id: feedId,
            organizationId: orgId,
            name: "test-feed",
            sourceType: "rss" as const,
            url: "https://example.com/feed",
            authCredentials: null,
            pollingIntervalSeconds: interval,
            enabled: true,
            status: "active" as const,
            consecutiveFailures: currentFailures,
            lastPollAt: null,
            lastSuccessAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          vi.spyOn(service as any, "fetchFeedEntries").mockRejectedValueOnce(
            new Error("Network timeout")
          );

          await service.pollFeed(feed as any);

          // Should NOT have degraded status
          expect(dbUpdateCaptured.status).toBeUndefined();
          expect(dbUpdateCaptured.consecutiveFailures).toBe(currentFailures + 1);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: hat-menu-intent-router, Property 23: Deduplication by content hash", () => {
  let service: SignalIngestionService;

  beforeEach(() => {
    service = new SignalIngestionService();
    mockRedisStore.clear();
  });

  /**
   * Property 23: Feed entry deduplication by content hash
   *
   * For any feed entry, calling deduplicateEntry the first time returns false
   * (new entry), and calling it a second time with the same content returns true
   * (duplicate detected).
   *
   * **Validates: Requirements 13.8**
   */
  it("first call returns false (new entry), second call returns true (duplicate)", async () => {
    await fc.assert(
      fc.asyncProperty(feedEntryArb, async (entry) => {
        mockRedisStore.clear();

        // First call: entry is new → should return false
        const firstResult = await service.deduplicateEntry(entry);
        expect(firstResult).toBe(false);

        // Second call: same entry → should return true (duplicate)
        const secondResult = await service.deduplicateEntry(entry);
        expect(secondResult).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 23: Feed entry deduplication by content hash
   *
   * Entries with different content (sourceUrl + title + content) produce different
   * hashes and are NOT considered duplicates of each other.
   *
   * **Validates: Requirements 13.8**
   */
  it("entries with different content are not considered duplicates", async () => {
    // Use two entries guaranteed to have different content by construction
    const entryPairArb = fc.tuple(
      feedEntryArb,
      fc.string({ minLength: 1, maxLength: 50 })
    ).map(([entry, suffix]) => {
      const entry2: FeedEntry = {
        ...entry,
        content: entry.content + suffix + "_unique",
      };
      return [entry, entry2] as const;
    });

    await fc.assert(
      fc.asyncProperty(entryPairArb, async ([entry1, entry2]) => {
        mockRedisStore.clear();

        // Insert first entry — should be new
        const result1 = await service.deduplicateEntry(entry1);
        expect(result1).toBe(false);

        // Insert second entry (different content) — should also be new
        const result2 = await service.deduplicateEntry(entry2);
        expect(result2).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 23: Feed entry deduplication by content hash
   *
   * The content hash is computed deterministically from sourceUrl:title:content
   * using SHA-256.
   *
   * **Validates: Requirements 13.8**
   */
  it("deduplication uses SHA-256 of sourceUrl:title:content", async () => {
    await fc.assert(
      fc.asyncProperty(feedEntryArb, async (entry) => {
        mockRedisStore.clear();

        // Compute expected hash
        const hashInput = `${entry.sourceUrl}:${entry.title}:${entry.content}`;
        const expectedHash = createHash("sha256").update(hashInput).digest("hex");
        const expectedKey = `signal:dedup:${expectedHash}`;

        // Call deduplicateEntry
        await service.deduplicateEntry(entry);

        // Verify the correct key was stored in Redis
        expect(mockRedisStore.has(expectedKey)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
