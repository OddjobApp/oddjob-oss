import { describe, expect, it } from "vitest";
import { getCachedQueryEmbedding, setCachedQueryEmbedding } from "../core/rag-langchain.service.js";

describe("Query Embedding Cache", () => {
    it("returns null on a cold cache miss", async () => {
        const miss = await getCachedQueryEmbedding(`random_test_query_${Date.now()}_${Math.random()}`);
        expect(miss).toBeNull();
    });

    it("stores and retrieves embeddings from in-memory LRU cache", async () => {
        const query = "how do I configure a crew room pipeline?";
        const mockVector = new Array(768).fill(0).map((_, i) => i * 0.001);

        await setCachedQueryEmbedding(query, mockVector);

        const start = performance.now();
        const cached = await getCachedQueryEmbedding(query);
        const durationMs = performance.now() - start;

        expect(cached).not.toBeNull();
        expect(cached).toHaveLength(768);
        expect(cached![10]).toBeCloseTo(0.01);
        // Sub-millisecond in-memory LRU lookup
        expect(durationMs).toBeLessThan(10);
    });

    it("normalizes case and surrounding whitespace to share cache entries", async () => {
        const baseQuery = "WHAT IS THE DAILY BRIEF?";
        const variantQuery = "  what is the daily brief? \n ";
        const mockVector = [0.123, 0.456, 0.789];

        await setCachedQueryEmbedding(baseQuery, mockVector);

        const cachedVariant = await getCachedQueryEmbedding(variantQuery);
        expect(cachedVariant).toEqual(mockVector);
    });

    it("ignores empty or whitespace-only queries safely", async () => {
        const emptyMiss = await getCachedQueryEmbedding("   ");
        expect(emptyMiss).toBeNull();

        // setCachedQueryEmbedding should not throw
        await expect(setCachedQueryEmbedding("   ", [0.1, 0.2])).resolves.not.toThrow();
    });
});
