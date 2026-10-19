/**
 * Classification Cache Service
 * Redis-backed LRU cache for intent classification results.
 * Key pattern: `intent-cache:{sessionId}:{sha256(prompt)}`
 * TTL: 60 seconds, max 200 entries per session (LRU eviction).
 */

import { createHash } from "node:crypto";
import { createLogger } from "@server/utils/logger.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import type { ClassificationResult } from "@shared/schema/intent-router.js";

const logger = createLogger("ClassificationCacheService");

// ============================================================================
// CONSTANTS
// ============================================================================

const CACHE_PREFIX = "intent-cache";
const SESSION_INDEX_PREFIX = "intent-cache-idx";
const AGENT_CARD_INDEX_PREFIX = "intent-cache-agent";
const STATS_PREFIX = "intent-cache-stats";

const DEFAULT_TTL_SECONDS = 60;
const DEFAULT_MAX_ENTRIES_PER_SESSION = 200;

// ============================================================================
// INTERFACES
// ============================================================================

export interface CacheConfig {
  ttlSeconds: number;
  maxEntriesPerSession: number;
  evictionPolicy: "lru";
}

export interface SessionCacheStats {
  entries: number;
  hits: number;
  misses: number;
}

// ============================================================================
// SERVICE
// ============================================================================

export class ClassificationCacheService {
  private readonly config: CacheConfig;

  constructor(config?: Partial<CacheConfig>) {
    this.config = {
      ttlSeconds: config?.ttlSeconds ?? DEFAULT_TTL_SECONDS,
      maxEntriesPerSession: config?.maxEntriesPerSession ?? DEFAULT_MAX_ENTRIES_PER_SESSION,
      evictionPolicy: "lru",
    };
  }

  // --------------------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------------------

  /**
   * Retrieve a cached classification result.
   * Returns null on cache miss.
   */
  async get(sessionId: string, promptHash: string): Promise<ClassificationResult | null> {
    const cacheKey = this.buildCacheKey(sessionId, promptHash);

    try {
      const cached = await redis.get(cacheKey);

      if (!cached) {
        await this.incrementStat(sessionId, "misses");
        return null;
      }

      // Touch the entry in the session sorted set to update LRU timestamp
      const sessionIndexKey = this.buildSessionIndexKey(sessionId);
      await redis.zadd(sessionIndexKey, Date.now(), cacheKey);

      await this.incrementStat(sessionId, "hits");
      return JSON.parse(cached) as ClassificationResult;
    } catch (err) {
      logger.error("Cache get failed", { sessionId, promptHash, error: (err as Error).message });
      return null;
    }
  }

  /**
   * Store a classification result in the cache.
   * Enforces LRU eviction when session exceeds maxEntriesPerSession.
   */
  async set(sessionId: string, promptHash: string, result: ClassificationResult): Promise<void> {
    const cacheKey = this.buildCacheKey(sessionId, promptHash);
    const sessionIndexKey = this.buildSessionIndexKey(sessionId);

    try {
      // Store the result with TTL
      await redis.setex(cacheKey, this.config.ttlSeconds, JSON.stringify(result));

      // Add to session sorted set (score = current timestamp for LRU ordering)
      await redis.zadd(sessionIndexKey, Date.now(), cacheKey);
      // Set TTL on the session index slightly longer than cache TTL to allow cleanup
      await redis.expire(sessionIndexKey, this.config.ttlSeconds + 10);

      // Maintain reverse index: agentCardId → set of cache keys
      const agentIndexKey = this.buildAgentCardIndexKey(result.selectedAgentCardId);
      await redis.sadd(agentIndexKey, cacheKey);
      await redis.expire(agentIndexKey, this.config.ttlSeconds + 10);

      // Enforce LRU eviction
      await this.enforceLruLimit(sessionId, sessionIndexKey);
    } catch (err) {
      logger.error("Cache set failed", { sessionId, promptHash, error: (err as Error).message });
    }
  }

  /**
   * Invalidate a specific cache entry by session and prompt hash.
   */
  async invalidate(sessionId: string, promptHash: string): Promise<void> {
    const cacheKey = this.buildCacheKey(sessionId, promptHash);
    const sessionIndexKey = this.buildSessionIndexKey(sessionId);

    try {
      // Get the cached result to clean up the agent card index
      const cached = await redis.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached) as ClassificationResult;
        const agentIndexKey = this.buildAgentCardIndexKey(result.selectedAgentCardId);
        await redis.srem(agentIndexKey, cacheKey);
      }

      await redis.del(cacheKey);
      await redis.zrem(sessionIndexKey, cacheKey);
    } catch (err) {
      logger.error("Cache invalidate failed", { sessionId, promptHash, error: (err as Error).message });
    }
  }

  /**
   * Invalidate all cache entries that reference a specific agent card.
   * Used when an agent card is disabled or deleted during a session.
   */
  async invalidateByAgentCard(agentCardId: number): Promise<void> {
    const agentIndexKey = this.buildAgentCardIndexKey(agentCardId);

    try {
      // Get all cache keys that reference this agent card
      const cacheKeys = await redis.smembers(agentIndexKey);

      if (cacheKeys.length === 0) return;

      // Delete all cached entries and remove from session indexes
      const pipeline = redis.pipeline();
      for (const cacheKey of cacheKeys) {
        pipeline.del(cacheKey);

        // Extract sessionId from cacheKey to remove from the session sorted set
        const sessionId = this.extractSessionIdFromCacheKey(cacheKey);
        if (sessionId) {
          const sessionIndexKey = this.buildSessionIndexKey(sessionId);
          pipeline.zrem(sessionIndexKey, cacheKey);
        }
      }

      // Clear the agent card index itself
      pipeline.del(agentIndexKey);

      await pipeline.exec();

      logger.info("Invalidated cache entries by agent card", {
        agentCardId,
        entriesInvalidated: cacheKeys.length,
      });
    } catch (err) {
      logger.error("Cache invalidateByAgentCard failed", {
        agentCardId,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Get cache statistics for a session (entries count, hits, misses).
   */
  async getSessionStats(sessionId: string): Promise<SessionCacheStats> {
    const sessionIndexKey = this.buildSessionIndexKey(sessionId);
    const statsKey = this.buildStatsKey(sessionId);

    try {
      const [entries, hitsRaw, missesRaw] = await Promise.all([
        redis.zcard(sessionIndexKey),
        redis.hget(statsKey, "hits"),
        redis.hget(statsKey, "misses"),
      ]);

      return {
        entries,
        hits: parseInt(hitsRaw || "0", 10),
        misses: parseInt(missesRaw || "0", 10),
      };
    } catch (err) {
      logger.error("Cache getSessionStats failed", { sessionId, error: (err as Error).message });
      return { entries: 0, hits: 0, misses: 0 };
    }
  }

  // --------------------------------------------------------------------------
  // STATIC UTILITIES
  // --------------------------------------------------------------------------

  /**
   * Compute SHA-256 hash of a prompt string.
   * Used externally to generate the promptHash parameter.
   */
  static hashPrompt(prompt: string): string {
    return createHash("sha256").update(prompt).digest("hex");
  }

  // --------------------------------------------------------------------------
  // PRIVATE METHODS
  // --------------------------------------------------------------------------

  private buildCacheKey(sessionId: string, promptHash: string): string {
    return `${CACHE_PREFIX}:${sessionId}:${promptHash}`;
  }

  private buildSessionIndexKey(sessionId: string): string {
    return `${SESSION_INDEX_PREFIX}:${sessionId}`;
  }

  private buildAgentCardIndexKey(agentCardId: number): string {
    return `${AGENT_CARD_INDEX_PREFIX}:${agentCardId}`;
  }

  private buildStatsKey(sessionId: string): string {
    return `${STATS_PREFIX}:${sessionId}`;
  }

  /**
   * Extract sessionId from a cache key.
   * Key format: `intent-cache:{sessionId}:{promptHash}`
   */
  private extractSessionIdFromCacheKey(cacheKey: string): string | null {
    const parts = cacheKey.split(":");
    // intent-cache : sessionId : promptHash
    if (parts.length >= 3 && parts[0] === CACHE_PREFIX) {
      // sessionId is everything between first and last colon-delimited segment
      // Since promptHash is always a 64-char hex, take from index 1 to length-1
      return parts.slice(1, -1).join(":");
    }
    return null;
  }

  /**
   * Enforce the LRU entry limit for a session.
   * Removes the oldest entries (lowest score = oldest access time) when over limit.
   */
  private async enforceLruLimit(sessionId: string, sessionIndexKey: string): Promise<void> {
    const currentCount = await redis.zcard(sessionIndexKey);

    if (currentCount <= this.config.maxEntriesPerSession) return;

    // Number of entries to evict
    const evictCount = currentCount - this.config.maxEntriesPerSession;

    // Get the oldest entries (lowest scores = earliest access)
    const keysToEvict = await redis.zrange(sessionIndexKey, 0, evictCount - 1);

    if (keysToEvict.length === 0) return;

    const pipeline = redis.pipeline();

    for (const cacheKey of keysToEvict) {
      pipeline.del(cacheKey);
    }

    // Remove evicted entries from the session sorted set
    pipeline.zremrangebyrank(sessionIndexKey, 0, evictCount - 1);

    await pipeline.exec();

    logger.debug("LRU eviction performed", {
      sessionId,
      evictedCount: keysToEvict.length,
    });
  }

  /**
   * Increment a stat counter for the session.
   */
  private async incrementStat(sessionId: string, field: "hits" | "misses"): Promise<void> {
    const statsKey = this.buildStatsKey(sessionId);
    try {
      await redis.hincrby(statsKey, field, 1);
      await redis.expire(statsKey, this.config.ttlSeconds * 5); // Keep stats longer than entries
    } catch {
      // Non-critical — don't let stat tracking failures break the cache
    }
  }
}

// Singleton instance with default configuration
export const classificationCacheService = new ClassificationCacheService();
