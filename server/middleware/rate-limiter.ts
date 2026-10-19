import { Request, Response, NextFunction } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import { redis } from "../domain/core/infrastructure/redis/redis-client.js";
import { RateLimitError } from "../utils/errors.js";

interface RateLimitOptions {
    windowMs: number;
    maxRequests: number;
    keyGenerator?: (req: Request) => string;
}

/**
 * Redis-backed rate limiter middleware.
 * Implements a simple fixed-window rate limiting strategy.
 */
export function createRateLimiter(options: RateLimitOptions) {
    const {
        windowMs,
        maxRequests,
        // ipKeyGenerator collapses an IPv6 address to its /56 subnet: one client
        // holds a whole block, and keying on the full address lets it rotate
        // through the block to reset its limit.
        keyGenerator = (req: Request) => ipKeyGenerator(req.ip || req.socket.remoteAddress || "unknown")
    } = options;

    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const key = `ratelimit:${req.originalUrl.split('?')[0]}:${keyGenerator(req)}`;

            // Increment the counter for this key
            const currentCount = await redis.incr(key);

            // If it's the first request in the window, set the expiry
            if (currentCount === 1) {
                await redis.pexpire(key, windowMs);
            }

            // Set standard rate limit headers
            res.setHeader('X-RateLimit-Limit', maxRequests);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - currentCount));

            if (currentCount > maxRequests) {
                // If the key has no TTL for some reason, ensure it expires to prevent eternal blocks
                const rootTtl = await redis.pttl(key);
                if (rootTtl === -1) {
                    await redis.pexpire(key, windowMs);
                }

                // Get the remaining TTL to inform the client when to reset
                const ttl = await redis.pttl(key);
                res.setHeader('Retry-After', Math.ceil(ttl / 1000));

                throw new RateLimitError("Too many requests from this IP, please try again later.");
            }

            next();
        } catch (error) {
            // In case Redis fails, we should fail open (allow the request) to prevent a Redis outage from taking down the app,
            // or fail closed depending on security posture. Fast-fail open is generally safer for availability.
            if (error instanceof RateLimitError) {
                next(error);
            } else {
                console.warn("[RateLimiter] Error communicating with Redis, bypassing rate limit:", error);
                next();
            }
        }
    };
}

