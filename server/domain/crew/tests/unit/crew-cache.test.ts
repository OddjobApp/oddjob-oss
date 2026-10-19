import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * CrewCacheService is L1 (in-process Map) over L2 (Redis). getRedis() connects
 * to `process.env.REDIS_URL || "redis://127.0.0.1:6379"`, so without this mock
 * these "unit" tests talk to whatever Redis is running on the developer's
 * machine — and read whatever a previous run left there.
 *
 * That is not hypothetical: "invalidates keys explicitly" failed in a full-suite
 * run with `expected 1 times, got 0`, because its very first getOrSet found
 * `crew:cache:test:key:1` already populated by an earlier run and never called
 * the fetcher. The same file passed 3/3 in isolation moments later. The results
 * varied with Redis uptime and the 60s TTL, which is the worst kind of gate:
 * one that is green or red for reasons unrelated to the code under test.
 *
 * Mocked to a permanent L2 miss so the assertions describe the L1 tier they are
 * actually about.
 */
vi.mock("ioredis", () => {
    class FakeRedis {
        on() { return this; }
        async get() { return null; }
        async set() { return "OK"; }
        async setex() { return "OK"; }
        async del() { return 1; }
        async quit() { return "OK"; }
    }
    return { default: FakeRedis, Redis: FakeRedis };
});

import { CrewCacheService } from "../../core/crew-cache.service.js";

describe("CrewCacheService", () => {
    let cache: CrewCacheService;

    beforeEach(() => {
        cache = new CrewCacheService();
    });

    it("evaluates fetcher on cache miss and stores in L1 memory", async () => {
        const mockFetcher = vi.fn().mockResolvedValue({ specId: "auth-jwt", version: "1.0.0" });

        const res1 = await cache.getOrSet("test:spec:auth", 60, mockFetcher);
        expect(res1).toEqual({ specId: "auth-jwt", version: "1.0.0" });
        expect(mockFetcher).toHaveBeenCalledTimes(1);

        // Second fetch should hit L1 cache without calling fetcher
        const res2 = await cache.getOrSet("test:spec:auth", 60, mockFetcher);
        expect(res2).toEqual({ specId: "auth-jwt", version: "1.0.0" });
        expect(mockFetcher).toHaveBeenCalledTimes(1);

        const stats = cache.getStats();
        expect(stats.l1Hits).toBe(1);
        expect(stats.misses).toBe(1);
        expect(stats.hitRate).toBe("50.0%");
    });

    it("invalidates keys explicitly", async () => {
        const mockFetcher = vi.fn().mockResolvedValue("sample data");

        await cache.getOrSet("test:key:1", 60, mockFetcher);
        expect(mockFetcher).toHaveBeenCalledTimes(1);

        await cache.invalidate("test:key:1");

        await cache.getOrSet("test:key:1", 60, mockFetcher);
        expect(mockFetcher).toHaveBeenCalledTimes(2);
    });

    it("reports cache statistics correctly", () => {
        const stats = cache.getStats();
        expect(stats.l1Hits).toBe(0);
        expect(stats.misses).toBe(0);
        expect(stats.hitRate).toBe("0.0%");
    });
});
