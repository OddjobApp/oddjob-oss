import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("RoutingService");

export type RoutingProfile = "driving" | "walking" | "cycling" | "driving-traffic";

export interface RouteWaypoint {
    lat: number;
    lng: number;
}

export interface RouteResult {
    distanceKm: number;
    durationMin: number;
    points?: Array<[number, number]>; // [lng, lat]
}

/** Mapbox Directions caps a single request at 25 coordinates total. */
const MAX_WAYPOINTS = 25;

async function fetchRoute(waypoints: RouteWaypoint[], profile: RoutingProfile): Promise<RouteResult | null> {
    const coords = waypoints.map((w) => `${w.lng},${w.lat}`).join(";");
    const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.VITE_MAPBOX_ACCESS_TOKEN;

    if (mapboxToken) {
        try {
            const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?access_token=${mapboxToken}&overview=full&geometries=geojson`;
            const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!response.ok) throw new Error(`Mapbox directions ${response.status}`);
            const data = await response.json();

            if (data.routes && data.routes.length > 0) {
                const route = data.routes[0];
                return {
                    distanceKm: route.distance / 1000,
                    durationMin: Math.ceil(route.duration / 60),
                    points: route.geometry.coordinates
                };
            }
        } catch (err) {
            logger.error("Mapbox routing failed:", err);
        }
    }

    // Fallback to OSRM Public API. The demo server only hosts
    // driving/walking/cycling profiles, so driving-traffic degrades to driving.
    const osrmProfile = profile === "walking" || profile === "cycling" ? profile : "driving";
    try {
        const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${coords}?overview=full&geometries=geojson`;
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`OSRM ${response.status}`);
        const data = await response.json();

        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            return {
                distanceKm: route.distance / 1000,
                durationMin: Math.ceil(route.duration / 60),
                points: route.geometry?.coordinates
            };
        }
    } catch (err) {
        logger.error("OSRM routing failed:", err);
    }

    return null;
}

export const routingService = {
    /**
     * Calculate route between two points.
     * Tries Mapbox Directions API, falls back to OSRM.
     */
    async calculateRoute(start: RouteWaypoint, end: RouteWaypoint, profile: RoutingProfile = "driving"): Promise<RouteResult | null> {
        return fetchRoute([start, end], profile);
    },

    /**
     * Calculate a route through an ordered list of waypoints (first is the
     * start, last is the destination). Waypoints beyond the provider limit
     * are dropped. Returns null when no routing provider produced a route.
     */
    async calculateWaypointRoute(waypoints: RouteWaypoint[], profile: RoutingProfile = "driving"): Promise<RouteResult | null> {
        const stops = waypoints
            .filter((w) => w && typeof w.lat === "number" && typeof w.lng === "number" && !isNaN(w.lat) && !isNaN(w.lng))
            .slice(0, MAX_WAYPOINTS);
        if (stops.length < 2) return null;
        return fetchRoute(stops, profile);
    }
};
