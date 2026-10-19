import { describe, it, expect, vi, beforeEach } from "vitest";
import { graphRagService } from "@domain/knowledge/core/rag/graph-rag.service.js";

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue("OK"),
  },
}));

vi.mock("@domain/knowledge/core/rag/embedding-service.js", () => ({
  embeddingService: {
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  },
}));

describe("GraphRagService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("retrieveWithGraphTraversal", () => {
    it("should return cached results immediately on Redis cache hit", async () => {
      const mockCachedResults = [
        {
          content: "Cached Graph RAG Knowledge",
          source: "hybrid",
          confidence: 0.95,
        },
      ];

      const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
      vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(mockCachedResults));

      const results = await graphRagService.retrieveWithGraphTraversal("query", { organizationId: 1 } as any);

      expect(results).toEqual(mockCachedResults);
      expect(redis.get).toHaveBeenCalled();
    });

    it("should fallback to keyword search if embedding generation fails", async () => {
      const { embeddingService } = await import("@domain/knowledge/core/rag/embedding-service.js");
      vi.mocked(embeddingService.generateEmbedding).mockResolvedValueOnce(null);

      const spyFallback = vi.spyOn(graphRagService as any, "keywordSearchFallback").mockResolvedValueOnce([]);

      const results = await graphRagService.retrieveWithGraphTraversal("test query", { organizationId: 1 } as any);

      expect(spyFallback).toHaveBeenCalled();
      expect(results).toEqual([]);
    });
  });
});
