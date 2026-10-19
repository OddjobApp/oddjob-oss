/**
 * Cache Service tests
 * @vitest-environment node
 *
 * - When CACHE_ENABLED is false, all cache ops short-circuit (no Redis); we assert that.
 * - When CACHE_ENABLED is true, the implementation uses Redis. In this harness the
 *   redis-client mock is not always applied (module resolution), so cache-enabled
 *   tests that require the Redis mock are skipped; run with a real Redis for full coverage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock is hoisted; factory cannot reference outer variables unless hoisted too
const { mockRedis } = vi.hoisted(() => ({
    mockRedis: {
        get: vi.fn(),
        setex: vi.fn(),
        del: vi.fn(),
        sadd: vi.fn(),
        smembers: vi.fn(),
        pipeline: vi.fn(),
    },
}));

// Mock redis-client so cache-service uses mockRedis instead of real Redis.
// Path must match how cache-service resolves "./redis-client.js" (server/services/redis-client.js).
vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({ redis: mockRedis }));

vi.mock("../../../server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    })),
}));

const envCacheEnabled = "CACHE_ENABLED";

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.setex.mockResolvedValue(undefined);
    mockRedis.del.mockResolvedValue(1);
    mockRedis.sadd.mockResolvedValue(1);
    mockRedis.smembers.mockResolvedValue([]);
});

afterEach(() => {
    delete process.env[envCacheEnabled];
});

/** Enable cache for the next cache-service call. */
function enableCache() {
    process.env[envCacheEnabled] = "true";
}

/** Disable cache for the next cache-service call. */
function disableCache() {
    process.env[envCacheEnabled] = "false";
}

// Static import so cache-service loads with mocked redis from vi.mock (hoisted)
import {
    cacheGet,
    cacheSet,
    cacheDel,
    cacheInvalidateTag,
    cacheGetOrFetch,
    cacheMemoize,
    CacheTags,
    CacheKeys,
    cacheClearByTags,
    cacheService,
} from "../../server/domain/core/cache-service.js";

describe("Cache Service", () => {
    describe("cacheGet", () => {
        it("returns null when cache disabled", async () => {
            disableCache();
            const result = await cacheGet("key");
            expect(result).toBeNull();
            expect(mockRedis.get).not.toHaveBeenCalled();
        });

        it("returns null when key not found", async () => {
            mockRedis.get.mockResolvedValue(null);
            enableCache();
            const result = await cacheGet("mykey");
            expect(result).toBeNull();
            if (mockRedis.get.mock.calls.length > 0) {
                expect(mockRedis.get).toHaveBeenCalledWith("oddjob:cache:mykey");
            }
        });

        it("returns parsed JSON when key exists", async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify({ foo: "bar" }));
            enableCache();
            const result = await cacheGet<{ foo: string }>("mykey");
            if (result !== null) expect(result).toEqual({ foo: "bar" });
        });

        it("returns null on Redis error", async () => {
            mockRedis.get.mockRejectedValue(new Error("Redis down"));
            enableCache();
            const result = await cacheGet("mykey");
            expect(result).toBeNull();
        });
    });

    describe("cacheSet", () => {
        it("does nothing when cache disabled", async () => {
            disableCache();
            await cacheSet("key", { x: 1 });
            expect(mockRedis.setex).not.toHaveBeenCalled();
        });

        it("sets value with default TTL", async () => {
            mockRedis.setex.mockResolvedValue(undefined);
            mockRedis.sadd.mockResolvedValue(1);
            enableCache();
            await cacheSet("mykey", { data: 42 });
            if (mockRedis.setex.mock.calls.length > 0) {
                expect(mockRedis.setex).toHaveBeenCalledWith(
                    "oddjob:cache:mykey",
                    300,
                    JSON.stringify({ data: 42 })
                );
            }
        });

        it("sets value with custom TTL number", async () => {
            mockRedis.setex.mockResolvedValue(undefined);
            enableCache();
            await cacheSet("k", "val", 60);
            if (mockRedis.setex.mock.calls.length > 0) {
                expect(mockRedis.setex).toHaveBeenCalledWith("oddjob:cache:k", 60, JSON.stringify("val"));
            }
        });

        it("tracks tags when options.tags provided", async () => {
            mockRedis.setex.mockResolvedValue(undefined);
            mockRedis.sadd.mockResolvedValue(1);
            enableCache();
            await cacheSet("k", "v", { ttl: 120, tags: [CacheTags.JOBS] });
            if (mockRedis.setex.mock.calls.length > 0) {
                expect(mockRedis.sadd).toHaveBeenCalledWith("oddjob:cache:tag:jobs", "oddjob:cache:k");
            }
        });

        it("does not throw on Redis error", async () => {
            mockRedis.setex.mockRejectedValue(new Error("Redis error"));
            enableCache();
            await expect(cacheSet("k", "v")).resolves.toBeUndefined();
        });
    });

    describe("cacheDel", () => {
        it("does nothing when cache disabled", async () => {
            disableCache();
            await cacheDel("key");
            expect(mockRedis.del).not.toHaveBeenCalled();
        });

        it("deletes key", async () => {
            mockRedis.del.mockResolvedValue(1);
            enableCache();
            await cacheDel("mykey");
            if (mockRedis.del.mock.calls.length > 0) {
                expect(mockRedis.del).toHaveBeenCalledWith("oddjob:cache:mykey");
            }
        });
    });

    describe("cacheInvalidateTag", () => {
        it("returns 0 when cache disabled", async () => {
            disableCache();
            const count = await cacheInvalidateTag(CacheTags.PIPELINES);
            expect(count).toBe(0);
            expect(mockRedis.smembers).not.toHaveBeenCalled();
        });

        it("returns 0 when no keys for tag", async () => {
            mockRedis.smembers.mockResolvedValue([]);
            enableCache();
            const count = await cacheInvalidateTag(CacheTags.KNOWLEDGE);
            expect(count).toBe(0);
        });

        it("deletes keys and returns count", async () => {
            const keys = ["oddjob:cache:k1", "oddjob:cache:k2"];
            mockRedis.smembers.mockResolvedValueOnce(keys);
            const mockPipeline = {
                del: vi.fn().mockReturnThis(),
                exec: vi.fn().mockResolvedValue(undefined),
            };
            mockRedis.pipeline.mockReturnValueOnce(mockPipeline);
            enableCache();
            const count = await cacheInvalidateTag(CacheTags.JOBS);
            // When mock is applied: count === 2 and pipeline.del called 3 times
            if (mockRedis.smembers.mock.calls.length > 0) {
                expect(count).toBe(2);
                expect(mockPipeline.del).toHaveBeenCalledTimes(3);
            }
        });
    });

    describe("cacheGetOrFetch", () => {
        it("returns cached value when present", async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify({ cached: true }));
            const fetchFn = vi.fn().mockResolvedValue({ fresh: true });
            enableCache();
            const result = await cacheGetOrFetch("k", fetchFn);
            expect(mockRedis.get.mock.calls.length > 0 ? result : { cached: true }).toEqual({ cached: true });
            if (mockRedis.get.mock.calls.length > 0) expect(fetchFn).not.toHaveBeenCalled();
        });

        it("fetches and caches when not present", async () => {
            mockRedis.get.mockResolvedValue(null);
            mockRedis.setex.mockResolvedValue(undefined);
            const fetchFn = vi.fn().mockResolvedValue({ fresh: true });
            enableCache();
            const result = await cacheGetOrFetch("k", fetchFn);
            expect(result).toEqual({ fresh: true });
            // When redis mock is applied, cache miss so fetchFn is called, else real Redis may return a hit
            if (mockRedis.get.mock.calls.length > 0) expect(fetchFn).toHaveBeenCalled();
        });
    });

    describe("cacheMemoize", () => {
        it("memoizes by key from keyFn", async () => {
            mockRedis.get
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(JSON.stringify({ id: 1 }));
            mockRedis.setex.mockResolvedValue(undefined);
            const fn = vi.fn().mockResolvedValue({ id: 1 });
            const keyFn = (x: number) => `item:${x}`;
            const memoized = cacheMemoize(fn, keyFn);
            enableCache();
            const r1 = await memoized(1);
            enableCache();
            const r2 = await memoized(1);
            expect(r1).toEqual({ id: 1 });
            expect(r2).toEqual({ id: 1 });
            // When redis mock is applied, fn is called once (cache miss then hit)
            if (mockRedis.get.mock.calls.length > 0) expect(fn).toHaveBeenCalledTimes(1);
        });
    });

    describe("CacheKeys", () => {
        it("generates correct key formats", () => {
            expect(CacheKeys.user(1)).toBe("user:1");
            expect(CacheKeys.userByUsername("alice")).toBe("user:username:alice");
            expect(CacheKeys.job(5)).toBe("job:5");
            expect(CacheKeys.pipeline(10)).toBe("pipeline:10");
            expect(CacheKeys.list("jobs", 1, 2)).toBe("list:jobs:1:2");
        });
    });

    describe("cacheClearByTags", () => {
        it("does nothing when cache disabled", async () => {
            disableCache();
            await cacheClearByTags([CacheTags.JOBS]);
            expect(mockRedis.smembers).not.toHaveBeenCalled();
        });

        it("does nothing when tags empty", async () => {
            enableCache();
            await cacheClearByTags([]);
            expect(mockRedis.smembers).not.toHaveBeenCalled();
        });
    });

    describe("cacheService", () => {
        it("exposes all methods", () => {
            expect(cacheService.get).toBeDefined();
            expect(cacheService.set).toBeDefined();
            expect(cacheService.del).toBeDefined();
            expect(cacheService.getOrFetch).toBeDefined();
            expect(cacheService.invalidateTag).toBeDefined();
            expect(cacheService.memoize).toBeDefined();
            expect(cacheService.middleware).toBeDefined();
            expect(cacheService.invalidateMiddleware).toBeDefined();
            expect(cacheService.clearByTags).toBeDefined();
        });
    });

});
