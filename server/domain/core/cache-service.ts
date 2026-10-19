/**
 * Cache Service
 * 
 * Redis-backed caching layer for frequently accessed data.
 * Supports grouped invalidation via tags and response caching middleware.
 */

import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";
import type { Request, Response, NextFunction } from "express";

const logger = createLogger("Cache");

const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const CACHE_PREFIX = "oddjob:cache:";

function isCacheEnabled(): boolean {
    return process.env.CACHE_ENABLED !== "false";
}

// ============================================================================
// CACHE TAGS
// Used for grouped invalidation
// ============================================================================

export const CacheTags = {
    JOBS: "jobs",
    PIPELINES: "pipelines",
    KNOWLEDGE: "knowledge",
    DATASETS: "datasets",
    SPECS: "specs",
    SCHEDULES: "schedules",
} as const;

export type CacheTag = (typeof CacheTags)[keyof typeof CacheTags];

// ============================================================================
// BASIC CACHE OPERATIONS
// ============================================================================

interface CacheOptions {
    ttl?: number;        // Time to live in seconds
    tags?: CacheTag[];   // Tags for grouped invalidation
}

/**
 * Get a cached value
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
    if (!isCacheEnabled()) return null;
    try {
        const cached = await redis.get(`${CACHE_PREFIX}${key}`);
        if (!cached) return null;
        return JSON.parse(cached) as T;
    } catch (error) {
        logger.warn("Cache get failed", { key, error: (error as Error).message });
        return null;
    }
}

/**
 * Set a cached value
 */
export async function cacheSet<T>(
    key: string,
    value: T,
    options: number | CacheOptions = DEFAULT_TTL_SECONDS
): Promise<void> {
    if (!isCacheEnabled()) return;

    let ttl = typeof options === 'number' ? options : (options.ttl || DEFAULT_TTL_SECONDS);
    const tags = typeof options === 'object' ? options.tags : undefined;

    try {
        const fullKey = `${CACHE_PREFIX}${key}`;
        await redis.setex(fullKey, ttl, JSON.stringify(value));

        // Track tags for invalidation
        if (tags && tags.length > 0) {
            for (const tag of tags) {
                await redis.sadd(`${CACHE_PREFIX}tag:${tag}`, fullKey);
            }
        }
    } catch (error) {
        logger.warn("Cache set failed", { key, error: (error as Error).message });
    }
}

/**
 * Delete a cached value
 */
export async function cacheDel(key: string): Promise<void> {
    if (!isCacheEnabled()) return;
    try {
        await redis.del(`${CACHE_PREFIX}${key}`);
    } catch (error) {
        logger.warn("Cache delete failed", { key, error: (error as Error).message });
    }
}

/**
 * Invalidate all cache keys matching a specific tag
 */
export async function cacheInvalidateTag(tag: CacheTag): Promise<number> {
    if (!isCacheEnabled()) return 0;

    try {
        const tagKey = `${CACHE_PREFIX}tag:${tag}`;
        const keys = await redis.smembers(tagKey);
        if (keys.length === 0) return 0;

        const pipeline = redis.pipeline();
        for (const key of keys) {
            pipeline.del(key);
        }
        pipeline.del(tagKey);
        await pipeline.exec();

        logger.info("Cache tag invalidated", { tag, count: keys.length });
        return keys.length;
    } catch (error) {
        logger.warn("Cache invalidateTag failed", { tag, error: (error as Error).message });
        return 0;
    }
}

// ============================================================================
// CACHE-ASIDE PATTERN
// ============================================================================

const activeFetches = new Map<string, Promise<any>>();

/**
 * Get from cache or fetch and cache
 */
export async function cacheGetOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: number | CacheOptions = DEFAULT_TTL_SECONDS
): Promise<T> {
    // Try cache first
    const cached = await cacheGet<T>(key);
    if (cached !== null) {
        return cached;
    }

    // Coalesce concurrent fetches for the same key
    let activeFetch = activeFetches.get(key);
    if (activeFetch) {
        return activeFetch as Promise<T>;
    }

    const fetchPromise = (async () => {
        try {
            const value = await fetchFn();
            // Cache the result (don't await to avoid blocking)
            cacheSet(key, value, options).catch(() => { });
            return value;
        } finally {
            activeFetches.delete(key);
        }
    })();

    activeFetches.set(key, fetchPromise);
    return fetchPromise;
}

/**
 * Memoize a function with caching
 */
export function cacheMemoize<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    keyFn: (...args: Parameters<T>) => string,
    options: number | CacheOptions = DEFAULT_TTL_SECONDS
): T {
    return (async (...args: Parameters<T>) => {
        const key = keyFn(...args);
        return cacheGetOrFetch(key, () => fn(...args), options);
    }) as T;
}

// ============================================================================
// EXPRESS MIDDLEWARE
// ============================================================================

interface CacheMiddlewareOptions extends CacheOptions {
    keyGenerator?: (req: Request) => string;
}

/**
 * Express middleware for caching responses
 */
export function cacheMiddleware(options: CacheMiddlewareOptions = {}) {
    return async (req: Request, res: Response, next: NextFunction) => {
        if (!isCacheEnabled() || req.method !== "GET") {
            return next();
        }

        // Generate cache key
        const key = options.keyGenerator
            ? options.keyGenerator(req)
            : `req:${req.originalUrl}`;

        // Check cache
        const cached = await cacheGet<{ body: any; status: number }>(key);
        if (cached) {
            res.setHeader("X-Cache", "HIT");
            return res.status(cached.status).json(cached.body);
        }

        // Store original json method
        const originalJson = res.json.bind(res);

        // Override json to cache response
        res.json = (body: any) => {
            cacheSet(key, { body, status: res.statusCode }, options).catch(() => { });
            res.setHeader("X-Cache", "MISS");
            return originalJson(body);
        };

        next();
    };
}

/**
 * Invalidation middleware - invalidates cache tags on mutations
 */
export function invalidateOnMutation(tags: CacheTag[]) {
    return async (req: Request, res: Response, next: NextFunction) => {
        // Store original end
        const originalEnd = res.end.bind(res);

        res.end = function (chunk?: any, encoding?: any, callback?: any) {
            // Invalidate on successful mutations
            if (res.statusCode >= 200 && res.statusCode < 300) {
                Promise.all(tags.map(tag => cacheInvalidateTag(tag))).catch(() => { });
            }
            return originalEnd(chunk, encoding, callback);
        };

        next();
    };
}

// ============================================================================
// CACHE KEY GENERATORS
// ============================================================================

export const CacheKeys = {
    user: (id: number | string) => `user:${id}`,
    userByUsername: (username: string) => `user:username:${username}`,
    job: (id: number) => `job:${id}`,
    pipeline: (id: number) => `pipeline:${id}`,
    credential: (id: number) => `credential:${id}`,
    organization: (id: number) => `org:${id}`,
    organizationSettings: (orgId: number) => `org:${orgId}:settings`,
    list: (type: string, orgId: number, page: number) => `list:${type}:${orgId}:${page}`,
};

// Export convenience interface
/**
 * Invalidate multiple tags
 */
export async function cacheClearByTags(tags: CacheTag[]): Promise<void> {
    if (!isCacheEnabled() || !tags.length) return;
    await Promise.all(tags.map(tag => cacheInvalidateTag(tag)));
}
export const cacheService = {
    get: cacheGet,
    set: cacheSet,
    del: cacheDel,
    getOrFetch: cacheGetOrFetch,
    invalidateTag: cacheInvalidateTag,
    memoize: cacheMemoize,
    middleware: cacheMiddleware,
    invalidateMiddleware: invalidateOnMutation,
    clearByTags: cacheClearByTags,
};




