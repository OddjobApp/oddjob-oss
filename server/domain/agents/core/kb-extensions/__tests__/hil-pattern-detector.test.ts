import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// --- Hoisted mock references ---
const mockRedis = vi.hoisted(() => ({
  zadd: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  zcard: vi.fn().mockResolvedValue(1),
}));

const mockCreateQuestion = vi.hoisted(() => vi.fn().mockResolvedValue(42));

const mockDbWhere = vi.hoisted(() => vi.fn().mockResolvedValue([]));

// --- Mocks ---

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: mockRedis,
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
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
import { hilPatternDetectorService } from "../hil-pattern-detector.service.js";

describe("hilPatternDetectorService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.zadd.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.zcard.mockResolvedValue(1);
    mockCreateQuestion.mockResolvedValue(42);
    mockDbWhere.mockResolvedValue([]);
  });

  describe("onApproval", () => {
    it("records the approval event to Redis sorted set with correct key", async () => {
      await hilPatternDetectorService.onApproval(1, "repo-abc", "create_file", { path: "/src", content: "hello" }, 100);

      // Verify zadd was called with the correct key pattern
      expect(mockRedis.zadd).toHaveBeenCalledTimes(1);
      const [key, score, member] = mockRedis.zadd.mock.calls[0];

      // Key should follow pattern: hil_approvals:{orgId}:{repoId}:{tool}:{paramKeysHash}
      const expectedHash = createHash("sha256")
        .update("content,path") // sorted keys: content, path
        .digest("hex")
        .slice(0, 16);
      expect(key).toBe(`hil_approvals:1:repo-abc:create_file:${expectedHash}`);

      // Score should be a Unix timestamp (number)
      expect(typeof score).toBe("number");

      // Member should include missionId
      expect(member).toMatch(/^100:\d+$/);
    });

    it("sets 30-day TTL on the Redis key", async () => {
      await hilPatternDetectorService.onApproval(1, "repo-abc", "create_file", { path: "/src" });

      expect(mockRedis.expire).toHaveBeenCalledTimes(1);
      const [, ttl] = mockRedis.expire.mock.calls[0];
      expect(ttl).toBe(30 * 24 * 60 * 60); // 2,592,000 seconds
    });

    it("does NOT trigger question creation when count is below threshold", async () => {
      mockRedis.zcard.mockResolvedValue(3);

      await hilPatternDetectorService.onApproval(1, "repo-abc", "create_file", { path: "/src" });

      expect(mockCreateQuestion).not.toHaveBeenCalled();
    });

    it("triggers question creation when count reaches threshold (5)", async () => {
      mockRedis.zcard.mockResolvedValue(5);

      await hilPatternDetectorService.onApproval(
        1, "repo-abc", "create_file",
        { path: "/src", content: "hello" },
        200
      );

      expect(mockCreateQuestion).toHaveBeenCalledTimes(1);
      expect(mockCreateQuestion).toHaveBeenCalledWith(
        1,
        "repo-abc",
        "hil_pattern_detected",
        {
          tool: "create_file",
          parameterKeys: ["content", "path"], // sorted
          approvalCount: 5,
          repositoryId: "repo-abc",
          sampleParams: { path: "/src", content: "hello" },
        }
      );
    });

    it("skips question creation if pending question already exists for the same tool", async () => {
      mockRedis.zcard.mockResolvedValue(7);
      // Simulate existing pending question for the same tool
      mockDbWhere.mockResolvedValue([
        { id: 99, contextData: { tool: "create_file" } },
      ]);

      await hilPatternDetectorService.onApproval(1, "repo-abc", "create_file", { path: "/src" });

      expect(mockCreateQuestion).not.toHaveBeenCalled();
    });

    it("proceeds with question creation if pending question is for a different tool", async () => {
      mockRedis.zcard.mockResolvedValue(5);
      // Pending question exists but for a different tool
      mockDbWhere.mockResolvedValue([
        { id: 99, contextData: { tool: "delete_file" } },
      ]);

      await hilPatternDetectorService.onApproval(1, "repo-abc", "create_file", { path: "/src" });

      expect(mockCreateQuestion).toHaveBeenCalledTimes(1);
    });

    it("uses missionId=0 in member when missionId is undefined", async () => {
      await hilPatternDetectorService.onApproval(1, "repo-abc", "create_file", { path: "/src" });

      const [, , member] = mockRedis.zadd.mock.calls[0];
      expect(member).toMatch(/^0:\d+$/);
    });

    it("handles Redis unavailability gracefully (does not throw)", async () => {
      mockRedis.zadd.mockRejectedValue(new Error("Connection refused"));

      // Should not throw
      await expect(
        hilPatternDetectorService.onApproval(1, "repo-abc", "create_file", { path: "/src" })
      ).resolves.toBeUndefined();

      // Should not attempt question creation
      expect(mockCreateQuestion).not.toHaveBeenCalled();
    });

    it("respects daily cap by delegating to createQuestion (which enforces the cap)", async () => {
      mockRedis.zcard.mockResolvedValue(5);
      mockDbWhere.mockResolvedValue([]); // no pending duplicates

      // Simulate createQuestion rejecting because daily cap is reached
      // (createQuestion internally increments a Redis counter and rejects if > 50)
      mockCreateQuestion.mockResolvedValue(undefined); // cap-rejected returns undefined

      await hilPatternDetectorService.onApproval(
        1, "repo-abc", "create_file", { path: "/src", content: "hello" }, 300
      );

      // Verify that createQuestion is always called (cap enforcement lives inside it)
      expect(mockCreateQuestion).toHaveBeenCalledTimes(1);
      expect(mockCreateQuestion).toHaveBeenCalledWith(
        1,
        "repo-abc",
        "hil_pattern_detected",
        expect.objectContaining({
          tool: "create_file",
          approvalCount: 5,
        })
      );
    });

    it("handles createQuestion failure gracefully when daily cap rejects", async () => {
      mockRedis.zcard.mockResolvedValue(6);
      mockDbWhere.mockResolvedValue([]); // no pending duplicates

      // Simulate createQuestion throwing an error (e.g., daily cap or DB failure)
      mockCreateQuestion.mockRejectedValue(new Error("Daily cap exceeded"));

      // Should not throw — error is caught by the try/catch wrapper
      await expect(
        hilPatternDetectorService.onApproval(1, "repo-abc", "create_file", { path: "/src" })
      ).resolves.toBeUndefined();
    });

    it("matches patterns by sorted keys regardless of param values", async () => {
      mockRedis.zcard.mockResolvedValue(2);

      // Two different param values but same keys
      await hilPatternDetectorService.onApproval(1, "repo-abc", "write_file", { path: "/a", content: "x" });
      await hilPatternDetectorService.onApproval(1, "repo-abc", "write_file", { path: "/b", content: "y" });

      // Both should use the same Redis key (same sorted keys hash)
      const key1 = mockRedis.zadd.mock.calls[0][0];
      const key2 = mockRedis.zadd.mock.calls[1][0];
      expect(key1).toBe(key2);
    });

    it("uses different keys for different param key sets", async () => {
      mockRedis.zcard.mockResolvedValue(2);

      await hilPatternDetectorService.onApproval(1, "repo-abc", "write_file", { path: "/a", content: "x" });
      await hilPatternDetectorService.onApproval(1, "repo-abc", "write_file", { path: "/a", mode: "append" });

      const key1 = mockRedis.zadd.mock.calls[0][0];
      const key2 = mockRedis.zadd.mock.calls[1][0];
      expect(key1).not.toBe(key2);
    });
  });

  describe("getPatternCount", () => {
    it("returns the count from Redis zcard", async () => {
      mockRedis.zcard.mockResolvedValue(7);

      const count = await hilPatternDetectorService.getPatternCount(
        1, "repo-abc", "create_file", ["content", "path"]
      );

      expect(count).toBe(7);
    });

    it("builds the correct Redis key from sorted parameter keys", async () => {
      mockRedis.zcard.mockResolvedValue(3);

      // Pass keys in unsorted order — should still produce same hash
      await hilPatternDetectorService.getPatternCount(
        1, "repo-abc", "create_file", ["path", "content"]
      );

      const expectedHash = createHash("sha256")
        .update("content,path") // sorted
        .digest("hex")
        .slice(0, 16);
      const expectedKey = `hil_approvals:1:repo-abc:create_file:${expectedHash}`;

      expect(mockRedis.zcard).toHaveBeenCalledWith(expectedKey);
    });

    it("returns 0 when Redis is unavailable", async () => {
      mockRedis.zcard.mockRejectedValue(new Error("Connection refused"));

      const count = await hilPatternDetectorService.getPatternCount(
        1, "repo-abc", "create_file", ["path"]
      );

      expect(count).toBe(0);
    });
  });
});
