import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
};

const mockEmbeddings = {
    embedQuery: vi.fn(),
};

const mockSearchQdrant = vi.fn();
const mockUpsertQdrantPoints = vi.fn();
const mockEnsureQdrantCollection = vi.fn();

vi.mock("../../core/infrastructure/redis/redis-client.js", () => ({
    getRedisClient: () => mockRedis,
}));

vi.mock("../../knowledge/core/rag-langchain.service.js", () => ({
    getEmbeddings: () => mockEmbeddings,
}));

vi.mock("../../../integrations/qdrant-client.js", () => ({
    searchQdrant: (...args: any[]) => mockSearchQdrant(...args),
    upsertQdrantPoints: (...args: any[]) => mockUpsertQdrantPoints(...args),
    ensureQdrantCollection: (...args: any[]) => mockEnsureQdrantCollection(...args),
}));

import { SemanticCacheService } from "./semantic-cache.service.js";

describe("SemanticCacheService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockEmbeddings.embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
        mockSearchQdrant.mockResolvedValue([]);
    });

    describe("Tier 1: Exact Redis Matching", () => {
        it("returns exact cached response from Redis without invoking embeddings", async () => {
            mockRedis.get.mockResolvedValue("Exact cached answer");

            const result = await SemanticCacheService.get("What is our Q3 churn rate?", 42);

            expect(result).toBe("Exact cached answer");
            expect(mockRedis.get).toHaveBeenCalledTimes(1);
            expect(mockEmbeddings.embedQuery).not.toHaveBeenCalled();
            expect(mockSearchQdrant).not.toHaveBeenCalled();
        });

        it("scopes Redis cache keys by organizationId to prevent cross-tenant leaks", async () => {
            mockRedis.get.mockResolvedValue(null);

            await SemanticCacheService.get("Confidential numbers", 101);
            const callKey1 = mockRedis.get.mock.calls[0][0];

            await SemanticCacheService.get("Confidential numbers", 202);
            const callKey2 = mockRedis.get.mock.calls[1][0];

            expect(callKey1).not.toBe(callKey2);
            expect(callKey1).toMatch(/^semantic_cache:exact:[a-f0-9]{64}$/);
            expect(callKey2).toMatch(/^semantic_cache:exact:[a-f0-9]{64}$/);
        });
    });

    describe("Tier 2: Semantic Qdrant Fallback", () => {
        it("falls back to Qdrant vector search when Redis misses", async () => {
            mockRedis.get.mockResolvedValue(null);
            mockEmbeddings.embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
            mockSearchQdrant.mockResolvedValue([
                { score: 0.99, payload: { response: "Semantically matched response" } },
            ]);

            const result = await SemanticCacheService.get("How much was churn in Q3?", 42);

            expect(result).toBe("Semantically matched response");
            expect(mockEmbeddings.embedQuery).toHaveBeenCalledWith("How much was churn in Q3?");
            expect(mockSearchQdrant).toHaveBeenCalledWith(
                [0.1, 0.2, 0.3],
                expect.objectContaining({
                    limit: 1,
                    scoreThreshold: 0.985,
                    filter: { must: [{ key: "organizationId", match: { value: 42 } }] },
                })
            );
        });

        it("returns null if semantic score is below threshold or no results found", async () => {
            mockRedis.get.mockResolvedValue(null);
            mockEmbeddings.embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
            mockSearchQdrant.mockResolvedValue([]);

            const result = await SemanticCacheService.get("Completely novel question", 42);

            expect(result).toBeNull();
        });
    });

    describe("Cache Storage (set)", () => {
        it("persists to both Redis (with 7d TTL) and Qdrant", async () => {
            mockEmbeddings.embedQuery.mockResolvedValue([0.5, 0.5]);

            await SemanticCacheService.set("Summarize project alpha", "Alpha summary text", 42);

            expect(mockRedis.set).toHaveBeenCalledTimes(1);
            expect(mockRedis.set).toHaveBeenCalledWith(
                expect.stringMatching(/^semantic_cache:exact:[a-f0-9]{64}$/),
                "Alpha summary text",
                "EX",
                7 * 24 * 60 * 60
            );

            expect(mockEnsureQdrantCollection).toHaveBeenCalledWith("llm_semantic_cache");
            expect(mockUpsertQdrantPoints).toHaveBeenCalledTimes(1);
        });
    });
});
