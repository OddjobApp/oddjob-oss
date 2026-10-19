import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@server/database_service.js", () => {
  const mockSelect = vi.fn();
  return {
    db: {
      select: mockSelect,
    },
  };
});

import { db } from "@server/database_service.js";
import { saasAdapterFetcher } from "./saas-adapter-fetcher.js";
import type { SignalFeedConfig } from "@shared/schema/index.js";

describe("saasAdapterFetcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and maps Jira event log entries into FeedEntry items", async () => {
    const mockRows = [
      {
        eventId: "evt-jira-101",
        organizationId: 42,
        source: "jira",
        type: "jira.issue_created",
        subject: "PROJ-123",
        emittedAt: new Date("2026-10-03T12:00:00Z"),
        payload: {
          issue: {
            key: "PROJ-123",
            fields: {
              summary: "Critical database connection failure",
              description: "Connection pool exhausted on primary replica cluster.",
            },
          },
        },
      },
    ];

    const mockQueryBuilder: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(mockRows),
    };
    (db.select as any).mockReturnValue(mockQueryBuilder);

    const feed: SignalFeedConfig = {
      id: 99,
      organizationId: 42,
      name: "Jira Incidents",
      sourceType: "saas_adapter",
      url: "https://saas.internal/jira",
      pollingIntervalSeconds: 300,
      enabled: true,
      status: "active",
      consecutiveFailures: 0,
      lastPollAt: null,
      lastSuccessAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    const since = new Date("2026-10-03T11:00:00Z");
    const entries = await saasAdapterFetcher(feed, since);

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("saas-evt-jira-101");
    expect(entries[0].feedId).toBe(99);
    expect(entries[0].organizationId).toBe(42);
    expect(entries[0].title).toBe("[PROJ-123] Critical database connection failure");
    expect(entries[0].content).toContain("Connection pool exhausted");
    expect(entries[0].rawData).toMatchObject({
      platform: "jira",
      eventType: "jira.issue_created",
      source: "jira",
      subject: "PROJ-123",
      eventId: "evt-jira-101",
    });
  });

  it("extracts GitHub PR and Slack messages accurately", async () => {
    const mockRows = [
      {
        eventId: "evt-gh-202",
        organizationId: 42,
        source: "github",
        type: "github.pull_request.opened",
        subject: "pr/55",
        emittedAt: new Date("2026-10-03T12:05:00Z"),
        payload: {
          pull_request: {
            number: 55,
            title: "Upgrade telemetry transport to HTTP/2",
            description: "Improves multiplexing throughput.",
          },
        },
      },
      {
        eventId: "evt-slack-303",
        organizationId: 42,
        source: "slack",
        type: "slack.message_posted",
        subject: "channel/ops",
        emittedAt: new Date("2026-10-03T12:10:00Z"),
        payload: {
          message: {
            text: "High latency detected on EU payment gateway",
          },
        },
      },
    ];

    const mockQueryBuilder: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(mockRows),
    };
    (db.select as any).mockReturnValue(mockQueryBuilder);

    const feed: SignalFeedConfig = {
      id: 100,
      organizationId: 42,
      name: "SaaS Multi-Platform Ingress",
      sourceType: "saas_adapter",
      url: "https://saas.internal/events",
      pollingIntervalSeconds: 600,
      enabled: true,
      status: "active",
      consecutiveFailures: 0,
      lastPollAt: null,
      lastSuccessAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    const entries = await saasAdapterFetcher(feed, new Date("2026-10-03T11:00:00Z"));

    expect(entries).toHaveLength(2);
    expect(entries[0].title).toBe("PR #55: Upgrade telemetry transport to HTTP/2");
    expect(entries[1].title).toBe("Slack: High latency detected on EU payment gateway");
  });

  it("registers saas_adapter fetcher via registerBuiltInFetchers", async () => {
    const { registerBuiltInFetchers } = await import("./index.js");
    const { registeredFetcherTypes, signalIngestionService } = await import("../signal-ingestion.service.js");

    registerBuiltInFetchers();

    expect(registeredFetcherTypes()).toContain("saas_adapter");
    expect(signalIngestionService.getFetcher("saas_adapter")).toBe(saasAdapterFetcher);
  });
});

