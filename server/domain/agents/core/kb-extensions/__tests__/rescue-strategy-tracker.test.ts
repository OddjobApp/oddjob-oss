import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mock references ---
const mockRedis = vi.hoisted(() => ({
  zadd: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  zcount: vi.fn().mockResolvedValue(0),
  zrangebyscore: vi.fn().mockResolvedValue([]),
  incr: vi.fn().mockResolvedValue(1),
}));

const mockCreateQuestion = vi.hoisted(() => vi.fn().mockResolvedValue(42));

const mockDbWhere = vi.hoisted(() => vi.fn().mockResolvedValue([]));

const mockLoggerWarn = vi.hoisted(() => vi.fn());
const mockLoggerInfo = vi.hoisted(() => vi.fn());

// --- Mocks ---

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: mockRedis,
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: mockLoggerInfo,
    debug: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
  }),
}));

vi.mock("../../knowledge-base-question-engine.service.js", () => ({
  knowledgeBaseQuestionEngineService: {
    createQuestion: (...args: any[]) => mockCreateQuestion(...args),
  },
}));

vi.mock("@server/database_service.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: any[]) => mockDbWhere(...args),
      }),
    }),
  },
}));

vi.mock("@shared/schema/index.js", () => ({
  knowledgeBaseQuestions: {
    id: "id",
    organizationId: "organization_id",
    repositoryId: "repository_id",
    triggerSource: "trigger_source",
    status: "status",
    contextData: "context_data",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: any, b: any) => ({ type: "eq", a, b }),
  and: (...args: any[]) => ({ type: "and", args }),
}));

// --- Import after mocks ---
import { rescueStrategyTrackerService } from "../rescue-strategy-tracker.service.js";

describe("rescueStrategyTrackerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.zcount.mockResolvedValue(0);
    mockRedis.zrangebyscore.mockResolvedValue([]);
    mockRedis.incr.mockResolvedValue(1);
    mockCreateQuestion.mockResolvedValue(42);
    mockDbWhere.mockResolvedValue([]);
  });

  describe("recordAndCheck", () => {
    it("records event to sorted set with correct score (timestamp as score)", async () => {
      const now = Date.now();
      mockRedis.zcount.mockResolvedValue(1);

      await rescueStrategyTrackerService.recordAndCheck(1, "repo-x", {
        strategy: "retry",
        jobType: "build",
        missionRunId: 500,
        timestamp: now,
      });

      expect(mockRedis.zadd).toHaveBeenCalledTimes(1);
      const [key, score, member] = mockRedis.zadd.mock.calls[0];
      expect(key).toBe("rescue_events:1:retry:build");
      expect(score).toBe(now);
      expect(member).toBe(`500:${now}`);
    });

    it("sets 8-day TTL on the Redis key after writing", async () => {
      const now = Date.now();
      mockRedis.zcount.mockResolvedValue(1);

      await rescueStrategyTrackerService.recordAndCheck(1, "repo-x", {
        strategy: "skip",
        jobType: "deploy",
        missionRunId: 600,
        timestamp: now,
      });

      expect(mockRedis.expire).toHaveBeenCalledTimes(1);
      const [key, ttl] = mockRedis.expire.mock.calls[0];
      expect(key).toBe("rescue_events:1:skip:deploy");
      expect(ttl).toBe(8 * 24 * 60 * 60); // 691200 seconds
    });

    it("triggers question creation when threshold=3 is reached", async () => {
      const now = Date.now();
      mockRedis.zcount.mockResolvedValue(3);
      mockDbWhere.mockResolvedValue([]); // No pending duplicate
      mockRedis.zrangebyscore.mockResolvedValue([
        `101:${now - 5000}`,
        `102:${now - 3000}`,
        `103:${now - 1000}`,
      ]);

      await rescueStrategyTrackerService.recordAndCheck(1, "repo-main", {
        strategy: "relax",
        jobType: "test",
        missionRunId: 103,
        timestamp: now - 1000,
      });

      expect(mockCreateQuestion).toHaveBeenCalledTimes(1);
      expect(mockCreateQuestion).toHaveBeenCalledWith(
        1,
        "repo-main",
        "rescue_pattern_detected",
        expect.objectContaining({
          strategy: "relax",
          jobType: "test",
          count: 3,
          missionRunIds: [101, 102, 103],
        })
      );
    });

    it("does NOT trigger question creation when count < 3", async () => {
      const now = Date.now();
      mockRedis.zcount.mockResolvedValue(2);

      await rescueStrategyTrackerService.recordAndCheck(1, "repo-main", {
        strategy: "retry",
        jobType: "build",
        missionRunId: 200,
        timestamp: now,
      });

      expect(mockCreateQuestion).not.toHaveBeenCalled();
    });

    it("excludes events outside 7-day window from count (uses zcount with window boundaries)", async () => {
      const now = Date.now();
      // zcount is called with windowStart to "+inf" — events outside the window
      // are automatically excluded by Redis. We verify the correct boundaries are used.
      mockRedis.zcount.mockResolvedValue(1); // Only 1 event in window

      await rescueStrategyTrackerService.recordAndCheck(1, "repo-main", {
        strategy: "retry",
        jobType: "build",
        missionRunId: 300,
        timestamp: now,
      });

      // Verify zcount was called with the correct window boundaries
      expect(mockRedis.zcount).toHaveBeenCalledTimes(1);
      const [key, windowStart, windowEnd] = mockRedis.zcount.mock.calls[0];
      expect(key).toBe("rescue_events:1:retry:build");
      // windowStart should be approximately now - 7 days in ms
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(windowStart).toBeGreaterThan(now - sevenDaysMs - 1000);
      expect(windowStart).toBeLessThanOrEqual(now - sevenDaysMs + 1000);
      expect(windowEnd).toBe("+inf");

      // Since count=1 < threshold=3, no question should be created
      expect(mockCreateQuestion).not.toHaveBeenCalled();
    });

    it("skips question creation when pending question exists for same strategy+jobType (deduplication)", async () => {
      const now = Date.now();
      mockRedis.zcount.mockResolvedValue(5); // Above threshold

      // Simulate existing pending question for same strategy+jobType
      mockDbWhere.mockResolvedValue([
        {
          id: 99,
          organizationId: 1,
          triggerSource: "rescue_pattern_detected",
          status: "pending",
          contextData: { strategy: "retry", jobType: "build" },
        },
      ]);

      await rescueStrategyTrackerService.recordAndCheck(1, "repo-main", {
        strategy: "retry",
        jobType: "build",
        missionRunId: 400,
        timestamp: now,
      });

      // Should NOT create question because a pending duplicate exists
      expect(mockCreateQuestion).not.toHaveBeenCalled();
      // Should log info about skipping
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.stringContaining("Skipping duplicate")
      );
    });

    it("does NOT skip when pending question exists for a different strategy", async () => {
      const now = Date.now();
      mockRedis.zcount.mockResolvedValue(3);
      mockRedis.zrangebyscore.mockResolvedValue([
        `101:${now}`,
        `102:${now}`,
        `103:${now}`,
      ]);

      // Pending question exists but for a different strategy
      mockDbWhere.mockResolvedValue([
        {
          id: 99,
          organizationId: 1,
          triggerSource: "rescue_pattern_detected",
          status: "pending",
          contextData: { strategy: "skip", jobType: "build" },
        },
      ]);

      await rescueStrategyTrackerService.recordAndCheck(1, "repo-main", {
        strategy: "retry",
        jobType: "build",
        missionRunId: 400,
        timestamp: now,
      });

      // Should create question because the pending one is for a different strategy
      expect(mockCreateQuestion).toHaveBeenCalledTimes(1);
    });

    it("handles Redis failure gracefully — logs warning and does not throw", async () => {
      mockRedis.zadd.mockRejectedValue(new Error("Connection refused"));

      // Should not throw
      await expect(
        rescueStrategyTrackerService.recordAndCheck(1, "repo-main", {
          strategy: "retry",
          jobType: "build",
          missionRunId: 500,
          timestamp: Date.now(),
        })
      ).resolves.toBeUndefined();

      // Should NOT create a question (since Redis failed before threshold check)
      expect(mockCreateQuestion).not.toHaveBeenCalled();

      // Should have logged a warning
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to record/check rescue event"),
        expect.any(Object)
      );
    });

    it("handles Redis failure during zcount gracefully", async () => {
      mockRedis.zadd.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.zcount.mockRejectedValue(new Error("Redis timeout"));

      await expect(
        rescueStrategyTrackerService.recordAndCheck(1, "repo-main", {
          strategy: "retry",
          jobType: "build",
          missionRunId: 600,
          timestamp: Date.now(),
        })
      ).resolves.toBeUndefined();

      expect(mockCreateQuestion).not.toHaveBeenCalled();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to record/check rescue event"),
        expect.any(Object)
      );
    });

    it("daily cap is respected — createQuestion returns null when cap exceeded", async () => {
      const now = Date.now();
      mockRedis.zcount.mockResolvedValue(4);
      mockDbWhere.mockResolvedValue([]); // No pending duplicate
      mockRedis.zrangebyscore.mockResolvedValue([
        `101:${now}`,
        `102:${now}`,
        `103:${now}`,
        `104:${now}`,
      ]);

      // Simulate daily cap exceeded — createQuestion returns null
      mockCreateQuestion.mockResolvedValue(null);

      await rescueStrategyTrackerService.recordAndCheck(1, "repo-main", {
        strategy: "retry",
        jobType: "build",
        missionRunId: 104,
        timestamp: now,
      });

      // createQuestion is still called (the tracker delegates cap to createQuestion)
      expect(mockCreateQuestion).toHaveBeenCalledTimes(1);
      // The tracker doesn't throw even when cap returns null
    });

    it("creates question with count > 3 when more events are in window", async () => {
      const now = Date.now();
      mockRedis.zcount.mockResolvedValue(7);
      mockDbWhere.mockResolvedValue([]);
      mockRedis.zrangebyscore.mockResolvedValue([
        `1:${now}`, `2:${now}`, `3:${now}`, `4:${now}`,
        `5:${now}`, `6:${now}`, `7:${now}`,
      ]);

      await rescueStrategyTrackerService.recordAndCheck(1, "repo-main", {
        strategy: "replan",
        jobType: "integration",
        missionRunId: 7,
        timestamp: now,
      });

      expect(mockCreateQuestion).toHaveBeenCalledTimes(1);
      const context = mockCreateQuestion.mock.calls[0][3];
      expect(context.count).toBe(7);
      expect(context.missionRunIds).toHaveLength(7);
    });
  });

  describe("getWindowCount", () => {
    it("returns the count from Redis zcount with correct window boundaries", async () => {
      mockRedis.zcount.mockResolvedValue(5);

      const count = await rescueStrategyTrackerService.getWindowCount(1, "retry", "build");

      expect(count).toBe(5);
      expect(mockRedis.zcount).toHaveBeenCalledTimes(1);
      const [key, windowStart, windowEnd] = mockRedis.zcount.mock.calls[0];
      expect(key).toBe("rescue_events:1:retry:build");
      expect(typeof windowStart).toBe("number");
      expect(windowEnd).toBe("+inf");
    });

    it("returns 0 when Redis is unavailable", async () => {
      mockRedis.zcount.mockRejectedValue(new Error("Connection refused"));

      const count = await rescueStrategyTrackerService.getWindowCount(1, "retry", "build");

      expect(count).toBe(0);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to get window count"),
        expect.any(Object)
      );
    });
  });

  describe("hasPendingQuestion", () => {
    it("returns true when pending question exists for same strategy+jobType", async () => {
      mockDbWhere.mockResolvedValue([
        {
          id: 10,
          organizationId: 1,
          triggerSource: "rescue_pattern_detected",
          status: "pending",
          contextData: { strategy: "retry", jobType: "build" },
        },
      ]);

      const result = await rescueStrategyTrackerService.hasPendingQuestion(1, "retry", "build");
      expect(result).toBe(true);
    });

    it("returns false when no pending questions match", async () => {
      mockDbWhere.mockResolvedValue([]);

      const result = await rescueStrategyTrackerService.hasPendingQuestion(1, "retry", "build");
      expect(result).toBe(false);
    });

    it("returns false when pending question has different strategy", async () => {
      mockDbWhere.mockResolvedValue([
        {
          id: 10,
          contextData: { strategy: "skip", jobType: "build" },
        },
      ]);

      const result = await rescueStrategyTrackerService.hasPendingQuestion(1, "retry", "build");
      expect(result).toBe(false);
    });

    it("returns false on DB error (logs warning, doesn't throw)", async () => {
      mockDbWhere.mockRejectedValue(new Error("DB connection lost"));

      const result = await rescueStrategyTrackerService.hasPendingQuestion(1, "retry", "build");
      expect(result).toBe(false);
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining("Failed deduplication check")
      );
    });
  });
});
