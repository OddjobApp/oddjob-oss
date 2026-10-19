import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClassificationResult } from "@shared/schema/intent-router.js";

// In-memory mock Redis store
const mockStore = new Map<string, string>();
const mockSortedSets = new Map<string, Array<{ score: number; member: string }>>();
const mockSets = new Map<string, Set<string>>();
const mockHashes = new Map<string, Map<string, string>>();

const mockPipelineOps: Array<() => void> = [];

const mockRedis = {
  get: vi.fn(async (key: string) => mockStore.get(key) ?? null),
  setex: vi.fn(async (key: string, _ttl: number, value: string) => {
    mockStore.set(key, value);
    return "OK";
  }),
  del: vi.fn(async (key: string) => {
    const existed = mockStore.has(key) ? 1 : 0;
    mockStore.delete(key);
    return existed;
  }),
  zadd: vi.fn(async (key: string, score: number, member: string) => {
    if (!mockSortedSets.has(key)) mockSortedSets.set(key, []);
    const set = mockSortedSets.get(key)!;
    const existing = set.findIndex((e) => e.member === member);
    if (existing >= 0) set[existing].score = score;
    else set.push({ score, member });
    return existing >= 0 ? 0 : 1;
  }),
  zcard: vi.fn(async (key: string) => {
    return mockSortedSets.get(key)?.length ?? 0;
  }),
  zrange: vi.fn(async (key: string, start: number, stop: number) => {
    const set = mockSortedSets.get(key) ?? [];
    const sorted = [...set].sort((a, b) => a.score - b.score);
    return sorted.slice(start, stop + 1).map((e) => e.member);
  }),
  zrem: vi.fn(async (key: string, member: string) => {
    const set = mockSortedSets.get(key);
    if (!set) return 0;
    const idx = set.findIndex((e) => e.member === member);
    if (idx >= 0) { set.splice(idx, 1); return 1; }
    return 0;
  }),
  zremrangebyrank: vi.fn(async (key: string, start: number, stop: number) => {
    const set = mockSortedSets.get(key);
    if (!set) return 0;
    set.sort((a, b) => a.score - b.score);
    const removed = set.splice(start, stop - start + 1);
    return removed.length;
  }),
  sadd: vi.fn(async (key: string, member: string) => {
    if (!mockSets.has(key)) mockSets.set(key, new Set());
    mockSets.get(key)!.add(member);
    return 1;
  }),
  smembers: vi.fn(async (key: string) => {
    return Array.from(mockSets.get(key) ?? []);
  }),
  srem: vi.fn(async (key: string, member: string) => {
    const set = mockSets.get(key);
    if (!set) return 0;
    return set.delete(member) ? 1 : 0;
  }),
  hget: vi.fn(async (key: string, field: string) => {
    return mockHashes.get(key)?.get(field) ?? null;
  }),
  hincrby: vi.fn(async (key: string, field: string, increment: number) => {
    if (!mockHashes.has(key)) mockHashes.set(key, new Map());
    const hash = mockHashes.get(key)!;
    const current = parseInt(hash.get(field) || "0", 10);
    const newVal = current + increment;
    hash.set(field, String(newVal));
    return newVal;
  }),
  expire: vi.fn(async () => 1),
  pipeline: vi.fn(() => {
    mockPipelineOps.length = 0;
    const pipe = {
      del: (key: string) => { mockPipelineOps.push(() => { mockStore.delete(key); }); return pipe; },
      zrem: (key: string, member: string) => {
        mockPipelineOps.push(() => {
          const set = mockSortedSets.get(key);
          if (set) {
            const idx = set.findIndex((e) => e.member === member);
            if (idx >= 0) set.splice(idx, 1);
          }
        });
        return pipe;
      },
      exec: vi.fn(async () => {
        for (const op of mockPipelineOps) op();
        mockPipelineOps.length = 0;
        return [];
      }),
    };
    return pipe;
  }),
};

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: mockRedis,
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Import after mocks are set up
const { ClassificationCacheService } = await import(
  "@domain/intent-router/core/classification-cache.service.js"
);

function makeResult(overrides?: Partial<ClassificationResult>): ClassificationResult {
  return {
    topic: "Code",
    topicConfidence: 0.9,
    intent: "Code Execution",
    intentConfidence: 0.85,
    combinedConfidence: 0.875,
    selectedAgentCardId: 1,
    selectedAgentCardName: "Coder",
    resolvedModelProviderId: 10,
    resolvedModelId: 20,
    latencyMs: 42,
    ...overrides,
  };
}

describe("ClassificationCacheService", () => {
  let service: InstanceType<typeof ClassificationCacheService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.clear();
    mockSortedSets.clear();
    mockSets.clear();
    mockHashes.clear();
    service = new ClassificationCacheService();
  });

  describe("hashPrompt", () => {
    it("should produce a consistent sha256 hex digest", () => {
      const hash1 = ClassificationCacheService.hashPrompt("hello world");
      const hash2 = ClassificationCacheService.hashPrompt("hello world");
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // sha256 hex is 64 chars
    });

    it("should produce different hashes for different inputs", () => {
      const hash1 = ClassificationCacheService.hashPrompt("write some code");
      const hash2 = ClassificationCacheService.hashPrompt("generate an image");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("get()", () => {
    it("should return null on cache miss", async () => {
      const result = await service.get("session1", "abc123");
      expect(result).toBeNull();
    });

    it("should return cached result on cache hit", async () => {
      const cached = makeResult();
      mockStore.set("intent-cache:session1:abc123", JSON.stringify(cached));

      const result = await service.get("session1", "abc123");
      expect(result).toEqual(cached);
    });

    it("should increment miss stat on cache miss", async () => {
      await service.get("session1", "missing");
      expect(mockHashes.get("intent-cache-stats:session1")?.get("misses")).toBe("1");
    });

    it("should increment hit stat on cache hit", async () => {
      mockStore.set("intent-cache:session1:abc123", JSON.stringify(makeResult()));
      await service.get("session1", "abc123");
      expect(mockHashes.get("intent-cache-stats:session1")?.get("hits")).toBe("1");
    });

    it("should update LRU timestamp on access", async () => {
      mockStore.set("intent-cache:session1:abc123", JSON.stringify(makeResult()));
      await service.get("session1", "abc123");
      expect(mockRedis.zadd).toHaveBeenCalledWith(
        "intent-cache-idx:session1",
        expect.any(Number),
        "intent-cache:session1:abc123"
      );
    });
  });

  describe("set()", () => {
    it("should store result with TTL", async () => {
      const result = makeResult();
      await service.set("session1", "abc123", result);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        "intent-cache:session1:abc123",
        60,
        JSON.stringify(result)
      );
    });

    it("should add entry to session sorted set", async () => {
      await service.set("session1", "abc123", makeResult());

      expect(mockRedis.zadd).toHaveBeenCalledWith(
        "intent-cache-idx:session1",
        expect.any(Number),
        "intent-cache:session1:abc123"
      );
    });

    it("should add to agent card reverse index", async () => {
      const result = makeResult({ selectedAgentCardId: 42 });
      await service.set("session1", "abc123", result);

      expect(mockRedis.sadd).toHaveBeenCalledWith(
        "intent-cache-agent:42",
        "intent-cache:session1:abc123"
      );
    });

    it("should respect custom TTL", async () => {
      const customService = new ClassificationCacheService({ ttlSeconds: 120 });
      await customService.set("session1", "abc123", makeResult());

      expect(mockRedis.setex).toHaveBeenCalledWith(
        "intent-cache:session1:abc123",
        120,
        expect.any(String)
      );
    });
  });

  describe("LRU eviction", () => {
    it("should evict oldest entries when exceeding maxEntriesPerSession", async () => {
      const smallService = new ClassificationCacheService({ maxEntriesPerSession: 3 });

      // Pre-populate sorted set with 3 entries
      const sessionIdx = "intent-cache-idx:session1";
      mockSortedSets.set(sessionIdx, [
        { score: 1000, member: "intent-cache:session1:old1" },
        { score: 2000, member: "intent-cache:session1:old2" },
        { score: 3000, member: "intent-cache:session1:old3" },
      ]);
      mockStore.set("intent-cache:session1:old1", JSON.stringify(makeResult()));

      // Adding a 4th entry should trigger eviction of the oldest
      await smallService.set("session1", "new4", makeResult());

      // zcard is called for eviction check — after adding, count is 4
      // The pipeline should have been called to delete the oldest entry
      expect(mockRedis.pipeline).toHaveBeenCalled();
    });
  });

  describe("invalidate()", () => {
    it("should remove the cache entry and session index entry", async () => {
      const result = makeResult({ selectedAgentCardId: 5 });
      mockStore.set("intent-cache:session1:abc123", JSON.stringify(result));

      await service.invalidate("session1", "abc123");

      expect(mockRedis.del).toHaveBeenCalledWith("intent-cache:session1:abc123");
      expect(mockRedis.zrem).toHaveBeenCalledWith(
        "intent-cache-idx:session1",
        "intent-cache:session1:abc123"
      );
    });

    it("should remove from agent card reverse index", async () => {
      const result = makeResult({ selectedAgentCardId: 7 });
      mockStore.set("intent-cache:session1:abc123", JSON.stringify(result));

      await service.invalidate("session1", "abc123");

      expect(mockRedis.srem).toHaveBeenCalledWith(
        "intent-cache-agent:7",
        "intent-cache:session1:abc123"
      );
    });
  });

  describe("invalidateByAgentCard()", () => {
    it("should invalidate all entries referencing the agent card", async () => {
      // Set up: two entries reference agent card 10
      mockSets.set("intent-cache-agent:10", new Set([
        "intent-cache:session1:hash1",
        "intent-cache:session2:hash2",
      ]));
      mockStore.set("intent-cache:session1:hash1", JSON.stringify(makeResult()));
      mockStore.set("intent-cache:session2:hash2", JSON.stringify(makeResult()));

      await service.invalidateByAgentCard(10);

      expect(mockRedis.pipeline).toHaveBeenCalled();
      // After pipeline exec, the store entries should be deleted
      expect(mockStore.has("intent-cache:session1:hash1")).toBe(false);
      expect(mockStore.has("intent-cache:session2:hash2")).toBe(false);
    });

    it("should do nothing when no entries reference the agent card", async () => {
      await service.invalidateByAgentCard(999);
      expect(mockRedis.pipeline).not.toHaveBeenCalled();
    });
  });

  describe("getSessionStats()", () => {
    it("should return zeros when no stats exist", async () => {
      const stats = await service.getSessionStats("empty-session");
      expect(stats).toEqual({ entries: 0, hits: 0, misses: 0 });
    });

    it("should return accumulated stats", async () => {
      // Simulate some hits and misses
      mockSortedSets.set("intent-cache-idx:session1", [
        { score: 1, member: "a" },
        { score: 2, member: "b" },
      ]);
      mockHashes.set("intent-cache-stats:session1", new Map([
        ["hits", "15"],
        ["misses", "5"],
      ]));

      const stats = await service.getSessionStats("session1");
      expect(stats).toEqual({ entries: 2, hits: 15, misses: 5 });
    });
  });
});
