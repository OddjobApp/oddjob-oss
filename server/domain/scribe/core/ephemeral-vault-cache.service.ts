/**
 * Ephemeral In-Flight Vault Cache
 *
 * Scoped strictly to in-flight generation cycles with a default sliding TTL of 30 minutes.
 * Uses Redis when connected; seamlessly degrades to an in-memory TTL map in hermetic,
 * single-node, or unit test environments.
 *
 * Key schema: oddjob:mask:<org_id>:<document_id>:<token_id>
 */

import { redisService } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";
import type { ScribeVaultClassification, ScribeVaultMode } from "@shared/schema/scribe.js";

const logger = createLogger("EphemeralVaultCache");

export interface EphemeralVaultPayload {
    tokenId: string;
    organizationId: number;
    documentId: number;
    nodeId?: number | null;
    classification: ScribeVaultClassification;
    mode: ScribeVaultMode;
    summary: string;
    rawPayload: string;
    localModelHint?: string | null;
    createdAt: number;
}

interface MemoryCacheEntry {
    payload: EphemeralVaultPayload;
    expiresAt: number;
}

export class EphemeralVaultCacheService {
    private static readonly DEFAULT_TTL_SECONDS = 1800; // 30 minutes sliding TTL
    private memoryFallback = new Map<string, MemoryCacheEntry>();

    private isRedisReady(): boolean {
        try {
            return Boolean(redisService.client && redisService.client.status === "ready");
        } catch {
            return false;
        }
    }

    private buildKey(orgId: number, documentId: number, tokenId: string): string {
        const cleanToken = tokenId.replace(/^oddjob:mask:/i, "").trim();
        return `oddjob:mask:${orgId}:${documentId}:${cleanToken}`;
    }

    /**
     * Store a payload in the ephemeral cache with sliding TTL.
     */
    async set(payload: EphemeralVaultPayload, ttlSeconds: number = EphemeralVaultCacheService.DEFAULT_TTL_SECONDS): Promise<void> {
        const key = this.buildKey(payload.organizationId, payload.documentId, payload.tokenId);
        const serialized = JSON.stringify(payload);

        // Always update in-memory cache as reliable backup / immediate read
        this.memoryFallback.set(key, {
            payload,
            expiresAt: Date.now() + ttlSeconds * 1000,
        });

        try {
            if (this.isRedisReady()) {
                await redisService.client.set(key, serialized, "EX", ttlSeconds);
                return;
            }
        } catch (err: any) {
            logger.warn(`Redis unavailable for set (${err.message}); cached in-memory.`);
        }
    }

    /**
     * Retrieve a payload by orgId, documentId, and tokenId.
     */
    async get(orgId: number, documentId: number, tokenId: string): Promise<EphemeralVaultPayload | null> {
        const key = this.buildKey(orgId, documentId, tokenId);

        // Check Redis first if connected
        try {
            if (this.isRedisReady()) {
                const data = await redisService.client.get(key);
                if (data) {
                    return JSON.parse(data) as EphemeralVaultPayload;
                }
            }
        } catch (err: any) {
            logger.warn(`Redis error on get (${err.message}); falling back to memory.`);
        }

        // Memory fallback check
        const entry = this.memoryFallback.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expiresAt) {
            this.memoryFallback.delete(key);
            return null;
        }

        return entry.payload;
    }

    /**
     * Delete an individual token from the cache.
     */
    async delete(orgId: number, documentId: number, tokenId: string): Promise<boolean> {
        const key = this.buildKey(orgId, documentId, tokenId);
        this.memoryFallback.delete(key);

        try {
            if (this.isRedisReady()) {
                const deleted = await redisService.client.del(key);
                return deleted > 0;
            }
        } catch (err: any) {
            logger.warn(`Redis delete error: ${err.message}`);
        }

        return true;
    }

    /**
     * Flush all tokens for a given document (e.g. on manuscript close or complete publish).
     */
    async flushForDocument(orgId: number, documentId: number): Promise<number> {
        const prefix = `oddjob:mask:${orgId}:${documentId}:`;
        let count = 0;

        // Clean from memory fallback
        for (const k of Array.from(this.memoryFallback.keys())) {
            if (k.startsWith(prefix)) {
                this.memoryFallback.delete(k);
                count++;
            }
        }

        // Clean from Redis
        try {
            if (this.isRedisReady()) {
                const keys = await redisService.client.keys(`${prefix}*`);
                if (keys.length > 0) {
                    await redisService.client.del(...keys);
                    count = Math.max(count, keys.length);
                }
            }
        } catch (err: any) {
            logger.warn(`Redis flush error: ${err.message}`);
        }

        return count;
    }

    /**
     * Clear expired entries from memory fallback (periodic hygiene).
     */
    pruneExpired(): void {
        const now = Date.now();
        for (const [key, entry] of this.memoryFallback.entries()) {
            if (now > entry.expiresAt) {
                this.memoryFallback.delete(key);
            }
        }
    }
}

export const ephemeralVaultCache = new EphemeralVaultCacheService();
