/**
 * Tests for the signal ingestion fetcher registry.
 *
 * REGRESSION CONTEXT: `getFetcher(sourceType)` used to ignore its argument and
 * return the generic HTTP fetcher for every source type. Adding a value to
 * `feedSourceTypes` therefore validated, persisted and displayed while changing
 * nothing about how the feed was actually retrieved — a new "platform" could
 * appear supported end-to-end and silently ride an RSS GET.
 *
 * The load-bearing assertion here is the dispatch one: a registered fetcher must
 * be the function a real poll invokes. Registry bookkeeping alone would pass
 * even with the old always-fallback implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@server/database_service.js", () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    })),
  },
}));

import {
  signalIngestionService,
  registerFeedFetcher,
  unregisterFeedFetcher,
  registeredFetcherTypes,
  type FeedFetcher,
} from "./signal-ingestion.service.js";
import type { SignalFeedConfig } from "@shared/schema/index.js";

function makeFeed(overrides: Partial<SignalFeedConfig> = {}): SignalFeedConfig {
  return {
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
    ...overrides,
  } as SignalFeedConfig;
}

describe("signal ingestion fetcher registry", () => {
  beforeEach(() => {
    for (const type of registeredFetcherTypes()) unregisterFeedFetcher(type);
  });

  afterEach(() => {
    for (const type of registeredFetcherTypes()) unregisterFeedFetcher(type);
  });

  it("returns the registered fetcher for its source type", () => {
    const fetcher: FeedFetcher = async () => [];
    registerFeedFetcher("rest_api", fetcher);

    expect(signalIngestionService.getFetcher("rest_api")).toBe(fetcher);
  });

  it("does not apply a registration to other source types", () => {
    const fetcher: FeedFetcher = async () => [];
    registerFeedFetcher("rest_api", fetcher);

    expect(signalIngestionService.getFetcher("rss")).not.toBe(fetcher);
  });

  it("falls back to a usable fetcher for unregistered source types", () => {
    expect(typeof signalIngestionService.getFetcher("rss")).toBe("function");
    expect(registeredFetcherTypes()).toEqual([]);
  });

  it("reports which source types have a dedicated fetcher", () => {
    registerFeedFetcher("rest_api", async () => []);
    registerFeedFetcher("webhook", async () => []);

    expect(registeredFetcherTypes().sort()).toEqual(["rest_api", "webhook"]);
  });

  it("rejects a fetcher for a source type that is not in feedSourceTypes", () => {
    expect(() =>
      registerFeedFetcher("twitter" as any, async () => [])
    ).toThrow(/unknown source type/i);
  });

  it("invokes the registered fetcher when the feed is polled", async () => {
    // The regression guard: dispatch, not just storage.
    const entry = {
      id: "entry-1",
      feedId: 1,
      organizationId: 1,
      sourceUrl: "https://example.com/post/1",
      title: "Registered fetcher ran",
      content: "body",
      publishedAt: null,
      retrievedAt: new Date(),
      rawData: {},
    };
    const restFetcher = vi.fn(async () => [entry]);
    const rssFetcher = vi.fn(async () => []);
    registerFeedFetcher("rest_api", restFetcher);
    registerFeedFetcher("rss", rssFetcher);

    const entries = await signalIngestionService.pollFeed(
      makeFeed({ sourceType: "rest_api" })
    );

    expect(restFetcher).toHaveBeenCalledTimes(1);
    expect(rssFetcher).not.toHaveBeenCalled();
    expect(entries).toEqual([entry]);
  });

  it("passes the last success time through as the since bound", async () => {
    const lastSuccessAt = new Date("2026-08-01T00:00:00.000Z");
    const fetcher = vi.fn(async () => []);
    registerFeedFetcher("rest_api", fetcher);

    await signalIngestionService.pollFeed(
      makeFeed({ sourceType: "rest_api", lastSuccessAt })
    );

    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: "rest_api" }),
      lastSuccessAt
    );
  });
});
