import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";
import { routingService } from "./routing-service.js";

// Lazy getter — avoids connecting to Redis at module evaluation time
const getRedis = () => getRedisClient();

const logger = createLogger("RescueGeoService");

const HELPER_LOCATIONS_KEY = "rescue:helper_locations";

export const rescueGeoService = {
    /**
     * Update a helper's location in the geospatial index.
     * @param helperId The ID of the helper (e.g., from the Helper Dataset)
     * @param lat Latitude
     * @param lng Longitude
     */
    async updateHelperLocation(helperId: string, lat: number, lng: number): Promise<void> {
        try {
            // Redis expects longitude first for GEOADD
            await getRedis().geoadd(HELPER_LOCATIONS_KEY, lng, lat, helperId);
            logger.debug(`Updated location for helper ${helperId}: ${lat}, ${lng}`);
        } catch (error) {
            logger.error(`Failed to update helper location for ${helperId}:`, error);
            throw error;
        }
    },

    /**
     * Find helpers within a certain radius of a location.
     * @param lat Latitude of the center point
     * @param lng Longitude of the center point
     * @param radiusKm Radius in kilometers
     * @param limit Max number of results to return
     * @returns Array of helper IDs
     */
    async findNearbyHelpers(lat: number, lng: number, radiusKm: number = 20, limit: number = 10): Promise<string[]> {
        try {
            // GEOSEARCH replaces the deprecated GEORADIUS command (Redis 6.2+)
            const results = await (getRedis() as any).geosearch(
                HELPER_LOCATIONS_KEY,
                'FROMLONLAT', lng, lat,
                'BYRADIUS', radiusKm, 'km',
                'ASC',
                'COUNT', limit
            );
            return (results ?? []) as string[];
        } catch (error) {
            logger.error(`Failed to find nearby helpers around ${lat}, ${lng}:`, error);
            return [];
        }
    },

    /**
     * Get the current location of a helper.
     * @param helperId The ID of the helper
     * @returns Object with lat and lng, or null if not found
     */
    async getHelperLocation(helperId: string): Promise<{ lat: number, lng: number } | null> {
        try {
            const pos = await getRedis().geopos(HELPER_LOCATIONS_KEY, helperId);
            if (!pos || !pos[0] || pos[0].length < 2) return null;

            return {
                lng: parseFloat(pos[0][0] as string),
                lat: parseFloat(pos[0][1] as string)
            };
        } catch (error) {
            logger.error(`Failed to get location for helper ${helperId}:`, error);
            return null;
        }
    },

    /**
     * Remove a helper from the geospatial index (e.g., when they go offline).
     * @param helperId The ID of the helper
     */
    async removeHelper(helperId: string): Promise<void> {
        try {
            await getRedis().zrem(HELPER_LOCATIONS_KEY, helperId);
            logger.info(`Removed helper ${helperId} from tracking.`);
        } catch (error) {
            logger.error(`Failed to remove helper ${helperId} from tracking:`, error);
        }
    },

    /**
     * Calculate ETA based on straight-line distance.
     * Hardening: Uses Haversine formula and average speed models.
     */
    calculateETA(start: { lat: number, lng: number }, end: { lat: number, lng: number }): number {
        const R = 6371; // Earth radius in km
        const dLat = (end.lat - start.lat) * Math.PI / 180;
        const dLng = (end.lng - start.lng) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(start.lat * Math.PI / 180) * Math.cos(end.lat * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceKm = R * c;

        const avgSpeedKph = 40;
        const trafficMultiplier = 1.3;

        const timeHours = (distanceKm * trafficMultiplier) / avgSpeedKph;
        return Math.max(1, Math.round(timeHours * 60)); // Return minutes, at least 1 min
    },

    /**
     * Calculate route-aware ETA.
     * Hardening: Uses external routing engine with fallback to Haversine.
     */
    async calculateRouteETA(start: { lat: number, lng: number }, end: { lat: number, lng: number }): Promise<number> {
        const route = await routingService.calculateRoute(start, end);
        if (route) {
            return route.durationMin;
        }
        // Fallback to geometric if routing fails or isn't available
        return this.calculateETA(start, end);
    },

    // ─── SIMULATION / DEMO HELPERS ──────────────────────────────────────────

    /**
     * Seed fake providers around a center point for demo/simulation purposes.
     * Creates N providers at random offsets within the specified radius.
     * Returns the seeded provider IDs for cleanup later.
     */
    async seedDemoProviders(params: {
        centerLat: number;
        centerLng: number;
        count?: number;
        radiusKm?: number;
        prefix?: string;
    }): Promise<string[]> {
        const {
            centerLat,
            centerLng,
            count = 8,
            radiusKm = 10,
            prefix = "demo-provider",
        } = params;

        const providerIds: string[] = [];
        const names = [
            "Alpha Response", "Bravo Unit", "Charlie Team", "Delta Fleet",
            "Echo Rapid", "Foxtrot Aid", "Golf Express", "Hotel Mobile",
            "India Quick", "Juliet Star"
        ];

        for (let i = 0; i < count; i++) {
            // Random angle and distance within radius
            const angle = Math.random() * 2 * Math.PI;
            const distance = Math.random() * radiusKm;

            // Convert distance to lat/lng offset (approximate)
            const latOffset = (distance / 111.32) * Math.cos(angle);
            const lngOffset = (distance / (111.32 * Math.cos(centerLat * Math.PI / 180))) * Math.sin(angle);

            const lat = centerLat + latOffset;
            const lng = centerLng + lngOffset;
            const id = `${prefix}-${i + 1}-${Date.now().toString(36)}`;

            await this.updateHelperLocation(id, lat, lng);
            providerIds.push(id);

            logger.debug(`Seeded demo provider "${names[i % names.length]}" at (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
        }

        // Store the seeded IDs in Redis for later cleanup (30-minute TTL)
        const cleanupKey = `demo:seeded_providers:${Date.now()}`;
        try {
            await getRedis().set(cleanupKey, JSON.stringify(providerIds), "EX", 1800);
        } catch { /* non-critical */ }

        logger.info(`Seeded ${providerIds.length} demo providers within ${radiusKm}km of (${centerLat}, ${centerLng})`);
        return providerIds;
    },

    /**
     * Remove seeded demo providers from the geospatial index.
     */
    async cleanupDemoProviders(providerIds: string[]): Promise<void> {
        for (const id of providerIds) {
            await this.removeHelper(id);
        }
        logger.info(`Cleaned up ${providerIds.length} demo providers`);
    },

    /**
     * Seed providers and run a full dispatch simulation.
     * This is the one-call "show me the whole thing" demo flow:
     * 1. Seeds fake providers near user location
     * 2. Creates a rescue session (triggers auto-assignment to nearest provider)
     * 3. The existing missionSimulator handles movement + lifecycle
     * 4. Cleans up demo providers after completion
     */
    async runFullDemoSimulation(params: {
        orgId: number;
        userLat: number;
        userLng: number;
        serviceType?: string;
    }): Promise<{ sessionId: number; providersSeeded: string[] }> {
        const { orgId, userLat, userLng, serviceType = "roadside-assistance" } = params;

        // 1. Seed providers around user
        const providerIds = await this.seedDemoProviders({
            centerLat: userLat,
            centerLng: userLng,
            count: 5,
            radiusKm: 8,
        });

        // 2. Initiate rescue (auto-assignment will kick in since isDemoMode=false
        //    but we want the full simulator too, so we pass isDemoMode=true)
        const { rescueService: svc } = await import("./rescue-service.js");
        const session = await svc.initiateRescue({
            orgId,
            serviceType,
            userLocation: { lat: userLat, lng: userLng, resolvedBy: "gps" },
            isDemoMode: true, // triggers missionSimulator after assignment
        });

        logger.info(`Full demo simulation started: session=${session.id}, providers=${providerIds.length}`);

        // 3. Schedule cleanup after 5 minutes (simulation + buffer)
        setTimeout(async () => {
            try {
                await this.cleanupDemoProviders(providerIds);
            } catch (err: any) {
                logger.warn(`Demo cleanup failed: ${err.message}`);
            }
        }, 5 * 60 * 1000);

        return { sessionId: session.id, providersSeeded: providerIds };
    }
};


