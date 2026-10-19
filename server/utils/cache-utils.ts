import { getRedisClient } from "../domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "./logger.js";

const logger = createLogger("CacheUtils");

/**
 * Scan and delete Redis keys matching a pattern in a non-blocking manner.
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
    try {
        const redis = getRedisClient();
        let cursor = "0";
        let deletedCount = 0;
        
        do {
            const reply = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
            cursor = reply[0];
            const keys = reply[1];
            if (keys.length > 0) {
                await redis.del(...keys);
                deletedCount += keys.length;
            }
        } while (cursor !== "0");
        
        if (deletedCount > 0) {
            logger.info(`[Cache] Invalidated ${deletedCount} keys matching pattern: ${pattern}`);
        }
    } catch (err: any) {
        logger.error(`[Cache] Failed to invalidate pattern ${pattern}: ${err.message}`);
    }
}

/**
 * Invalidate cached form agent definitions for an organization or all orgs.
 */
export async function invalidateFormAgentCache(organizationId?: number | null): Promise<void> {
    const pattern = organizationId != null
        ? `oddjob:form_agents:org:${organizationId}*`
        : `oddjob:form_agents:org:*`;
    await invalidateCachePattern(pattern);
}

/**
 * Invalidate cached installed app catalog for an organization or all orgs.
 */
export async function invalidateInstalledAppsCache(organizationId?: number | null): Promise<void> {
    const pattern = organizationId != null
        ? `oddjob:installed_apps:org:${organizationId}*`
        : `oddjob:installed_apps:org:*`;
    await invalidateCachePattern(pattern);
}
