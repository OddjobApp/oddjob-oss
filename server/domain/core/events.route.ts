import { Router, Request, Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { eventStream, EventPayload } from "./infrastructure/event-stream.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("EventsRoute");
const router = Router();

/**
 * GET /api/events/stream
 * Server-Sent Events endpoint for real-time event streaming.
 * Supports filtering by type and source via query parameters.
 */
router.get("/stream", requireAuth, (req: Request, res: Response) => {
    const clientId = req.user?.id || "anonymous";
    const filterType = req.query.type as string | undefined;
    const filterSource = req.query.source as string | undefined;

    logger.info(`[SSE] Client ${clientId} connecting to event stream`);

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.flushHeaders();

    // Send recent events on connect (catch-up)
    const recentEvents = eventStream.getRecent(50, filterType, filterSource);
    if (recentEvents.length > 0) {
        res.write(`event: recent\n`);
        res.write(`data: ${JSON.stringify({ events: recentEvents })}\n\n`);
    }

    // Subscribe to events
    const unsubscribe = eventStream.onEvent(
        (event: EventPayload) => {
            try {
                res.write(`event: ${event.eventType}\n`);
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch (err) {
                logger.error("[SSE] Failed to send event to client:", err);
                cleanup();
            }
        },
        {
            type: filterType,
            source: filterSource,
        }
    );

    // Heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
        try {
            res.write(`:heartbeat\n\n`);
        } catch (err) {
            cleanup();
        }
    }, 30000); // 30 second heartbeat

    // Cleanup on client disconnect
    const cleanup = () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
        logger.info(`[SSE] Client ${clientId} disconnected`);
    };

    req.on("close", cleanup);
    req.on("error", cleanup);

    // Send connection established event
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ 
        clientId, 
        timestamp: Date.now(),
        filter: { type: filterType, source: filterSource }
    })}\n\n`);
});

/**
 * GET /api/events/recent
 * Get recent events from the buffer (for initial page load hydration).
 */
router.get("/recent", requireAuth, (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const type = req.query.type as string | undefined;
    const source = req.query.source as string | undefined;

    const events = eventStream.getRecent(limit, type, source);
    
    res.json({
        events,
        count: events.length,
        timestamp: Date.now(),
    });
});

/**
 * GET /api/events/types
 * Get available event types for filtering.
 */
router.get("/types", requireAuth, async (req: Request, res: Response) => {
    try {
        const types = await eventStream.getEventTypes(req.user?.defaultOrgId);
        res.json({ types });
    } catch (err) {
        logger.error("[Events] Failed to get event types:", err);
        res.status(500).json({ error: "Failed to get event types" });
    }
});

/**
 * POST /api/events/publish
 * Publish a custom event (for testing or manual triggers).
 */
router.post("/publish", requireAuth, async (req: Request, res: Response) => {
    const { eventType, payload, context } = req.body;
    
    if (!eventType) {
        return res.status(400).json({ error: "eventType is required" });
    }

    try {
        const eventId = await eventStream.publish(
            eventType,
            payload || {},
            {
                ...context,
                organizationId: req.user?.defaultOrgId,
                userId: req.user?.id,
            },
            req.user?.username || "user"
        );
        
        res.json({ eventId, eventType, timestamp: Date.now() });
    } catch (err) {
        logger.error("[Events] Failed to publish event:", err);
        res.status(500).json({ error: "Failed to publish event" });
    }
});

export default router;
