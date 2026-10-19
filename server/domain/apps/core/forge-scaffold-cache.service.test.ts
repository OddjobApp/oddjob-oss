import { describe, it, expect, vi, beforeEach } from "vitest";
import { forgeScaffoldCache } from "./forge-scaffold-cache.service.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    redis: {
        get: vi.fn(),
        set: vi.fn(),
        keys: vi.fn(),
        // Not used by the cache under test: PodRegistry.register runs on import of
        // the auth barrel and calls these, so a mock without them fails the whole
        // file before a single assertion.
        // Must resolve, not return undefined: PodRegistry chains .catch() on hset.
        hget: vi.fn(async () => null),
        hset: vi.fn(async () => 1),
        multi: vi.fn(() => ({ hset: vi.fn(), hdel: vi.fn(), exec: vi.fn(async () => []) })),
    }
}));

describe("ForgeScaffoldCache Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("retrieves a cached scaffold from redis", async () => {
        const mockScaffold = {
            blueprintSnapshot: { "index.tsx": "code" },
            slots: { "index.tsx": ["APP_TITLE"] },
            cachedAt: 12345
        };
        vi.mocked(redis.get).mockResolvedValue(JSON.stringify(mockScaffold));

        const result = await forgeScaffoldCache.get("test-blueprint");
        expect(result).toEqual(mockScaffold);
        expect(redis.get).toHaveBeenCalledWith("forge:scaffold:test-blueprint");
    });

    it("returns null on cache miss", async () => {
        vi.mocked(redis.get).mockResolvedValue(null);
        const result = await forgeScaffoldCache.get("missing");
        expect(result).toBeNull();
    });

    it("saves scaffold to redis with TTL", async () => {
        const mockScaffold: any = { blueprintSnapshot: {}, slots: {}, cachedAt: Date.now() };
        await forgeScaffoldCache.set("new-blueprint", mockScaffold);
        
        expect(redis.set).toHaveBeenCalledWith(
            "forge:scaffold:new-blueprint",
            JSON.stringify(mockScaffold),
            "EX",
            86400
        );
    });

    it("handles redis read errors gracefully", async () => {
        vi.mocked(redis.get).mockRejectedValue(new Error("Redis down"));
        const result = await forgeScaffoldCache.get("any");
        expect(result).toBeNull();
    });
});
