import { type Request, type Response, type NextFunction } from "express";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("OrgRateLimit");

interface OrgRateLimitOptions {
    /** Max launches per window */
    max: number;
    /** Window duration in seconds */
    windowSecs: number;
    /** Human-readable resource name for error messages */
    resource: string;
}

/**
 * Per-organization rate limiter backed by Redis.
 * Use on expensive launch endpoints (missions, cycles) to prevent one org
 * from saturating the BullMQ worker pool for all others.
 */
export function orgRateLimit(options: OrgRateLimitOptions) {
    const { max, windowSecs, resource } = options;

    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orgId = (req as any).user?.organizationId ?? (req as any).organizationId;
            if (!orgId) return next(); // Skip unauthenticated requests (auth middleware will reject them)

            if (!redis) return next(); // Redis unavailable — fail open

            const key = `ratelimit:${resource}:org:${orgId}`;
            const current = await redis.incr(key);

            if (current === 1) {
                // First request in this window — set TTL
                await redis.expire(key, windowSecs);
            }

            if (current > max) {
                const ttl = await redis.ttl(key);
                logger.warn(`[OrgRateLimit] Org ${orgId} exceeded ${resource} limit (${current}/${max}). Retry in ${ttl}s.`);
                res.setHeader("Retry-After", String(ttl));
                return res.status(429).json({
                    error: `Too many ${resource} launches. Limit: ${max} per ${windowSecs}s. Retry in ${ttl}s.`
                });
            }
        } catch (err: any) {
            // Fail open — never block legitimate traffic due to Redis errors
            logger.warn(`[OrgRateLimit] Redis error, skipping limit: ${err.message}`);
        }

        return next();
    };
}
