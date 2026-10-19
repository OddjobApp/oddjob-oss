import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";
import { db } from "@server/database_service.js";
import { rescueTelemetry, rescueSessions } from "@shared/schema/rescue.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { missionRunService } from "../../mission/core/mission-run.service.js";
import { rescueGeoService } from "./geo-service.js";
import { hostname } from "os";

// Lazy getter — avoids connecting to Redis at module evaluation time
function getRedis() { return getRedisClient(); }

const logger = createLogger("TelemetryProcessor");

const STREAM_KEY = 'rescue:telemetry:stream';
const GROUP_NAME = 'rescue:telemetry:group';
const CONSUMER_NAME = `consumer-${hostname()}-${process.pid}`;

/**
 * Telemetry Processor
 * 
 * Consumes high-frequency GPS updates from Redis Streams and batches them for PostgreSQL.
 * Throttles mission blackboard updates to avoid database thrashing.
 */
export class TelemetryProcessor {
    private isRunning = false;
    private lastBlackboardUpdate: Record<number, number> = {}; // sessionId -> last update timestamp

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        logger.info("Starting Telemetry Processor...");

        // Ensure consumer group exists
        try {
            await getRedis().xgroup('CREATE', STREAM_KEY, GROUP_NAME, '$', 'MKSTREAM');
        } catch (err: any) {
            if (!err.message.includes('BUSYGROUP')) {
                logger.error(`Failed to create consumer group: ${err.message}`);
            }
        }

        this.processLoop().catch(err => {
            logger.error(`Telemetry processLoop crashed: ${err.message}`);
            this.isRunning = false;
        });
    }

    private async processLoop() {
        while (this.isRunning) {
            try {
                // Read from stream
                const results: any = await getRedis().xreadgroup(
                    'GROUP', GROUP_NAME, CONSUMER_NAME,
                    'COUNT', '50', // Batch size
                    'BLOCK', '2000', // Wait up to 2s
                    'STREAMS', STREAM_KEY, '>'
                );

                if (!results || results.length === 0) continue;

                const [stream, messages] = results[0] as [string, any[]];
                if (messages.length === 0) continue;

                await this.handleBatch(messages);

                // Acknowledge processed messages
                const ids = messages.map((m: any) => m[0]);
                await getRedis().xack(STREAM_KEY, GROUP_NAME, ...ids);

            } catch (err: any) {
                logger.error(`Telemetry processing loop error: ${err.message}`);
                // Backoff on error
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    private async handleBatch(messages: any[]) {
        const telemetryEntries: any[] = [];
        const sessionUpdates: Map<number, { lat: number, lng: number, entityId: string }> = new Map();

        for (const [id, fields] of messages) {
            const data: any = {};
            for (let i = 0; i < fields.length; i += 2) {
                data[fields[i]] = fields[i + 1];
            }

            const sessionId = parseInt(data.sessionId);
            const lat = parseFloat(data.lat);
            const lng = parseFloat(data.lng);

            telemetryEntries.push({
                sessionId,
                entityType: data.entityType,
                entityId: data.entityId,
                lat,
                lng,
                accuracy: data.accuracy || null,
                heading: data.heading || null,
                speed: data.speed || null,
                clientTimestamp: new Date(data.clientTimestamp),
                serverTimestamp: new Date()
            });

            if (data.entityType === 'provider') {
                sessionUpdates.set(sessionId, { lat, lng, entityId: data.entityId });
            }
        }

        // 1. Batch insert telemetry
        if (telemetryEntries.length > 0) {
            try {
                await db.insert(rescueTelemetry).values(telemetryEntries);
            } catch (err) {
                logger.error(`Failed to batch insert telemetry: ${err}`);
            }
        }

        // 2. Batch update sessions
        for (const [sessionId, loc] of sessionUpdates.entries()) {
            try {
                await db.update(rescueSessions)
                    .set({
                        providerLocation: { lat: loc.lat, lng: loc.lng },
                        updatedAt: new Date()
                    })
                    .where(eq(rescueSessions.id, sessionId));

                // 2.5 Update Geospatial Index for discovery
                await rescueGeoService.updateHelperLocation(loc.entityId, loc.lat, loc.lng);

                // 3. Throttle Blackboard updates (max once per 30 seconds per session for background updates)
                const now = Date.now();
                const lastUpdate = this.lastBlackboardUpdate[sessionId] || 0;
                if (now - lastUpdate > 30000) {
                    const [session] = await db.select().from(rescueSessions).where(eq(rescueSessions.id, sessionId));
                    if (session && session.missionRunId && session.missionId) {
                        await missionRunService.checkpoint({
                            missionRunId: session.missionRunId,
                            missionId: session.missionId,
                            missionContext: {
                                helper_loc: { lat: loc.lat, lng: loc.lng }
                            },
                            reason: "Telemetry update (buffered)",
                            changedBy: "system"
                        });
                    }
                    this.lastBlackboardUpdate[sessionId] = now;
                }
            } catch (err) {
                logger.error(`Failed to update session ${sessionId} location: ${err}`);
            }
        }
    }

    stop() {
        this.isRunning = false;
    }
}

export const telemetryProcessor = new TelemetryProcessor();


