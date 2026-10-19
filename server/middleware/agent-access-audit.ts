/**
 * Agent Access Audit Middleware
 * 
 * Logs all public agent access for security, analytics, and compliance.
 * Captures Cloudflare-specific headers when accessed via Cloudflare Tunnel.
 */

import { Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger.js";
import { db } from "../database_service.js";

const logger = createLogger("AgentAccessAudit");

/**
 * Cloudflare headers that may be present when accessed via Cloudflare Tunnel
 */
interface CloudflareHeaders {
    /** Client's real IP address */
    cfConnectingIp?: string;
    /** Client's country code (ISO 3166-1 Alpha 2) */
    cfIpCountry?: string;
    /** Cloudflare Ray ID for request tracing */
    cfRay?: string;
    /** Authenticated user email from Cloudflare Access JWT */
    cfAccessAuthenticatedUserEmail?: string;
    /** Cloudflare Access JWT for identity verification */
    cfAccessJwtAssertion?: string;
}

/**
 * Agent access log entry
 */
export interface AgentAccessLogEntry {
    timestamp: string;
    slug: string;
    action: "view" | "chat" | "auth" | "messages" | "feedback";
    sessionId?: string;
    ipAddress?: string;
    country?: string;
    cfRay?: string;
    authenticatedEmail?: string;
    userAgent?: string;
    method: string;
    path: string;
    statusCode?: number;
    durationMs?: number;
    correlationId?: string;
}

/**
 * Extract Cloudflare headers from request
 */
function extractCloudflareHeaders(req: Request): CloudflareHeaders {
    return {
        cfConnectingIp: req.headers["cf-connecting-ip"] as string | undefined,
        cfIpCountry: req.headers["cf-ipcountry"] as string | undefined,
        cfRay: req.headers["cf-ray"] as string | undefined,
        cfAccessAuthenticatedUserEmail: req.headers["cf-access-authenticated-user-email"] as string | undefined,
        cfAccessJwtAssertion: req.headers["cf-access-jwt-assertion"] as string | undefined
    };
}

/**
 * Determine action type from request path
 */
function getActionType(path: string, method: string): AgentAccessLogEntry["action"] {
    if (path.includes("/auth")) return "auth";
    if (path.includes("/chat")) return "chat";
    if (path.includes("/messages")) return "messages";
    if (path.includes("/feedback")) return "feedback";
    return "view";
}

/**
 * Extract slug from path like /api/public/agents/:slug or /api/public/agents/:slug/chat
 */
function extractSlug(path: string): string | undefined {
    const match = path.match(/\/api\/public\/agents\/([^\/]+)/);
    return match?.[1];
}

/**
 * Middleware for auditing public agent access
 */
export function agentAccessAuditMiddleware(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const cf = extractCloudflareHeaders(req);
    const slug = extractSlug(req.path);

    // Log on response finish
    res.on("finish", () => {
        try {
            const logEntry: AgentAccessLogEntry = {
                timestamp: new Date().toISOString(),
                slug: slug || "unknown",
                action: getActionType(req.path, req.method),
                sessionId: (req.body?.sessionId || req.query?.sessionId) as string | undefined,
                ipAddress: cf.cfConnectingIp || req.ip || req.socket?.remoteAddress,
                country: cf.cfIpCountry,
                cfRay: cf.cfRay,
                authenticatedEmail: cf.cfAccessAuthenticatedUserEmail,
                userAgent: req.headers["user-agent"]?.slice(0, 200),
                method: req.method,
                path: req.originalUrl,
                statusCode: res.statusCode,
                durationMs: Date.now() - startTime,
                correlationId: (req as any).correlationId
            };

            // Log based on status code
            if (res.statusCode >= 500) {
                logger.error("Agent access error", undefined, logEntry);
            } else if (res.statusCode >= 400) {
                logger.warn("Agent access denied/error", logEntry);
            } else {
                logger.info("Agent access", logEntry);
            }

            // Optionally persist to database for analytics (async, non-blocking)
            // This could be extended to insert into an agent_access_logs table
            if (logEntry.action === "chat") {
                // Track chat interactions specifically for analytics
                persistChatAccess(logEntry).catch(err => {
                    logger.debug("Failed to persist chat access log", { error: err.message });
                });
            }

        } catch (err) {
            logger.debug("AgentAccessAudit error", { error: (err as Error).message });
        }
    });

    next();
}

/**
 * Persist chat access to database for analytics
 * This is called asynchronously and should not block the response
 */
async function persistChatAccess(entry: AgentAccessLogEntry): Promise<void> {
    // Future: Insert into agent_access_logs table
    // For now, just logging is sufficient
    // await db.insert(agentAccessLogs).values({...});
}

/**
 * Simple rate limiting state (in-memory, per-process)
 * For production, use Redis or similar
 */
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * Rate limiting middleware for public agent access
 * Prevents abuse by limiting requests per IP
 */
export function agentRateLimitMiddleware(
    maxRequests: number = 100,
    windowMs: number = 60 * 1000 // 1 minute
) {
    return (req: Request, res: Response, next: NextFunction) => {
        const cf = extractCloudflareHeaders(req);
        const clientId = cf.cfConnectingIp || req.ip || "unknown";
        const now = Date.now();

        let entry = rateLimitStore.get(clientId);

        if (!entry || now > entry.resetTime) {
            entry = { count: 1, resetTime: now + windowMs };
            rateLimitStore.set(clientId, entry);
        } else {
            entry.count++;
        }

        // Set rate limit headers
        res.setHeader("X-RateLimit-Limit", maxRequests);
        res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - entry.count));
        res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetTime / 1000));

        if (entry.count > maxRequests) {
            logger.warn("Rate limit exceeded", {
                clientId,
                count: entry.count,
                path: req.path,
                country: cf.cfIpCountry
            });
            res.status(429).json({
                error: "Too many requests",
                retryAfterMs: entry.resetTime - now
            });
            return;
        }

        next();
    };
}

// Cleanup old rate limit entries periodically (every 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitStore.entries()) {
        if (now > value.resetTime) {
            rateLimitStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

