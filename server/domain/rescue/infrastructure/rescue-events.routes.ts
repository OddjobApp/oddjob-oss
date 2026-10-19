import { Router, Request, Response } from "express";
import { createLogger } from "@server/utils/logger.js";
import { redisService } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("RescueEventsRoute");

// In-memory set of SSE client responses
const clients = new Set<Response>();

export interface RescueStreamEvent {
    type: "rescue.created" | "rescue.updated" | "squad.deployed" | "squad.telemetry" | "ping";
    timestamp: string;
    data: Record<string, any>;
}

export function broadcastRescueEvent(event: RescueStreamEvent) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
        try {
            client.write(payload);
        } catch (err: any) {
            clients.delete(client);
        }
    }
}

// Setup Redis subscriber for cross-process broadcasting if Redis is connected
try {
    // `subscriber` is a getter on RedisService, not a getSubscriber() method — the
    // call this used to make does not exist, so this whole block threw into the
    // catch below and cross-process rescue events never propagated.
    const subscriber = redisService.subscriber;
    if (subscriber) {
        subscriber.subscribe("rescue:events", (err: Error | null | undefined) => {
            if (err) {
                logger.warn(`Failed to subscribe to rescue:events: ${err.message}`);
            } else {
                logger.info("Subscribed to Redis rescue:events channel.");
            }
        });

        subscriber.on("message", (channel: string, message: string) => {
            if (channel === "rescue:events") {
                try {
                    const parsed = JSON.parse(message);
                    broadcastRescueEvent(parsed);
                } catch (e) {
                    // Ignore parse error
                }
            }
        });
    }
} catch (e: any) {
    logger.warn(`Redis subscriber initialization skipped: ${e.message}`);
}

export const rescueEventsRouter = Router();

rescueEventsRouter.get("/api/rescue/events", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // Flush initial connection event
    res.write(`data: ${JSON.stringify({ type: "ping", timestamp: new Date().toISOString(), data: { connected: true } })}\n\n`);

    clients.add(res);

    const keepAliveTimer = setInterval(() => {
        try {
            res.write(`: keep-alive\n\n`);
        } catch (e) {
            clearInterval(keepAliveTimer);
            clients.delete(res);
        }
    }, 15000);

    req.on("close", () => {
        clearInterval(keepAliveTimer);
        clients.delete(res);
    });
});
