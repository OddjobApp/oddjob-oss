
import { db } from "@server/database_service.js";
import { rescueSessions, orgs } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PartnerService");

export const partnerService = {
    /**
     * Get all active rescue missions for a partner organization
     */
    async getPartnerMissions(partnerId: number) {
        try {
            return await db.select()
                .from(rescueSessions)
                .where(eq(rescueSessions.organizationId, partnerId));
        } catch (error) {
            logger.error(`Error fetching partner missions for ${partnerId}:`, error);
            throw error;
        }
    },

    /**
     * Update the operational availability of a partner's fleet
     * In a live environment, this would interface with Redis Geospatial indexing
     */
    async updateFleetAvailability(partnerId: number, active: boolean) {
        logger.info(`Partner ${partnerId} fleet availability set to: ${active}`);

        // This is a hook for real-time proximity matching
        // redis.geoadd('active_responders', partnerLng, partnerLat, partnerId)

        return { success: true, partnerId, active, timestamp: new Date() };
    },

    /**
     * Bulk telemetry ingestion for partner-managed missions
     */
    async processPartnerTelemetry(partnerId: number, sessionId: number, telemetry: { lat: number, lng: number, heading?: number }) {
        logger.info(`Processing telemetry from partner ${partnerId} for session ${sessionId}`);

        // Update the 'Rescue Shadow' (last known provider location)
        await db.update(rescueSessions)
            .set({
                providerLocation: telemetry,
                updatedAt: new Date()
            })
            .where(and(
                eq(rescueSessions.id, sessionId),
                eq(rescueSessions.organizationId, partnerId)
            ));

        return { success: true };
    }
};


