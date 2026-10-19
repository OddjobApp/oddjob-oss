import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";
import crypto from "crypto";

const logger = createLogger("LockService");
const LOCK_PREFIX = "oddjob:lock:";

export const lockService = {
    /**
     * Acquire a distributed lock.
     * @param key The lock identifier
     * @param ttlSeconds Time to live for the lock in seconds
     * @returns The owner token string if lock was acquired, null otherwise
     */
    async acquireLock(key: string, ttlSeconds: number = 60): Promise<string | null> {
        try {
            const fullKey = `${LOCK_PREFIX}${key}`;
            const token = crypto.randomUUID();
            // NX: Set if not exists, EX: Set expiration in seconds
            const result = await redis.set(fullKey, token, "EX", ttlSeconds, "NX");
            return result === "OK" ? token : null;
        } catch (error) {
            logger.error(`Failed to acquire lock for ${key}`, error);
            return null;
        }
    },

    /**
     * Release a distributed lock.
     * @param key The lock identifier
     * @param ownerToken Optional owner token. If provided, the lock is only released if the token matches.
     * @returns true if released successfully (or if it did not exist), false if token mismatch
     */
    async releaseLock(key: string, ownerToken?: string): Promise<boolean> {
        try {
            const fullKey = `${LOCK_PREFIX}${key}`;
            if (!ownerToken) {
                await redis.del(fullKey);
                return true;
            }

            const result = await redis.eval(
                `if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end`,
                1,
                fullKey,
                ownerToken
            );
            return result === 1;
        } catch (error) {
            logger.error(`Failed to release lock for ${key}`, error);
            return false;
        }
    },

    /**
     * Extend a distributed lock's TTL.
     * @param key The lock identifier
     * @param ownerToken The owner token of the lock
     * @param ttlSeconds The new time to live in seconds
     * @returns true if the lock was extended, false otherwise
     */
    async extendLock(key: string, ownerToken: string, ttlSeconds: number = 60): Promise<boolean> {
        try {
            const fullKey = `${LOCK_PREFIX}${key}`;
            const result = await redis.eval(
                `if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("expire", KEYS[1], ARGV[2])
                else
                    return 0
                end`,
                1,
                fullKey,
                ownerToken,
                ttlSeconds
            );
            return result === 1;
        } catch (error) {
            logger.error(`Failed to extend lock for ${key}`, error);
            return false;
        }
    },

    /**
     * Check if a lock is currently held.
     */
    async isLocked(key: string): Promise<boolean> {
        try {
            const fullKey = `${LOCK_PREFIX}${key}`;
            const exists = await redis.exists(fullKey);
            return exists === 1;
        } catch (error) {
            logger.error(`Failed to check lock for ${key}`, error);
            return false;
        }
    }
};




