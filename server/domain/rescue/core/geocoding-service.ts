import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("GeocodingService");
logger.info("Geocoding service initialized");

export interface GeocodeResult {
    address: string;
    resolvedAddress: string;
    location: {
        lat: number;
        lng: number;
    };
    accuracy: string;
}

export interface ReverseGeocodeResult {
    lat: number;
    lng: number;
    address: string;
    resolvedBy: string;
}

const MOCK_LOCATIONS: Record<string, { lat: number; lng: number }> = {
    "empire state building": { lat: 40.7484, lng: -73.9857 },
    "golden gate bridge": { lat: 37.8199, lng: -122.4783 },
    "acme corp hq": { lat: 34.0522, lng: -118.2437 },
    "los angeles city hall": { lat: 34.0537, lng: -118.2427 },
    "space needle": { lat: 47.6205, lng: -122.3493 },
    "times square": { lat: 40.7580, lng: -73.9855 }
};

export const geocodingService = {
    async geocode(address: string): Promise<GeocodeResult | null> {
        logger.info(`Geocoding address: ${address}`);
        if (!address || !address.trim()) return null;
        const lowerAddr = address.toLowerCase();

        // 1. Check Mocks first (for testing/stability)
        for (const key in MOCK_LOCATIONS) {
            if (lowerAddr.includes(key)) {
                return {
                    address: address,
                    resolvedAddress: key.toUpperCase(),
                    location: MOCK_LOCATIONS[key],
                    accuracy: "high (mock)"
                };
            }
        }

        // 2. Try Mapbox
        const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.VITE_MAPBOX_ACCESS_TOKEN;
        if (mapboxToken) {
            try {
                const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${mapboxToken}&limit=1`;
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Mapbox geocode ${response.status}`);
                const data = await response.json();

                if (data.features?.length > 0) {
                    const feature = data.features[0];
                    return {
                        address,
                        resolvedAddress: feature.place_name,
                        location: {
                            lng: feature.center[0],
                            lat: feature.center[1]
                        },
                        accuracy: feature.properties?.accuracy || "mapbox-v5"
                    };
                }
            } catch (err) {
                logger.error("Mapbox geocoding failed:", err);
            }
        }

        // 3. Try Google Maps
        const googleKey = process.env.GOOGLE_MAPS_API_KEY;
        if (googleKey) {
            try {
                const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleKey}`;
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Google geocode ${response.status}`);
                const data = await response.json();

                if (data.status === "OK" && data.results?.length > 0) {
                    const result = data.results[0];
                    return {
                        address,
                        resolvedAddress: result.formatted_address,
                        location: result.geometry.location,
                        accuracy: result.geometry.location_type
                    };
                }
            } catch (err) {
                logger.error("Google geocoding failed:", err);
            }
        }

        // 4. Try OpenStreetMap Nominatim (Public zero-config fallback)
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&addressdetails=1`;
            const response = await fetch(url, {
                headers: { "User-Agent": "Oddjob-Spatial-Agent/1.0 (contact@oddjob.local)" }
            });
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    const item = data[0];
                    return {
                        address,
                        resolvedAddress: item.display_name,
                        location: {
                            lat: parseFloat(item.lat),
                            lng: parseFloat(item.lon)
                        },
                        accuracy: item.type || "osm-nominatim"
                    };
                }
            }
        } catch (err) {
            logger.warn("OSM Nominatim geocoding failed", { error: err instanceof Error ? err.message : String(err) });
        }

        return null;
    },

    async reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult> {
        logger.info(`Reverse geocoding: ${lat}, ${lng}`);

        // 1. Try Mapbox
        const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.VITE_MAPBOX_ACCESS_TOKEN;
        if (mapboxToken) {
            try {
                const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxToken}&limit=1`;
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Mapbox reverse geocode ${response.status}`);
                const data = await response.json();

                if (data.features?.length > 0) {
                    return {
                        lat,
                        lng,
                        address: data.features[0].place_name,
                        resolvedBy: "Mapbox"
                    };
                }
            } catch (err) {
                logger.error("Mapbox reverse geocoding failed:", err);
            }
        }

        // 2. Try Google Maps
        const googleKey = process.env.GOOGLE_MAPS_API_KEY;
        if (googleKey) {
            try {
                const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleKey}`;
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Google reverse geocode ${response.status}`);
                const data = await response.json();

                if (data.status === "OK" && data.results?.length > 0) {
                    return {
                        lat,
                        lng,
                        address: data.results[0].formatted_address,
                        resolvedBy: "Google Maps"
                    };
                }
            } catch (err) {
                logger.error("Google reverse geocoding failed:", err);
            }
        }

        // 3. Try OpenStreetMap Nominatim (Public zero-config fallback)
        try {
            const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
            const response = await fetch(url, {
                headers: { "User-Agent": "Oddjob-Spatial-Agent/1.0 (contact@oddjob.local)" }
            });
            if (response.ok) {
                const data = await response.json();
                if (data && data.display_name) {
                    return {
                        lat,
                        lng,
                        address: data.display_name,
                        resolvedBy: "OpenStreetMap Nominatim"
                    };
                }
            }
        } catch (err) {
            logger.warn("OSM Nominatim reverse geocoding failed", { error: err instanceof Error ? err.message : String(err) });
        }

        // Fallback to coordinates
        return {
            lat,
            lng,
            address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
            resolvedBy: "Coordinate String (Keys Missing)"
        };
    },

    async suggest(query: string): Promise<string[]> {
        logger.info(`Fetching address suggestions for: ${query}`);
        if (!query || query.length < 3) return [];

        // 1. Check Mapbox
        const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.VITE_MAPBOX_ACCESS_TOKEN;
        if (mapboxToken) {
            try {
                const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxToken}&limit=5&types=address,place,poi`;
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Mapbox suggest ${response.status}`);
                const data = await response.json();

                if (data.features?.length > 0) {
                    return data.features.map((f: any) => f.place_name);
                }
            } catch (err) {
                logger.error("Mapbox autocomplete failed:", err);
            }
        }

        // 2. Try Google Places
        const googleKey = process.env.GOOGLE_MAPS_API_KEY;
        if (googleKey) {
            try {
                const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${googleKey}`;
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Google Places suggest ${response.status}`);
                const data = await response.json();

                if (data.status === "OK" && data.predictions?.length > 0) {
                    return data.predictions.map((p: any) => p.description);
                }
            } catch (err) {
                logger.error("Google Places autocomplete failed:", err);
            }
        }

        // 3. Try OpenStreetMap Nominatim suggestions
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
            const response = await fetch(url, {
                headers: { "User-Agent": "Oddjob-Spatial-Agent/1.0 (contact@oddjob.local)" }
            });
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    return data.map((item: any) => item.display_name);
                }
            }
        } catch (err) {
            logger.warn("OSM Nominatim suggest failed", { error: err instanceof Error ? err.message : String(err) });
        }

        // 4. Fallback to Mock predictions if nothing else (for testing/stability)
        return Object.keys(MOCK_LOCATIONS)
            .filter(key => key.includes(query.toLowerCase()))
            .map(key => key.charAt(0).toUpperCase() + key.slice(1));
    }
};
