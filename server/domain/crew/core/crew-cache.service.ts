/**
 * Crew Multi-Tier Cache Service
 *
 * Implements an L1 (in-memory LRU with TTL) + L2 (Redis) caching tier for:
 *  - System feature specifications and documentation lookups
 *  - Sanitized tool schema definitions (eliminates repetitive Zod AST transformations)
 *  - Project and dataset metadata
 *
 * Sub-10ms response latency for hot cache hits.
 */

import { createLogger } from "@server/utils/logger.js";
import { Redis } from "ioredis";

const logger = createLogger("CrewCacheService");

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

export interface CacheStats {
    l1Hits: number;
    l2Hits: number;
    misses: number;
    keysCount: number;
    hitRate: string;
}

export class CrewCacheService {
    private readonly l1 = new Map<string, CacheEntry<unknown>>();
    private readonly maxL1Size = 2000;
    private redis: Redis | null = null;
    private redisDisabled = false;

    private l1Hits = 0;
    private l2Hits = 0;
    private misses = 0;

    constructor() {
        // Periodic cleanup of expired L1 entries every 60s
        setInterval(() => this.pruneExpired(), 60000).unref();
    }

    private getRedis(): Redis | null {
        if (this.redisDisabled) return null;
        if (!this.redis) {
            try {
                const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
                this.redis = new Redis(redisUrl, {
                    connectionName: "oddjob:crew-cache",
                    maxRetriesPerRequest: 1,
                    lazyConnect: true,
                });
                this.redis.on("error", (err) => {
                    logger.debug(`Crew cache Redis error: ${err.message}`);
                });
            } catch {
                this.redisDisabled = true;
                return null;
            }
        }
        return this.redis;
    }

    /**
     * Retrieves an item from cache, or evaluates the fetcher and populates L1 and L2.
     */
    async getOrSet<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
        const now = Date.now();

        // 1. Check L1 Memory Cache
        const l1Entry = this.l1.get(key);
        if (l1Entry && l1Entry.expiresAt > now) {
            this.l1Hits++;
            return l1Entry.data as T;
        }

        // 2. Check L2 Redis Cache
        const redis = this.getRedis();
        if (redis) {
            try {
                const cached = await redis.get(`crew:cache:${key}`);
                if (cached) {
                    const parsed = JSON.parse(cached) as T;
                    this.l2Hits++;
                    this.setL1(key, parsed, ttlSeconds);
                    return parsed;
                }
            } catch {
                // Redis miss or error — fall through to fetcher
            }
        }

        // 3. Cache Miss — Compute and Store
        this.misses++;
        const fresh = await fetcher();

        this.setL1(key, fresh, ttlSeconds);

        if (redis && fresh !== undefined && fresh !== null) {
            try {
                await redis.setex(`crew:cache:${key}`, ttlSeconds, JSON.stringify(fresh));
            } catch {
                // Non-fatal
            }
        }

        return fresh;
    }

    private setL1<T>(key: string, data: T, ttlSeconds: number): void {
        if (this.l1.size >= this.maxL1Size) {
            // Evict oldest entry
            const oldestKey = this.l1.keys().next().value;
            if (oldestKey) this.l1.delete(oldestKey);
        }

        this.l1.set(key, {
            data,
            expiresAt: Date.now() + ttlSeconds * 1000,
        });
    }

    private pruneExpired(): void {
        const now = Date.now();
        for (const [key, entry] of this.l1.entries()) {
            if (entry.expiresAt <= now) {
                this.l1.delete(key);
            }
        }
    }

    async invalidate(key: string): Promise<void> {
        this.l1.delete(key);
        const redis = this.getRedis();
        if (redis) {
            try {
                await redis.del(`crew:cache:${key}`);
            } catch {
                // Non-fatal
            }
        }
    }

    clear(): void {
        this.l1.clear();
        this.l1Hits = 0;
        this.l2Hits = 0;
        this.misses = 0;
    }

    getStats(): CacheStats {
        const total = this.l1Hits + this.l2Hits + this.misses;
        const hits = this.l1Hits + this.l2Hits;
        const hitRate = total > 0 ? `${((hits / total) * 100).toFixed(1)}%` : "0.0%";

        return {
            l1Hits: this.l1Hits,
            l2Hits: this.l2Hits,
            misses: this.misses,
            keysCount: this.l1.size,
            hitRate,
        };
    }
}

export const crewCacheService = new CrewCacheService();
