import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Redis ──────────────────────────────────────────────────────────────
class MockRedis {
    store = new Map<string, string>();
    ttls = new Map<string, number>();

    async get(key: string) {
        return this.store.get(key) || null;
    }

    async set(key: string, value: string, ex?: string, ttl?: number, nx?: string) {
        if (nx === "NX" && this.store.has(key)) {
            return null;
        }
        this.store.set(key, value);
        if (ex === "EX" && ttl) {
            this.ttls.set(key, Date.now() + ttl * 1000);
        }
        return "OK";
    }

    async setex(key: string, ttl: number, value: string) {
        this.store.set(key, value);
        this.ttls.set(key, Date.now() + ttl * 1000);
        return "OK";
    }

    async del(key: string) {
        const deleted = this.store.delete(key);
        this.ttls.delete(key);
        return deleted ? 1 : 0;
    }

    async exists(key: string) {
        return this.store.has(key) ? 1 : 0;
    }

    async eval(script: string, numkeys: number, ...args: any[]) {
        const key = args[0];
        const val = args[1];

        if (script.includes("del")) {
            if (this.store.get(key) === val) {
                this.store.delete(key);
                this.ttls.delete(key);
                return 1;
            }
            return 0;
        }

        if (script.includes("expire")) {
            const newTtl = parseInt(args[2], 10);
            if (this.store.get(key) === val) {
                this.ttls.set(key, Date.now() + newTtl * 1000);
                return 1;
            }
            return 0;
        }

        return 0;
    }
}

const mockRedis = new MockRedis();

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    redis: mockRedis,
}));

// ── Mock Database for Retry Service (drizzle is not actually called for executeWithRetry, but to avoid module import failure)
vi.mock("@server/database_service.js", () => ({
    db: {},
}));

vi.mock("@domain/diagnostics/index.js", () => ({
    errorDiagnosisEngine: {},
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe("LockService - Safe Distributed Locks", () => {
    beforeEach(() => {
        mockRedis.store.clear();
        mockRedis.ttls.clear();
    });

    it("acquires a lock with a unique token and prevents concurrent acquisition", async () => {
        const { lockService } = await import("../lock-service.js");
        const key = "test-lock-key";

        const token1 = await lockService.acquireLock(key, 60);
        expect(token1).toBeTypeOf("string");

        // Concurrent attempt fails
        const token2 = await lockService.acquireLock(key, 60);
        expect(token2).toBeNull();
    });

    it("releases a lock only when the correct token is supplied", async () => {
        const { lockService } = await import("../lock-service.js");
        const key = "test-release-key";

        const token = await lockService.acquireLock(key, 60);
        expect(token).toBeTypeOf("string");

        // Release with wrong token fails
        const releasedWrong = await lockService.releaseLock(key, "wrong-token");
        expect(releasedWrong).toBe(false);
        expect(await lockService.isLocked(key)).toBe(true);

        // Release with correct token succeeds
        const releasedCorrect = await lockService.releaseLock(key, token!);
        expect(releasedCorrect).toBe(true);
        expect(await lockService.isLocked(key)).toBe(false);
    });

    it("extends a lock's TTL when correct token is supplied", async () => {
        const { lockService } = await import("../lock-service.js");
        const key = "test-extend-key";

        const token = await lockService.acquireLock(key, 10);

        // Extend with wrong token fails
        const extendedWrong = await lockService.extendLock(key, "wrong-token", 60);
        expect(extendedWrong).toBe(false);

        // Extend with correct token succeeds
        const extendedCorrect = await lockService.extendLock(key, token!, 60);
        expect(extendedCorrect).toBe(true);
    });
});

describe("CacheService - Cache Stampede Prevention (Singleflight)", () => {
    beforeEach(() => {
        mockRedis.store.clear();
        mockRedis.ttls.clear();
    });

    it("coalesces concurrent requests to cacheGetOrFetch", async () => {
        const { cacheService } = await import("../cache-service.js");
        const key = "stampede-test-key";

        let fetchCount = 0;
        const fetchFn = async () => {
            fetchCount++;
            // Sleep slightly to let concurrent calls pile up
            await new Promise((resolve) => setTimeout(resolve, 50));
            return `value-${fetchCount}`;
        };

        // Fire 10 concurrent requests
        const results = await Promise.all(
            Array.from({ length: 10 }).map(() => cacheService.getOrFetch(key, fetchFn, 60))
        );

        // All should get the exact same value
        results.forEach((res) => expect(res).toBe("value-1"));

        // Fetch function must have been called exactly once
        expect(fetchCount).toBe(1);
    });
});

describe("ResilienceService - Circuit Breaker", () => {
    it("trips to OPEN after consecutive failures and transitions to HALF_OPEN after cooldown", async () => {
        const { resilienceService, CircuitBreakerOpenError } = await import("../resilience.service.js");
        const operation = "external-api-call";

        // Reset state
        resilienceService.resetCircuit(operation);

        let callCount = 0;
        const failingFn = async () => {
            callCount++;
            throw new Error("Service unavailable");
        };

        // Fail 3 times (limit is 3 for this test)
        for (let i = 0; i < 3; i++) {
            await expect(
                resilienceService.executeWithResilience(operation, failingFn, { maxFailures: 3, cooldownMs: 50 })
            ).rejects.toThrow("Service unavailable");
        }

        // Circuit should be OPEN now
        expect(resilienceService.getCircuitState(operation)).toBe("OPEN");

        // Subsequent call fails immediately without invoking the function (circuit breaker open error)
        await expect(
            resilienceService.executeWithResilience(operation, failingFn, { maxFailures: 3, cooldownMs: 50 })
        ).rejects.toThrow(CircuitBreakerOpenError);

        expect(callCount).toBe(3); // Function was not called a 4th time

        // Wait for cooldown to elapse
        await new Promise((resolve) => setTimeout(resolve, 60));

        // Next call should run the function because it transitions to HALF_OPEN
        const successFn = async () => {
            callCount++;
            return "recovered";
        };

        const result = await resilienceService.executeWithResilience(operation, successFn, {
            maxFailures: 3,
            cooldownMs: 50,
        });
        expect(result).toBe("recovered");
        expect(callCount).toBe(4);

        // Circuit should be CLOSED again
        expect(resilienceService.getCircuitState(operation)).toBe("CLOSED");
    });
});

describe("RetryService - Rate-Limit-Aware Retries", () => {
    it("correctly extracts Retry-After delay from headers", async () => {
        const { retryService } = await import("../retry-service.js");

        const errSeconds = {
            status: 429,
            headers: {
                "retry-after": "5",
            },
        };
        expect(retryService.getRetryAfterMs(errSeconds)).toBe(5000);

        const errDate = {
            status: 429,
            headers: {
                "Retry-After": new Date(Date.now() + 3000).toUTCString(),
            },
        };
        const delay = retryService.getRetryAfterMs(errDate);
        expect(delay).toBeGreaterThan(1000);
        expect(delay).toBeLessThanOrEqual(3050);

        const errFallback = {
            status: 429,
        };
        expect(retryService.getRetryAfterMs(errFallback)).toBe(10000);
    });

    it("waits for Retry-After delay during execution with retry", async () => {
        const { retryService } = await import("../retry-service.js");

        let callCount = 0;
        const rateLimitedFn = async () => {
            callCount++;
            if (callCount === 1) {
                const err = new Error("Rate limit exceeded") as any;
                err.status = 429;
                err.headers = { "retry-after": "0.1" }; // 100ms
                throw err;
            }
            return "success";
        };

        const start = Date.now();
        const result = await retryService.executeWithRetry(rateLimitedFn, {
            maxRetries: 2,
            backoffMs: 10,
            backoffMultiplier: 2,
        });

        const elapsed = Date.now() - start;
        expect(result).toBe("success");
        expect(callCount).toBe(2);
        // setTimeout may fire a millisecond early against Date.now(), so a 100 ms
        // Retry-After can measure 99 ms; what matters is that the delay was honored
        // rather than the 10 ms backoff.
        expect(elapsed).toBeGreaterThanOrEqual(95);
    });
});
