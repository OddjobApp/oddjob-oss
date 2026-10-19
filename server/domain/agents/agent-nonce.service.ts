/**
 * Agent Nonce Service
 * 
 * Provides session-scoped nonces for secure pipeline/tool execution.
 * Prevents exposure of internal pipeline IDs to external users.
 */

import crypto from 'crypto';
import { createLogger } from "@server/utils/logger.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger('AgentNonceService');

/**
 * Nonce mapping entry
 */
interface NonceMapping {
    sessionId: string;
    nonce: string;
    pipelineId: number | string;
    pipelineName?: string;
    /** QR-scanned asset ID, carried forward so a later [FORM_SUBMISSION] can
     *  re-resolve the asset without the client having to resend it. */
    assetId?: string;
    createdAt: Date;
    expiresAt: Date;
}

/**
 * Prefix for Redis keys to avoid collisions
 */
const REDIS_PREFIX = 'agent:nonce:';

/**
 * Default nonce TTL: 1 hour
 */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/**
 * Generate a cryptographically secure nonce
 */
function generateRandomNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

export const agentNonceService = {
    /**
     * Generate a new nonce for a pipeline within a session
     * 
     * @param sessionId - The user's session ID
     * @param pipelineId - The internal pipeline ID to protect
     * @param pipelineName - Optional pipeline name for logging
     * @param ttlMs - Time to live in milliseconds (default: 1 hour)
     * @returns The generated nonce
     */
    async generate(
        sessionId: string,
        pipelineId: number | string,
        pipelineName?: string,
        ttlMs: number = DEFAULT_TTL_MS,
        assetId?: string
    ): Promise<string> {
        const nonce = `nonce-${generateRandomNonce()}`;
        const now = new Date();

        const mapping: NonceMapping = {
            sessionId,
            nonce,
            pipelineId,
            pipelineName,
            assetId,
            createdAt: now,
            expiresAt: new Date(now.getTime() + ttlMs)
        };

        const key = `${REDIS_PREFIX}${nonce}`;
        try {
            await redis.set(key, JSON.stringify(mapping), 'PX', ttlMs);

            logger.debug('Nonce generated and persisted to Redis', {
                nonce: nonce.slice(0, 12) + '...',
                pipelineId,
                sessionId: sessionId.slice(0, 8) + '...',
                expiresIn: `${ttlMs / 1000}s`
            });
        } catch (err) {
            logger.error('Failed to persist nonce to Redis', { error: err });
            // Fallback would be hard here since we need sync across calls
            // Throwing is safer for security nonces
            throw new Error('Internal state error: Failed to generate secure session nonce.');
        }

        return nonce;
    },

    /**
     * Resolve a nonce to its pipeline ID
     * Validates session ownership and expiration
     * 
     * @param sessionId - The requesting session's ID
     * @param nonce - The nonce to resolve
     * @returns The pipeline ID if valid, null otherwise
     */
    async resolve(sessionId: string, nonce: string): Promise<number | string | null> {
        const key = `${REDIS_PREFIX}${nonce}`;

        try {
            const data = await redis.get(key);
            if (!data) {
                logger.warn('Nonce not found or expired in Redis', { nonce: nonce.slice(0, 12) + '...' });
                return null;
            }

            const mapping: NonceMapping = JSON.parse(data);

            // Check session ownership
            if (mapping.sessionId !== sessionId) {
                logger.warn('Nonce session mismatch', {
                    nonce: nonce.slice(0, 12) + '...',
                    expected: mapping.sessionId.slice(0, 8) + '...',
                    got: sessionId.slice(0, 8) + '...'
                });
                return null;
            }

            logger.debug('Nonce resolved from Redis', {
                nonce: nonce.slice(0, 12) + '...',
                pipelineId: mapping.pipelineId
            });

            return mapping.pipelineId;
        } catch (err) {
            logger.error('Failed to resolve nonce from Redis', { error: err });
            return null;
        }
    },

    /**
     * Resolve a nonce and return full mapping
     */
    async resolveWithContext(sessionId: string, nonce: string): Promise<NonceMapping | null> {
        const key = `${REDIS_PREFIX}${nonce}`;
        try {
            const data = await redis.get(key);
            if (!data) return null;

            const mapping: NonceMapping = JSON.parse(data);
            if (mapping.sessionId !== sessionId) return null;

            return mapping;
        } catch (err) {
            logger.error('Failed to resolve nonce context from Redis', { error: err });
            return null;
        }
    },

    /**
     * Invalidate a specific nonce
     */
    async invalidate(nonce: string): Promise<boolean> {
        const key = `${REDIS_PREFIX}${nonce}`;
        try {
            const deleted = await redis.del(key);
            if (deleted) {
                logger.debug('Nonce invalidated in Redis', { nonce: nonce.slice(0, 12) + '...' });
            }
            return deleted > 0;
        } catch (err) {
            logger.error('Failed to invalidate nonce in Redis', { error: err });
            return false;
        }
    },

    /**
     * Invalidate all nonces for a session (e.g., on logout)
     */
    async invalidateSession(sessionId: string): Promise<number> {
        let count = 0;
        try {
            // Using scan to find keys is safer than KEYS *
            let cursor = '0';
            do {
                const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${REDIS_PREFIX}*`, 'COUNT', 100);
                cursor = nextCursor;

                for (const key of keys) {
                    const data = await redis.get(key);
                    if (data) {
                        const mapping = JSON.parse(data);
                        if (mapping.sessionId === sessionId) {
                            await redis.del(key);
                            count++;
                        }
                    }
                }
            } while (cursor !== '0');

            if (count > 0) {
                logger.debug('Session nonces invalidated in Redis', { sessionId: sessionId.slice(0, 8) + '...', count });
            }
        } catch (err) {
            logger.error('Failed to invalidate session nonces in Redis', { error: err });
        }
        return count;
    },

    /**
     * Get stats about the nonce store (for monitoring)
     * Note: This is expensive in Redis and should be used sparingly
     */
    async getStats(): Promise<{ total: number; sessions: number }> {
        const sessions = new Set<string>();
        let total = 0;
        try {
            let cursor = '0';
            do {
                const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${REDIS_PREFIX}*`, 'COUNT', 100);
                cursor = nextCursor;
                total += keys.length;

                for (const key of keys) {
                    const data = await redis.get(key);
                    if (data) {
                        const mapping = JSON.parse(data);
                        sessions.add(mapping.sessionId);
                    }
                }
            } while (cursor !== '0');
        } catch (err) {
            logger.error('Failed to get nonce stats from Redis', { error: err });
        }
        return {
            total,
            sessions: sessions.size
        };
    }
};

// Cleanup is handled by Redis TTL automatically

// Export types for use in other modules
export type { NonceMapping };


