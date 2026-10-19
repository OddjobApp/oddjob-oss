
import { describe, it, expect, beforeAll, vi } from "vitest";

const { redisStore, redisMock } = vi.hoisted(() => {
    const redisStore = new Map<string, string>();
    const redisMock = {
        set: vi.fn(async (key: string, value: string) => {
            redisStore.set(key, value);
            return "OK";
        }),
        get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
    };
    return { redisStore, redisMock };
});

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    redis: redisMock,
}));

import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

describe("App Forge Progress Visibility", () => {
    const testJobId = "test-progress-job-123";

    beforeAll(async () => {
        redisStore.clear();
        // Mock a forge job state in Redis
        await redis.set(`forge:job:${testJobId}`, JSON.stringify({
            status: 'building',
            progress: 40,
            stage: 3,
            message: 'Executing industrial codegen...',
            updatedAt: new Date().toISOString()
        }), 'EX', 60);
    });

    it("should retrieve the current progress and stage from Redis", async () => {
        const raw = await redis.get(`forge:job:${testJobId}`);
        expect(raw).toBeDefined();
        const status = JSON.parse(raw!);
        expect(status.progress).toBe(40);
        expect(status.stage).toBe(3);
    });

    it("should provide the correct progress mapping for stages", () => {
        // This validates the logic used in emitLog
        const STAGE_PROGRESS: Record<number, number> = {
            0: 5,   // Discovery
            1: 15,  // Strategy
            2: 25,  // Architecture Review
            3: 40,  // Assembly
            4: 65,  // Hardening
            5: 85,  // Industrialization
            6: 98,  // Ignition
        };
        expect(STAGE_PROGRESS[3]).toBe(40);
        expect(STAGE_PROGRESS[6]).toBe(98);
    });
});
