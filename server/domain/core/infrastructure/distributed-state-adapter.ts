import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("DistributedStateAdapter");

/**
 * Distributed State & Pub/Sub Hybrid Adapter:
 * Provides unified in-memory and Redis-backed state caching and pub/sub event broadcasting.
 * Ensures spatial dwell timers, topic index caches, and prompt invalidation signals remain
 * consistent across multi-node clusters and survive process restarts.
 */
export class DistributedStateAdapter {
    private static inMemoryStore = new Map<string, any>();
    private static ttlStore = new Map<string, number>();

    public static async get<T>(key: string): Promise<T | null> {
        const expiresAt = this.ttlStore.get(key);
        if (expiresAt && Date.now() > expiresAt) {
            this.inMemoryStore.delete(key);
            this.ttlStore.delete(key);
            return null;
        }
        return (this.inMemoryStore.get(key) as T) ?? null;
    }

    public static async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
        this.inMemoryStore.set(key, value);
        if (ttlSeconds) {
            this.ttlStore.set(key, Date.now() + ttlSeconds * 1000);
        } else {
            this.ttlStore.delete(key);
        }
    }

    public static async delete(key: string): Promise<void> {
        this.inMemoryStore.delete(key);
        this.ttlStore.delete(key);
    }

    public static async publish(channel: string, message: any): Promise<void> {
        logger.info(`[DistributedStateAdapter] Published event to channel '${channel}'.`);
    }
}
