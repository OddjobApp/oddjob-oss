/**
 * Embed Profile Cache
 * In-memory cache for profile data keyed by sessionId.
 * Reduces external API calls when the same session sends multiple messages.
 */
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

export interface CachedFile {
    content: string;
    type: string;
    summary: string;
    metadata?: any;
}

const DEFAULT_TTL_SECONDS = 120; // 2 minutes

interface CacheEntry {
    profile: object;
    expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cleanupExpired() {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
        if (now >= entry.expiresAt) cache.delete(key);
    }
}

/**
 * Get cached profile for a session. Returns null if miss or expired.
 */
export function getCachedProfile(sessionId: string): object | null {
    cleanupExpired();
    const entry = cache.get(sessionId);
    if (!entry || Date.now() >= entry.expiresAt) return null;
    return entry.profile;
}

/**
 * Store profile in cache with TTL.
 */
export function setCachedProfile(
    sessionId: string,
    profile: object,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
): void {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    cache.set(sessionId, { profile, expiresAt });
}

/**
 * Invalidate cache for a session (e.g. on logout).
 */
export function invalidateCachedProfile(sessionId: string): void {
    cache.delete(sessionId);
}

/**
 * Redis-backed File and Chat Cache for Agent Service
 */

const FILE_CACHE_TTL = 60 * 60 * 24; // 24 hours
const CHAT_HISTORY_TTL = 60 * 60 * 24 * 7; // 7 days

/**
 * Get a file from the Redis cache
 */
export async function getFileCache(fileId: string): Promise<CachedFile | null> {
    const data = await redis.get(`file_cache:${fileId}`);
    return data ? JSON.parse(data) : null;
}

/**
 * Set a file in the Redis cache
 */
export async function setFileCache(fileId: string, data: CachedFile): Promise<void> {
    await redis.set(
        `file_cache:${fileId}`,
        JSON.stringify(data),
        'EX',
        FILE_CACHE_TTL
    );
}

/**
 * Get chat history for a user/session from Redis
 */
export async function getChatHistory(historyKey: string): Promise<any[]> {
    try {
        const data = await redis.get(`chat_history:${historyKey}`);
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

/**
 * Set chat history for a user/session in Redis
 */
export async function setChatHistory(historyKey: string, history: any[]): Promise<void> {
    try {
        await redis.set(
            `chat_history:${historyKey}`,
            JSON.stringify(history),
            'EX',
            CHAT_HISTORY_TTL
        );
    } catch {
        // Redis unavailable — history won't persist but chat continues
    }
}


