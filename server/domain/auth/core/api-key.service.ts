import { db } from "@server/database_service.js";
import { apiKeys, type ApiKey } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ApiKeyService");

export const apiKeyService = {
    /**
     * Generate a new API key for an organization
     * Returns the raw key (only shown once!) and the database record
     */
    async generateKey(orgId: number, name: string, type: 'partner' | 'client' = 'partner') {
        const rawKey = `rk_${type}_${randomBytes(24).toString('hex')}`;
        const keyHash = this._hashKey(rawKey);
        const prefix = rawKey.substring(0, 7);

        const [apiKey] = await db.insert(apiKeys).values({
            name,
            organizationId: orgId,
            type,
            keyHash,
            prefix,
            revoked: false
        }).returning();

        return { rawKey, apiKey };
    },

    /**
     * Verify a raw API key and return the associated organization/metadata
     */
    async verifyKey(rawKey: string): Promise<ApiKey | null> {
        if (!rawKey) return null;

        const keyHash = this._hashKey(rawKey);
        const [apiKey] = await db.select()
            .from(apiKeys)
            .where(and(
                eq(apiKeys.keyHash, keyHash),
                eq(apiKeys.revoked, false)
            ));

        if (apiKey) {
            // Update last used asynchronously
            db.update(apiKeys)
                .set({ lastUsedAt: new Date() })
                .where(eq(apiKeys.id, apiKey.id))
                .catch(err => logger.error("Failed to update lastUsedAt", err));

            return apiKey;
        }

        return null;
    },

    /**
     * Internal helper to hash keys using SHA-256
     */
    _hashKey(key: string): string {
        return createHash("sha256").update(key).digest("hex");
    }
};


