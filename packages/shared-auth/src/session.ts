/**
 * Session Utilities
 * 
 * Shared session parsing and validation for services
 * that need to verify user sessions from the API gateway.
 */

import { Redis } from "ioredis";
import type { SessionData, UserContext, AuthResult } from "./types.js";

// Redis configuration
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const SESSION_PREFIX = "oddjob:sess:";

let redisClient: Redis | null = null;

/**
 * Get or create Redis client
 */
function getRedis(): Redis {
    if (!redisClient) {
        redisClient = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 3,
            lazyConnect: true,
        });
    }
    return redisClient;
}

/**
 * Parse session ID from cookie value
 * Express-session uses format: s:<signed_value>
 */
export function parseSessionId(cookieValue: string): string | null {
    if (!cookieValue) return null;

    // Remove signature if present (s:xxxxx.signature)
    const match = cookieValue.match(/^s:([^.]+)/);
    if (match) {
        return match[1];
    }

    // Plain session ID
    return cookieValue;
}

/**
 * Get session data from Redis
 */
export async function getSession(sessionId: string): Promise<SessionData | null> {
    try {
        const redis = getRedis();
        const data = await redis.get(`${SESSION_PREFIX}${sessionId}`);

        if (!data) return null;

        const session = JSON.parse(data);
        return session as SessionData;
    } catch (error) {
        console.error("[shared-auth] Failed to get session:", error);
        return null;
    }
}

/**
 * Validate a session and return user context
 */
export async function validateSession(sessionId: string): Promise<AuthResult> {
    const session = await getSession(sessionId);

    if (!session) {
        return { success: false, error: "Session not found" };
    }

    // Check expiration
    if (session.expiresAt && Date.now() > session.expiresAt) {
        return { success: false, error: "Session expired" };
    }

    return {
        success: true,
        user: {
            userId: session.userId,
            username: "", // Would need DB lookup
            email: "",    // Would need DB lookup
            organizationId: session.organizationId,
            role: session.role as UserContext['role'],
        },
    };
}

/**
 * Extract and validate session from request headers
 * Useful for services behind the API gateway
 */
export async function validateRequestSession(headers: {
    cookie?: string;
    authorization?: string;
    "x-session-id"?: string;
}): Promise<AuthResult> {
    // Try X-Session-ID header first (set by API gateway)
    if (headers["x-session-id"]) {
        return validateSession(headers["x-session-id"]);
    }

    // Try cookie
    if (headers.cookie) {
        const sessionMatch = headers.cookie.match(/connect\.sid=([^;]+)/);
        if (sessionMatch) {
            const sessionId = parseSessionId(decodeURIComponent(sessionMatch[1]));
            if (sessionId) {
                return validateSession(sessionId);
            }
        }
    }

    return { success: false, error: "No session found in request" };
}

/**
 * Close Redis connection
 */
export async function closeSession(): Promise<void> {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
    }
}

