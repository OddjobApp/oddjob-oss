
import { db } from "@server/database_service.js";
import { rescueSessions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { rescueService } from "./rescue-service.js";
import { routingService } from "./routing-service.js";

const logger = createLogger("MissionSimulator");

/**
 * Simulator for Phase 3/4 testing.
 * Automatically moves a virtual helper along a path and updates mission state.
 */
export const missionSimulator = {
    async simulateHelper(sessionId: number) {
        return this.simulateFullLifecycle(sessionId);
    },

    async simulateFullLifecycle(sessionId: number) {
        logger.info(`Starting full lifecycle simulation for session ${sessionId}`);

        // 1. Immediate Assignment (REQUESTED -> ACCEPTED)
        await rescueService.assignProvider(sessionId, "mock-responder-77", "Mock Responder Alpha");

        // 2. Initial Telemetry (Far away for contrast)
        const session = await rescueService.getSession(sessionId);
        if (session && session.userLocation) {
            const userLoc = session.userLocation as { lat: number, lng: number };
            const startLoc = {
                lat: userLoc.lat + 0.015,
                lng: userLoc.lng + 0.015
            };

            await rescueService.submitTelemetry(sessionId, {
                entityType: 'provider',
                entityId: 'mock-responder-77',
                lat: startLoc.lat,
                lng: startLoc.lng,
                accuracy: 10,
                clientTimestamp: new Date()
            });

            // 3. Short delay then start movement (ACCEPTED -> ENROUTE)
            await new Promise(r => setTimeout(r, 1000));
            await rescueService.updateStatus(sessionId, "ENROUTE");

            // 4. Simulate movement
            // Try to get a real route first
            const route = await routingService.calculateRoute(startLoc, userLoc);

            if (route && route.points && route.points.length > 5) {
                logger.info(`Session ${sessionId} following road route with ${route.points.length} points.`);
                // Sample 10 points from the route to simulate movement
                const stepSize = Math.max(1, Math.floor(route.points.length / 10));

                for (let i = 0; i < route.points.length; i += stepSize) {
                    const [lng, lat] = route.points[i];

                    await rescueService.submitTelemetry(sessionId, {
                        entityType: 'provider',
                        entityId: 'mock-responder-77',
                        lat,
                        lng,
                        accuracy: 10,
                        clientTimestamp: new Date()
                    });

                    logger.debug(`Session ${sessionId} road telemetry update ${i}/${route.points.length}`);
                    await new Promise(r => setTimeout(r, 1500));
                }
            } else {
                // Fallback to 5-step straight line
                for (let i = 1; i <= 5; i++) {
                    const ratio = i / 5;
                    const currentLoc = {
                        lat: startLoc.lat + (userLoc.lat - startLoc.lat) * ratio,
                        lng: startLoc.lng + (userLoc.lng - startLoc.lng) * ratio
                    };

                    await rescueService.submitTelemetry(sessionId, {
                        entityType: 'provider',
                        entityId: 'mock-responder-77',
                        lat: currentLoc.lat,
                        lng: currentLoc.lng,
                        accuracy: 10,
                        clientTimestamp: new Date()
                    });

                    logger.debug(`Session ${sessionId} straight-line telemetry update ${i}/5`);
                    if (i < 5) await new Promise(r => setTimeout(r, 2000));
                }
            }

            // 4. Arrived (ENROUTE -> ARRIVED)
            await rescueService.updateStatus(sessionId, "ARRIVED");
            await new Promise(r => setTimeout(r, 3000));

            // 5. Assisting (ARRIVED -> ASSISTING)
            const arrivedSession = await rescueService.getSession(sessionId);
            if (!arrivedSession?.arrivalHandshakeHash) {
                throw new Error(`Simulation session ${sessionId} has no arrival verification code`);
            }
            await rescueService.verifyHandshake(sessionId, arrivedSession.arrivalHandshakeHash);
            await new Promise(r => setTimeout(r, 5000));

            // 6. Completed (ASSISTING -> COMPLETED)
            await rescueService.updateStatus(sessionId, "COMPLETED");
            logger.info(`Session ${sessionId} lifecycle simulation complete.`);
        }
    }
};


