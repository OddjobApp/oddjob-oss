/**
 * Decision SSE Stream Route
 *
 * Exposes GET /api/decisions/stream as a Server-Sent Events endpoint.
 * Subscribes to Redis Pub/Sub channel `decisions:{organizationId}` and
 * relays `decision:new` and `decision:resolved` events to authenticated
 * clients in real-time.
 *
 * Features:
 * - Session token validation (401 on missing/expired/invalid)
 * - Organization-scoped event delivery
 * - Max 5 concurrent connections per user
 * - Per-org circular event buffer (max 50) for Last-Event-ID replay
 * - Keepalive comments every 30 seconds
 * - Clean disconnect handling (unsubscribe, registry removal)
 */

import { Router, type Request, type Response } from "express";
import { Redis } from "ioredis";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { getRedisOptions } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";

const router = Router();
const logger = createLogger("DecisionSSEStream");

// ---------------------------------------------------------------------------
// Connection Registry — max 5 concurrent SSE connections per user
// ---------------------------------------------------------------------------

interface SSEConnection {
    userId: string;
    organizationId: number;
    connectedAt: Date;
    res: Response;
}

/** Map<userId, SSEConnection[]> */
const connectionRegistry = new Map<string, SSEConnection[]>();

const MAX_CONNECTIONS_PER_USER = 5;

function addConnection(conn: SSEConnection): boolean {
    const existing = connectionRegistry.get(conn.userId) || [];
    if (existing.length >= MAX_CONNECTIONS_PER_USER) {
        return false;
    }
    existing.push(conn);
    connectionRegistry.set(conn.userId, existing);
    return true;
}

function removeConnection(userId: string, res: Response): void {
    const existing = connectionRegistry.get(userId);
    if (!existing) return;
    const filtered = existing.filter((c) => c.res !== res);
    if (filtered.length === 0) {
        connectionRegistry.delete(userId);
    } else {
        connectionRegistry.set(userId, filtered);
    }
}

// ---------------------------------------------------------------------------
// Per-Organization Event Buffer — circular buffer, max 50 entries per org
// ---------------------------------------------------------------------------

interface EventBufferEntry {
    eventId: string;
    type: string;
    payload: string; // serialized JSON
    timestamp: number;
}

const MAX_BUFFER_SIZE = 50;

/** Map<organizationId, EventBufferEntry[]> */
const eventBuffers = new Map<number, EventBufferEntry[]>();

function pushToBuffer(organizationId: number, entry: EventBufferEntry): void {
    let buffer = eventBuffers.get(organizationId);
    if (!buffer) {
        buffer = [];
        eventBuffers.set(organizationId, buffer);
    }
    buffer.push(entry);
    // Circular: trim oldest entries when exceeding max
    if (buffer.length > MAX_BUFFER_SIZE) {
        buffer.shift();
    }
}

function replayFromBuffer(organizationId: number, lastEventId: string): EventBufferEntry[] {
    const buffer = eventBuffers.get(organizationId);
    if (!buffer || buffer.length === 0) return [];

    const idx = buffer.findIndex((e) => e.eventId === lastEventId);
    if (idx === -1) {
        // ID not found in buffer — replay entire buffer (up to 50)
        return buffer.slice();
    }
    // Replay everything after the matched ID
    return buffer.slice(idx + 1);
}

// ---------------------------------------------------------------------------
// SSE Wire Format Helpers
// ---------------------------------------------------------------------------

function writeSSEEvent(res: Response, eventId: string, eventType: string, data: string): void {
    res.write(`id: ${eventId}\nevent: ${eventType}\ndata: ${data}\n\n`);
}

function writeKeepalive(res: Response): void {
    res.write(`: keepalive\n\n`);
}

// ---------------------------------------------------------------------------
// Dedicated Redis Subscriber — one per SSE endpoint instance
// Each connection subscribes to its org channel via a shared subscriber.
// ioredis requires a dedicated connection for subscribe mode.
// ---------------------------------------------------------------------------

let subscriberClient: Redis | null = null;

function getSubscriberClient(): Redis {
    if (!subscriberClient) {
        const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
        subscriberClient = new Redis(url, {
            ...getRedisOptions(),
            connectionName: "oddjob:decision-sse-subscriber",
        });
        subscriberClient.on("error", (err) => {
            logger.error("[DecisionSSE] Redis subscriber error", err);
        });
        subscriberClient.on("ready", () => {
            logger.info("[DecisionSSE] Redis subscriber ready");
        });
    }
    return subscriberClient;
}

// Track org subscriptions to avoid duplicate subscribes
const orgSubscriptionCounts = new Map<number, number>();

// ---------------------------------------------------------------------------
// SSE Route Handler
// ---------------------------------------------------------------------------

router.get("/stream", requireAuth, async (req: Request, res: Response) => {
    // Extract auth context
    const orgContext = await getUserOrgContext(req);
    const { userId, organizationId } = orgContext;

    if (!organizationId) {
        logger.warn(`[DecisionSSE] No organizationId for user ${userId}`);
        return res.status(403).json({ message: "Organization context required" });
    }

    // Enforce max connections per user
    const conn: SSEConnection = {
        userId,
        organizationId,
        connectedAt: new Date(),
        res,
    };

    if (!addConnection(conn)) {
        logger.warn(`[DecisionSSE] Max connections exceeded for user ${userId}`);
        return res.status(429).json({
            message: "Maximum concurrent SSE connections reached (limit: 5)",
        });
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.flushHeaders();

    logger.info(`[DecisionSSE] Client connected: userId=${userId}, orgId=${organizationId}`);

    // Replay missed events. The header covers the browser's own retries; the
    // query parameter covers a reopened stream (a new EventSource, or another
    // tab taking over the shared stream), which cannot set headers. The client
    // always sent the parameter; this route used to read only the header.
    const queryLastEventId = typeof req.query.lastEventId === "string" ? req.query.lastEventId : undefined;
    const lastEventId = (req.headers["last-event-id"] as string | undefined) || queryLastEventId;
    if (lastEventId) {
        const missed = replayFromBuffer(organizationId, lastEventId);
        for (const entry of missed) {
            writeSSEEvent(res, entry.eventId, entry.type, entry.payload);
        }
        logger.info(`[DecisionSSE] Replayed ${missed.length} events for user ${userId} (Last-Event-ID: ${lastEventId})`);
    }

    // Subscribe to Redis Pub/Sub channel for this org
    const channel = `decisions:${organizationId}`;
    const sub = getSubscriberClient();

    const messageHandler = (ch: string, message: string) => {
        if (ch !== channel) return;

        try {
            const parsed = JSON.parse(message);
            const eventType = parsed.type; // 'decision:new' or 'decision:resolved'
            const eventId = parsed.eventId;

            if (!eventType || !eventId) {
                logger.warn(`[DecisionSSE] Malformed event on channel ${channel}`, { message });
                return;
            }

            // Only relay known event types
            if (eventType !== "decision:new" && eventType !== "decision:resolved") {
                return;
            }

            // Store in buffer for replay
            pushToBuffer(organizationId, {
                eventId,
                type: eventType,
                payload: message,
                timestamp: Date.now(),
            });

            // Write to this client
            writeSSEEvent(res, eventId, eventType, message);
        } catch (err) {
            logger.error(`[DecisionSSE] Error processing message on ${channel}`, err);
        }
    };

    // Subscribe to the channel (track ref count to manage subscriptions)
    const currentCount = orgSubscriptionCounts.get(organizationId) || 0;
    if (currentCount === 0) {
        await sub.subscribe(channel);
        logger.info(`[DecisionSSE] Subscribed to Redis channel: ${channel}`);
    }
    orgSubscriptionCounts.set(organizationId, currentCount + 1);

    sub.on("message", messageHandler);

    // Keepalive every 30 seconds
    const keepaliveInterval = setInterval(() => {
        writeKeepalive(res);
    }, 30000);

    // Clean up on client disconnect
    req.on("close", () => {
        logger.info(`[DecisionSSE] Client disconnected: userId=${userId}, orgId=${organizationId}`);

        // Stop keepalive
        clearInterval(keepaliveInterval);

        // Remove message handler
        sub.removeListener("message", messageHandler);

        // Decrement org subscription ref count; unsubscribe if zero
        const count = (orgSubscriptionCounts.get(organizationId) || 1) - 1;
        if (count <= 0) {
            orgSubscriptionCounts.delete(organizationId);
            sub.unsubscribe(channel).catch((err) => {
                logger.error(`[DecisionSSE] Error unsubscribing from ${channel}`, err);
            });
            logger.info(`[DecisionSSE] Unsubscribed from Redis channel: ${channel}`);
        } else {
            orgSubscriptionCounts.set(organizationId, count);
        }

        // Remove from connection registry
        removeConnection(userId, res);

        res.end();
    });
});

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export function registerDecisionStreamRoutes(app: any) {
    app.use("/api/decisions", router);
}

export default router;

// Export internals for testing
export { connectionRegistry, eventBuffers, replayFromBuffer, pushToBuffer, MAX_BUFFER_SIZE };
