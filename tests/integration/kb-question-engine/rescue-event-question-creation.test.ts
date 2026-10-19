/**
 * Integration Test: Rescue Event → KB Question Creation End-to-End
 *
 * Validates Requirements 1.1, 1.2, 1.5:
 * - When the same rescue strategy fires 3+ times for the same job type within 7 days,
 *   a `rescue_pattern_detected` question is created.
 * - The question context includes strategy, jobType, count, and missionRunIds.
 * - Events are recorded when RescueStrategyFactory.apply() completes a tracked strategy.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock infrastructure (hoisted) ---

const mockRedisStore = vi.hoisted(() => {
  /** In-memory sorted set store keyed by Redis key. Each entry: { score, member } */
  const sortedSets = new Map<string, Array<{ score: number; member: string }>>();
  /** Simple key-value store for counters, etc. */
  const kvStore = new Map<string, string>();

  return {
    sortedSets,
    kvStore,
    reset() {
      sortedSets.clear();
      kvStore.clear();
    },
  };
});

const mockRedis = vi.hoisted(() => ({
  zadd: vi.fn(async (key: string, score: number, member: string) => {
    if (!mockRedisStore.sortedSets.has(key)) {
      mockRedisStore.sortedSets.set(key, []);
    }
    mockRedisStore.sortedSets.get(key)!.push({ score, member });
    return 1;
  }),
  expire: vi.fn().mockResolvedValue(1),
  zcount: vi.fn(async (key: string, min: number | string, max: number | string) => {
    const entries = mockRedisStore.sortedSets.get(key) || [];
    const minScore = min === "-inf" ? -Infinity : Number(min);
    const maxScore = max === "+inf" ? Infinity : Number(max);
    return entries.filter((e) => e.score >= minScore && e.score <= maxScore).length;
  }),
  zrangebyscore: vi.fn(async (key: string, min: number | string, max: number | string) => {
    const entries = mockRedisStore.sortedSets.get(key) || [];
    const minScore = min === "-inf" ? -Infinity : Number(min);
    const maxScore = max === "+inf" ? Infinity : Number(max);
    return entries
      .filter((e) => e.score >= minScore && e.score <= maxScore)
      .map((e) => e.member);
  }),
  incr: vi.fn(async (key: string) => {
    const current = parseInt(mockRedisStore.kvStore.get(key) || "0", 10);
    const next = current + 1;
    mockRedisStore.kvStore.set(key, String(next));
    return next;
  }),
  get: vi.fn(async (key: string) => mockRedisStore.kvStore.get(key) || null),
  set: vi.fn(async (key: string, value: string) => {
    mockRedisStore.kvStore.set(key, value);
    return "OK";
  }),
  del: vi.fn().mockResolvedValue(1),
  on: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue("OK"),
}));

/** Track all questions that were "inserted" into the DB */
const createdQuestions = vi.hoisted(() => {
  const questions: Array<{
    id: number;
    organizationId: number;
    repositoryId: string;
    questionText: string;
    status: string;
    triggerSource: string;
    contextData: Record<string, any>;
    proposedAnswer: string | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];
  return { questions, reset() { questions.length = 0; } };
});

let questionIdCounter = 1;

// Mock the database service
vi.mock("@server/database_service.js", () => {
  const buildSelectChain = () => {
    let fromTableName = "";
    let insertData: any = null;

    const chain: any = {
      from: vi.fn((table: any) => {
        // Drizzle tables expose their SQL name via internal property
        // Try multiple access patterns used by Drizzle
        try {
          const symbols = Object.getOwnPropertySymbols(table);
          const nameSym = symbols.find((s) => s.toString().includes("Name"));
          if (nameSym) fromTableName = (table as any)[nameSym] || "";
        } catch { /* ignore */ }
        // Fallback: check if it has an "id" column with "org_id" name (orgs table)
        if (!fromTableName && table?.id?.name === "org_id") {
          fromTableName = "orgs";
        }
        // Fallback: check knowledge_base_questions table
        if (!fromTableName && table?.questionText) {
          fromTableName = "knowledge_base_questions";
        }
        return chain;
      }),
      where: vi.fn(() => chain),
      set: vi.fn(() => chain),
      values: vi.fn((data: any) => {
        insertData = data;
        return chain;
      }),
      returning: vi.fn(() => {
        if (insertData && insertData.triggerSource) {
          const record = {
            id: questionIdCounter++,
            ...insertData,
            createdAt: insertData.createdAt || new Date(),
            updatedAt: insertData.updatedAt || new Date(),
          };
          createdQuestions.questions.push(record);
          return Promise.resolve([record]);
        }
        return Promise.resolve([{ id: questionIdCounter++ }]);
      }),
      limit: vi.fn(() => {
        // After .limit(1) is called, the chain resolves to its data
        // This is the final awaitable - resolve based on table context
        const resolvedChain = {
          ...chain,
          then: (onFulfilled: (value: any[]) => any) => {
            if (fromTableName === "orgs") {
              return Promise.resolve([{ id: 42, name: "Acme Corp" }]).then(onFulfilled);
            }
            return Promise.resolve([]).then(onFulfilled);
          },
        };
        return resolvedChain;
      }),
      orderBy: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      then: (onFulfilled: (value: any[]) => any) => {
        if (fromTableName === "orgs") {
          return Promise.resolve([{ id: 42, name: "Acme Corp" }]).then(onFulfilled);
        }
        // Default: empty array (no pending duplicates, no existing questions)
        return Promise.resolve([]).then(onFulfilled);
      },
      catch: (onRejected: (reason: any) => any) => Promise.resolve([]).catch(onRejected),
    };

    return chain;
  };

  const buildInsertChain = () => {
    let insertData: any = null;

    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      set: vi.fn(() => chain),
      values: vi.fn((data: any) => {
        insertData = data;
        return chain;
      }),
      returning: vi.fn(() => {
        if (insertData && insertData.triggerSource) {
          const record = {
            id: questionIdCounter++,
            ...insertData,
            createdAt: insertData.createdAt || new Date(),
            updatedAt: insertData.updatedAt || new Date(),
          };
          createdQuestions.questions.push(record);
          return Promise.resolve([record]);
        }
        return Promise.resolve([{ id: questionIdCounter++ }]);
      }),
      limit: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      then: (onFulfilled: (value: any[]) => any) => Promise.resolve([]).then(onFulfilled),
      catch: (onRejected: (reason: any) => any) => Promise.resolve([]).catch(onRejected),
    };

    return chain;
  };

  return {
    db: {
      select: vi.fn(() => buildSelectChain()),
      insert: vi.fn(() => buildInsertChain()),
      update: vi.fn(() => buildSelectChain()),
      delete: vi.fn(() => buildSelectChain()),
    },
    pool: { on: vi.fn(), end: vi.fn() },
    checkDatabaseConnection: vi.fn().mockResolvedValue({ connected: true }),
  };
});

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: mockRedis,
  subscriber: mockRedis,
  publisher: mockRedis,
  nodeRedisClient: mockRedis,
  redisService: {
    client: mockRedis,
    subscriber: mockRedis,
    publisher: mockRedis,
    getOptions: () => ({ host: "localhost", port: 6379 }),
  },
  redisManager: {
    client: mockRedis,
    subscriber: mockRedis,
    publisher: mockRedis,
    getOptions: () => ({ host: "localhost", port: 6379 }),
  },
  getRedisClient: () => mockRedis,
  getRedisOptions: () => ({ host: "localhost", port: 6379 }),
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock the AI service for question text generation
vi.mock("@domain/ai/core/system-ai.service.js", () => ({
  systemAiService: {
    ask: vi.fn().mockResolvedValue("Mocked AI answer"),
    generateJson: vi.fn().mockResolvedValue({
      questionText: "Why does the retry rescue strategy fire repeatedly for build jobs?",
      proposedAnswer: "Consider adding a circuit breaker for repeated build failures.",
    }),
    getAiConfig: vi.fn().mockResolvedValue({
      provider: "google",
      model: "gemini-2.0-flash",
      apiKey: "test-key",
    }),
  },
}));

// Mock the memory service (used by resolveQuestion, not directly tested here)
vi.mock("@domain/agents/core/agent-memory-across-missions.service.js", () => ({
  agentMemoryAcrossMissionsService: {
    storeEntry: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock the Slack notification (not relevant to this test)
vi.mock("@domain/integrations/slack-service.js", () => ({
  getSlackClient: vi.fn().mockResolvedValue({
    getChannels: vi.fn().mockResolvedValue([]),
    postMessage: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock knowledge verification (not relevant to this test)
vi.mock("@domain/knowledge/core/knowledge-verification.service.js", () => ({
  knowledgeVerificationService: {
    approveNode: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock context-injection reference extractor
vi.mock("@domain/agents/core/context-injection/reference-extractor.js", () => ({
  extractReferences: vi.fn().mockReturnValue({ filePaths: [], symbols: [] }),
}));

// --- Import services under test (after mocks are set up) ---

import { rescueStrategyTrackerService } from "@domain/agents/core/kb-extensions/rescue-strategy-tracker.service.js";

// --- Test Suite ---

describe("Integration: Rescue Event → KB Question Creation", () => {
  const ORG_ID = 42;
  const REPO_ID = "https://github.com/acme/backend";
  const JOB_TYPE = "build";
  const STRATEGY = "retry";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisStore.reset();
    createdQuestions.reset();
    questionIdCounter = 1;
  });

  it("should create a rescue_pattern_detected question when threshold of 3 events is met within 7 days", async () => {
    const now = Date.now();
    const missionRunIds = [101, 102, 103];

    // Simulate 3 rescue events for the same strategy + jobType within 7 days
    for (let i = 0; i < 3; i++) {
      await rescueStrategyTrackerService.recordAndCheck(ORG_ID, REPO_ID, {
        strategy: STRATEGY,
        jobType: JOB_TYPE,
        missionRunId: missionRunIds[i],
        timestamp: now - (6 - i * 2) * 24 * 60 * 60 * 1000, // spread across last 6 days
      });
    }

    // Verify a question was created
    expect(createdQuestions.questions.length).toBe(1);

    const question = createdQuestions.questions[0];
    expect(question.triggerSource).toBe("rescue_pattern_detected");
    expect(question.organizationId).toBe(ORG_ID);
    expect(question.repositoryId).toBe(REPO_ID);
  });

  it("should include strategy, jobType, count, and missionRunIds in the question context", async () => {
    const now = Date.now();
    const missionRunIds = [201, 202, 203];

    for (let i = 0; i < 3; i++) {
      await rescueStrategyTrackerService.recordAndCheck(ORG_ID, REPO_ID, {
        strategy: "relax",
        jobType: "deploy",
        missionRunId: missionRunIds[i],
        timestamp: now - i * 1000, // all within the same second (within 7-day window)
      });
    }

    expect(createdQuestions.questions.length).toBe(1);

    const contextData = createdQuestions.questions[0].contextData;
    expect(contextData.strategy).toBe("relax");
    expect(contextData.jobType).toBe("deploy");
    expect(contextData.count).toBe(3);
    expect(contextData.missionRunIds).toEqual(expect.arrayContaining([201, 202, 203]));
    expect(contextData.missionRunIds).toHaveLength(3);
  });

  it("should NOT create a question when fewer than 3 events are recorded", async () => {
    const now = Date.now();

    // Only 2 events — below threshold
    await rescueStrategyTrackerService.recordAndCheck(ORG_ID, REPO_ID, {
      strategy: STRATEGY,
      jobType: JOB_TYPE,
      missionRunId: 301,
      timestamp: now - 2 * 24 * 60 * 60 * 1000,
    });

    await rescueStrategyTrackerService.recordAndCheck(ORG_ID, REPO_ID, {
      strategy: STRATEGY,
      jobType: JOB_TYPE,
      missionRunId: 302,
      timestamp: now - 1 * 24 * 60 * 60 * 1000,
    });

    expect(createdQuestions.questions.length).toBe(0);
  });

  it("should NOT count events outside the 7-day window toward the threshold", async () => {
    const now = Date.now();
    const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

    // 2 events outside the 7-day window (8 and 9 days ago)
    await rescueStrategyTrackerService.recordAndCheck(ORG_ID, REPO_ID, {
      strategy: STRATEGY,
      jobType: JOB_TYPE,
      missionRunId: 401,
      timestamp: now - EIGHT_DAYS_MS,
    });

    await rescueStrategyTrackerService.recordAndCheck(ORG_ID, REPO_ID, {
      strategy: STRATEGY,
      jobType: JOB_TYPE,
      missionRunId: 402,
      timestamp: now - (EIGHT_DAYS_MS + 24 * 60 * 60 * 1000),
    });

    // 2 events inside the 7-day window — still below threshold of 3
    await rescueStrategyTrackerService.recordAndCheck(ORG_ID, REPO_ID, {
      strategy: STRATEGY,
      jobType: JOB_TYPE,
      missionRunId: 403,
      timestamp: now - 2 * 24 * 60 * 60 * 1000,
    });

    await rescueStrategyTrackerService.recordAndCheck(ORG_ID, REPO_ID, {
      strategy: STRATEGY,
      jobType: JOB_TYPE,
      missionRunId: 404,
      timestamp: now - 1 * 24 * 60 * 60 * 1000,
    });

    // Should NOT have created a question (only 2 events within the 7-day window
    // because our mock zcount checks based on the score threshold vs current time)
    // Note: The old events are technically "stored" in the sorted set, but the
    // service uses `zcount` with a 7-day-ago lower bound, so they don't count.
    expect(createdQuestions.questions.length).toBe(0);
  });

  it("should record each event to the correct Redis sorted set key", async () => {
    const now = Date.now();

    await rescueStrategyTrackerService.recordAndCheck(ORG_ID, REPO_ID, {
      strategy: "skip",
      jobType: "test",
      missionRunId: 501,
      timestamp: now,
    });

    const expectedKey = `rescue_events:${ORG_ID}:skip:test`;
    expect(mockRedis.zadd).toHaveBeenCalledWith(
      expectedKey,
      now,
      `501:${now}`
    );
    expect(mockRedis.expire).toHaveBeenCalledWith(expectedKey, 8 * 24 * 60 * 60);
  });

  it("should treat different strategies as separate event streams", async () => {
    const now = Date.now();

    // 2 retry events
    for (let i = 0; i < 2; i++) {
      await rescueStrategyTrackerService.recordAndCheck(ORG_ID, REPO_ID, {
        strategy: "retry",
        jobType: JOB_TYPE,
        missionRunId: 600 + i,
        timestamp: now - i * 1000,
      });
    }

    // 2 replan events (different strategy, same jobType)
    for (let i = 0; i < 2; i++) {
      await rescueStrategyTrackerService.recordAndCheck(ORG_ID, REPO_ID, {
        strategy: "replan",
        jobType: JOB_TYPE,
        missionRunId: 700 + i,
        timestamp: now - i * 1000,
      });
    }

    // Neither should have triggered — both below threshold of 3
    expect(createdQuestions.questions.length).toBe(0);
  });

  it("should treat different job types as separate event streams", async () => {
    const now = Date.now();

    // 2 events for jobType "build"
    for (let i = 0; i < 2; i++) {
      await rescueStrategyTrackerService.recordAndCheck(ORG_ID, REPO_ID, {
        strategy: STRATEGY,
        jobType: "build",
        missionRunId: 800 + i,
        timestamp: now - i * 1000,
      });
    }

    // 2 events for jobType "deploy" (different jobType, same strategy)
    for (let i = 0; i < 2; i++) {
      await rescueStrategyTrackerService.recordAndCheck(ORG_ID, REPO_ID, {
        strategy: STRATEGY,
        jobType: "deploy",
        missionRunId: 900 + i,
        timestamp: now - i * 1000,
      });
    }

    // Neither should have triggered — both below threshold of 3
    expect(createdQuestions.questions.length).toBe(0);
  });
});
