/**
 * Workspace Mutex Service
 * 
 * Provides Redis-based distributed locking for workspace write serialization.
 * Each lock is scoped to an org+repo combination to prevent concurrent
 * missions from corrupting workspace state.
 * 
 * Features:
 * - Atomic lock acquisition via SET NX PX
 * - Token-based ownership validation on release
 * - Automatic TTL refresh (heartbeat) during long operations
 * - Exponential backoff retry on contention
 * - Concurrency semaphore for per-repo parallelism limits
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "@server/utils/logger.js";
import { deriveMutexKey, deriveSemaphoreKey } from "./branch-naming.js";

const logger = createLogger("WorkspaceMutex");

export interface MutexAcquireOptions {
    orgId: number;
    repoUrl: string;
    ttlMs?: number;           // default: 300_000 (5 min)
    acquireTimeoutMs?: number; // default: 60_000 (1 min)
    retryDelayMs?: number;     // initial backoff: 200ms
    missionId?: number;        // for logging context
}

export interface MutexLock {
    key: string;
    token: string;
    acquiredAt: number;
    ttlMs: number;
    refreshInterval: NodeJS.Timeout | null;
    missionId?: number;
}

export const workspaceMutexService = {
    /**
     * Acquire a workspace mutex with exponential backoff retry.
     * Returns a MutexLock on success; throws on timeout.
     */
    async acquire(opts: MutexAcquireOptions): Promise<MutexLock> {
        const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const redis = getRedisClient();

        const key = deriveMutexKey(opts.orgId, opts.repoUrl);
        const token = randomUUID();
        const ttlMs = opts.ttlMs ?? 300_000;
        const acquireTimeoutMs = opts.acquireTimeoutMs ?? 60_000;
        const initialRetryMs = opts.retryDelayMs ?? 200;

        const startTime = Date.now();
        let retryDelay = initialRetryMs;
        let attempts = 0;

        while (Date.now() - startTime < acquireTimeoutMs) {
            attempts++;
            const result = await redis.set(key, token, "PX", ttlMs, "NX");

            if (result === "OK") {
                // Lock acquired — start refresh heartbeat
                const refreshInterval = setInterval(async () => {
                    try {
                        await this.refresh({ key, token, acquiredAt: Date.now(), ttlMs, refreshInterval: null, missionId: opts.missionId });
                    } catch (err: any) {
                        logger.warn(`[Mutex] Refresh failed for ${key}: ${err.message}`);
                    }
                }, 60_000);

                const lock: MutexLock = {
                    key,
                    token,
                    acquiredAt: Date.now(),
                    ttlMs,
                    refreshInterval,
                    missionId: opts.missionId,
                };

                logger.info(`[Mutex] Acquired ${key} (token=${token.slice(0, 8)}..., attempts=${attempts}, mission=${opts.missionId})`);
                return lock;
            }

            // Lock held by another — exponential backoff
            await new Promise(r => setTimeout(r, retryDelay));
            retryDelay = Math.min(retryDelay * 2, 5000); // cap at 5s
        }

        throw new Error(`MUTEX_TIMEOUT: Failed to acquire workspace lock ${key} after ${acquireTimeoutMs}ms (${attempts} attempts)`);
    },

    /**
     * Release a workspace mutex. Validates token ownership.
     * Returns true if released, false if token mismatch (someone else holds it).
     */
    async release(lock: MutexLock): Promise<boolean> {
        const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const redis = getRedisClient();

        // Stop the refresh heartbeat
        if (lock.refreshInterval) {
            clearInterval(lock.refreshInterval);
            lock.refreshInterval = null;
        }

        // Atomic: only delete if the token matches (Lua script for atomicity)
        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;

        const result = await redis.eval(script, 1, lock.key, lock.token) as number;
        const released = result === 1;

        if (released) {
            const holdTime = Date.now() - lock.acquiredAt;
            logger.info(`[Mutex] Released ${lock.key} (held ${holdTime}ms, mission=${lock.missionId})`);
        } else {
            logger.warn(`[Mutex] Release failed for ${lock.key} — token mismatch (mission=${lock.missionId})`);
        }

        return released;
    },

    /**
     * Refresh (extend) the TTL of a held lock.
     * Only succeeds if the token still matches.
     */
    async refresh(lock: MutexLock): Promise<boolean> {
        const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const redis = getRedisClient();

        // Atomic: only extend if token matches
        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("pexpire", KEYS[1], ARGV[2])
            else
                return 0
            end
        `;

        const result = await redis.eval(script, 1, lock.key, lock.token, String(lock.ttlMs)) as number;
        return result === 1;
    },

    /**
     * Check if a mutex key is currently held.
     */
    async isHeld(orgId: number, repoUrl: string): Promise<boolean> {
        const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const redis = getRedisClient();
        const key = deriveMutexKey(orgId, repoUrl);
        const exists = await redis.exists(key);
        return exists === 1;
    },

    // ═══════════════════════════════════════════════════════════════════════
    // CONCURRENCY SEMAPHORE
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Try to acquire a concurrency slot for a repo.
     * Uses a Redis sorted set with missionId as member and timestamp as score.
     * Stale entries (>10 min) are pruned on each call.
     */
    async tryAcquireSlot(orgId: number, repoUrl: string, missionId: number, limit: number = 3): Promise<boolean> {
        const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const redis = getRedisClient();
        const key = deriveSemaphoreKey(orgId, repoUrl);

        // Prune stale entries (older than 10 minutes)
        const staleThreshold = Date.now() - 10 * 60 * 1000;
        await redis.zremrangebyscore(key, "-inf", String(staleThreshold));

        // Check current count
        const currentCount = await redis.zcard(key);
        if (currentCount >= limit) {
            logger.info(`[Semaphore] Slot denied for mission ${missionId} (${currentCount}/${limit} for org ${orgId})`);
            return false;
        }

        // Add this mission
        await redis.zadd(key, String(Date.now()), String(missionId));
        logger.info(`[Semaphore] Slot acquired for mission ${missionId} (${currentCount + 1}/${limit} for org ${orgId})`);
        return true;
    },

    /**
     * Release a concurrency slot.
     */
    async releaseSlot(orgId: number, repoUrl: string, missionId: number): Promise<void> {
        const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const redis = getRedisClient();
        const key = deriveSemaphoreKey(orgId, repoUrl);
        await redis.zrem(key, String(missionId));
        logger.info(`[Semaphore] Slot released for mission ${missionId} (org ${orgId})`);
    },

    /**
     * Get current slot count for a repo.
     */
    async currentSlotCount(orgId: number, repoUrl: string): Promise<number> {
        const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const redis = getRedisClient();
        const key = deriveSemaphoreKey(orgId, repoUrl);

        // Prune stale before counting
        const staleThreshold = Date.now() - 10 * 60 * 1000;
        await redis.zremrangebyscore(key, "-inf", String(staleThreshold));

        return await redis.zcard(key);
    },
};
