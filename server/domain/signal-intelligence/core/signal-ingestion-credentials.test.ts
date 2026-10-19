/**
 * Guards that configureFeed never persists a token on the feed row.
 *
 * REGRESSION CONTEXT: configureFeed used to insert
 * `authCredentials: config.authCredentials ?? null`, writing the caller's token
 * straight into `signal_feeds.auth_credentials` — a plain jsonb column. The
 * assertion below is deliberately about what is absent from the INSERT, because
 * that is the property that was violated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedInsert: Record<string, unknown> = {};
let capturedUpdate: Record<string, unknown> = {};
let deletedIds: unknown[] = [];

const createdFeed = {
  id: 42,
  organizationId: 7,
  name: "test-feed",
  sourceType: "rest_api",
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
};

vi.mock("@server/database_service.js", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        capturedInsert = values;
        return { returning: vi.fn(async () => [createdFeed]) };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ count: 0 }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        capturedUpdate = values;
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ ...createdFeed, ...capturedUpdate }]),
          })),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async (arg: unknown) => {
        deletedIds.push(arg);
      }),
    })),
  },
}));

const storeFeedCredentialsMock = vi.fn(async (_org: number, _id: number, creds: any) => ({
  type: creds.type,
  storage: "encrypted" as const,
}));

vi.mock("./feed-credentials.service.js", () => ({
  storeFeedCredentials: (...args: any[]) => storeFeedCredentialsMock(...(args as [any, any, any])),
  resolveFeedCredentials: vi.fn(async () => null),
}));

import { signalIngestionService } from "./signal-ingestion.service.js";

describe("configureFeed credential handling", () => {
  beforeEach(() => {
    capturedInsert = {};
    capturedUpdate = {};
    deletedIds = [];
    vi.clearAllMocks();
    storeFeedCredentialsMock.mockImplementation(async (_o, _i, creds: any) => ({
      type: creds.type,
      storage: "encrypted" as const,
    }));
  });

  it("does not write the token into the feed row", async () => {
    await signalIngestionService.configureFeed(7, {
      name: "authed feed",
      sourceType: "rest_api",
      url: "https://example.com/feed",
      authCredentials: { type: "bearer", token: "super-secret-value" },
      pollingIntervalSeconds: 300,
    });

    expect(capturedInsert.authCredentials).toBeNull();
    expect(JSON.stringify(capturedInsert)).not.toContain("super-secret-value");
    expect(JSON.stringify(capturedUpdate)).not.toContain("super-secret-value");
  });

  it("routes the token to the encrypted store keyed by the new feed id", async () => {
    await signalIngestionService.configureFeed(7, {
      name: "authed feed",
      sourceType: "rest_api",
      url: "https://example.com/feed",
      authCredentials: { type: "bearer", token: "super-secret-value" },
      pollingIntervalSeconds: 300,
    });

    expect(storeFeedCredentialsMock).toHaveBeenCalledWith(7, 42, {
      type: "bearer",
      token: "super-secret-value",
    });
    expect(capturedUpdate.authCredentials).toEqual({
      type: "bearer",
      storage: "encrypted",
    });
  });

  it("leaves the row untouched when there are no credentials", async () => {
    await signalIngestionService.configureFeed(7, {
      name: "public feed",
      sourceType: "rss",
      url: "https://example.com/rss",
      pollingIntervalSeconds: 300,
    });

    expect(capturedInsert.authCredentials).toBeNull();
    expect(storeFeedCredentialsMock).not.toHaveBeenCalled();
  });

  it("removes the half-created feed if encrypting its credentials fails", async () => {
    storeFeedCredentialsMock.mockRejectedValue(new Error("ENCRYPTION_KEY missing"));

    await expect(
      signalIngestionService.configureFeed(7, {
        name: "authed feed",
        sourceType: "rest_api",
        url: "https://example.com/feed",
        authCredentials: { type: "bearer", token: "super-secret-value" },
        pollingIntervalSeconds: 300,
      })
    ).rejects.toThrow(/ENCRYPTION_KEY/);

    // A feed left behind here would poll unauthenticated and merely look broken.
    expect(deletedIds).toHaveLength(1);
  });
});
