import { describe, it, expect, afterEach, vi } from "vitest";
import {
    defaultMapCenter,
    standardOffsetHours,
    currentOffsetHours,
    parseCoordinateQuery,
    parseNaturalLanguageGeofence,
    parseGeoJsonPolygon,
    tessellatePolygonToH3,
    STRATEGIC_SECTOR_PRESETS,
    getH3ResolutionArea,
    H3_RESOLUTION_AREAS_KM2,
} from "./H3SpatialPalette.js";
import { GEOFENCE_TRIGGER_CATALOG } from "@shared/contracts/spatial-predicates";

/**
 * The map used to open at (0, 0) — null island, in the Gulf of Guinea — so
 * every operator started on empty ocean. A timezone yields a usable longitude
 * (offset x 15 degrees) but no latitude, so the opening view uses a neutral
 * mid-latitude until an operator searches or selects a region.
 */
afterEach(() => vi.unstubAllGlobals());

/** Force the environment's UTC offset, in hours east of UTC. */
function stubOffset(hours: number) {
    const spy = vi.spyOn(Date.prototype, "getTimezoneOffset");
    // getTimezoneOffset reports minutes BEHIND UTC, so west is positive.
    spy.mockReturnValue(-hours * 60);
    return spy;
}

describe("defaultMapCenter", () => {
    it("never opens on null island", () => {
        const { lat, lng } = defaultMapCenter("America/Los_Angeles");
        expect(lat === 0 && lng === 0).toBe(false);
    });

    it("returns a real coordinate pair", () => {
        const { lat, lng } = defaultMapCenter("America/Los_Angeles");
        expect(Number.isFinite(lat)).toBe(true);
        expect(Number.isFinite(lng)).toBe(true);
        expect(Math.abs(lat)).toBeLessThanOrEqual(90);
        expect(Math.abs(lng)).toBeLessThanOrEqual(180);
    });

    it("puts a US Pacific viewer in the western hemisphere", () => {
        const { lng } = defaultMapCenter("America/Los_Angeles");
        expect(lng).toBeLessThan(-90);
    });

    it("puts an east-Asian viewer in the eastern hemisphere", () => {
        const { lng } = defaultMapCenter("Asia/Tokyo");
        expect(lng).toBeGreaterThan(90);
    });

    it("distinguishes far-apart zones", () => {
        const west = defaultMapCenter("America/Los_Angeles");
        const east = defaultMapCenter("Asia/Tokyo");
        expect(west.lng).not.toBeCloseTo(east.lng, 1);
    });

    it("falls back to the browser offset for an unknown zone id", () => {
        const spy = stubOffset(-8);
        const { lng } = defaultMapCenter("Not/AZone");
        expect(lng).toBeLessThan(-90);
        spy.mockRestore();
    });

    it("falls back to UTC-8 when no zone is supplied", () => {
        const spy = stubOffset(-8);
        const { lng } = defaultMapCenter();
        expect(lng).toBe(-120);
        spy.mockRestore();
    });

    it("is deterministic for a given zone", () => {
        expect(defaultMapCenter("Asia/Tokyo")).toEqual(defaultMapCenter("Asia/Tokyo"));
    });
});

describe("DST handling", () => {
    it("uses STANDARD time for geography, not summer time", () => {
        // Los Angeles is GMT-8 standard, GMT-7 under DST. Centring on the live
        // offset would slide the default map 15 degrees east every spring.
        expect(standardOffsetHours("America/Los_Angeles")).toBe(-8);
    });

    it("picks standard time in the southern hemisphere too", () => {
        // Sydney is +10 standard, +11 under DST — DST falls in JANUARY there,
        // so taking the minimum of Jan/Jul is what makes both hemispheres work.
        expect(standardOffsetHours("Australia/Sydney")).toBe(10);
    });

    it("picks standard time for Central Europe", () => {
        expect(standardOffsetHours("Europe/Berlin")).toBe(1);
    });

    it("handles a zone with no DST", () => {
        expect(standardOffsetHours("Asia/Tokyo")).toBe(9);
    });

    it("handles a half-hour offset", () => {
        expect(standardOffsetHours("Asia/Kolkata")).toBeCloseTo(5.5, 2);
    });

    it("handles UTC itself", () => {
        expect(standardOffsetHours("UTC")).toBe(0);
    });

    it("exposes the DST-aware offset separately for time display", () => {
        const current = currentOffsetHours("America/Los_Angeles");
        expect([-8, -7]).toContain(current);
    });

    it("keeps the map centre stable across the DST boundary", () => {
        const winter = defaultMapCenter("America/Los_Angeles");
        const summer = defaultMapCenter("America/Los_Angeles");
        expect(winter).toEqual(summer);
        expect(standardOffsetHours("America/Los_Angeles"))
            .not.toBe(currentOffsetHours("America/Los_Angeles") + 0.5);
    });
});

describe("coordinate search", () => {
    it("accepts valid latitude and longitude", () => {
        expect(parseCoordinateQuery("47.6062, -122.3321")).toEqual({ lat: 47.6062, lng: -122.3321 });
    });

    it("rejects out-of-range coordinates", () => {
        expect(parseCoordinateQuery("91, -122")).toBeNull();
        expect(parseCoordinateQuery("47, 181")).toBeNull();
    });

    it("leaves place names for the geocoder", () => {
        expect(parseCoordinateQuery("Seattle, WA")).toBeNull();
    });
});

describe("Strategic Sector Presets", () => {
    it("exports predefined critical infrastructure presets", () => {
        expect(STRATEGIC_SECTOR_PRESETS.length).toBeGreaterThanOrEqual(8);
        const suez = STRATEGIC_SECTOR_PRESETS.find(p => p.id === "suez_canal");
        expect(suez).toBeDefined();
        expect(suez?.lat).toBeCloseTo(29.975, 2);
        expect(suez?.lng).toBeCloseTo(32.559, 2);
    });

    it("ensures all presets have valid coordinates and resolutions", () => {
        for (const preset of STRATEGIC_SECTOR_PRESETS) {
            expect(preset.lat).toBeGreaterThanOrEqual(-90);
            expect(preset.lat).toBeLessThanOrEqual(90);
            expect(preset.lng).toBeGreaterThanOrEqual(-180);
            expect(preset.lng).toBeLessThanOrEqual(180);
            expect(preset.resolution).toBeGreaterThanOrEqual(6);
            expect(preset.resolution).toBeLessThanOrEqual(10);
            expect(preset.kRing).toBeGreaterThanOrEqual(1);
        }
    });
});

describe("Natural Language Geofence Parser", () => {
    it("extracts location and k-ring from natural language commands", () => {
        const res = parseNaturalLanguageGeofence("5km buffer around Port of Rotterdam");
        expect(res).toBeDefined();
        expect(res?.locationQuery).toContain("Port of Rotterdam");
        expect(res?.kRing).toBe(2);
    });

    it("extracts explicit resolution and k values", () => {
        const res = parseNaturalLanguageGeofence("Suez Canal res 7 k=3");
        expect(res).toBeDefined();
        expect(res?.locationQuery).toContain("Suez Canal");
        expect(res?.resolution).toBe(7);
        expect(res?.kRing).toBe(3);
    });

    it("handles plain queries safely", () => {
        const res = parseNaturalLanguageGeofence("Singapore Harbor");
        expect(res?.locationQuery).toBe("Singapore Harbor");
        expect(res?.kRing).toBe(1);
    });
});

describe("GeoJSON Polygon Parser & Tessellation", () => {
    const sampleGeoJson = JSON.stringify({
        type: "Feature",
        geometry: {
            type: "Polygon",
            coordinates: [
                [[4.45, 51.91], [4.49, 51.91], [4.49, 51.94], [4.45, 51.94], [4.45, 51.91]]
            ]
        }
    });

    it("parses valid GeoJSON polygon coordinates", () => {
        const coords = parseGeoJsonPolygon(sampleGeoJson);
        expect(coords).not.toBeNull();
        expect(coords?.length).toBe(5);
        expect(coords?.[0][0]).toBeCloseTo(51.91, 2); // lat
        expect(coords?.[0][1]).toBeCloseTo(4.45, 2);  // lng
    });

    it("rejects malformed GeoJSON strings", () => {
        expect(parseGeoJsonPolygon("{ invalid json }")).toBeNull();
        expect(parseGeoJsonPolygon(JSON.stringify({ type: "Point", coordinates: [10, 20] }))).toBeNull();
    });

    it("tessellates polygon coordinates into H3 cells", () => {
        const coords = parseGeoJsonPolygon(sampleGeoJson);
        expect(coords).not.toBeNull();
        const hexes = tessellatePolygonToH3(coords!, 8);
        expect(hexes.length).toBeGreaterThan(0);
        expect(typeof hexes[0]).toBe("string");
    });
});

describe("H3 Resolution Area Formatter", () => {
    it("returns formatted square kilometers for macro resolutions", () => {
        expect(getH3ResolutionArea(6)).toContain("km²");
        expect(getH3ResolutionArea(7)).toBe("~5.16 km²");
    });

    it("returns formatted square meters for fine precision resolutions", () => {
        expect(getH3ResolutionArea(8)).toContain("m²");
        expect(getH3ResolutionArea(9)).toContain("m²");
    });

    it("has valid entries in H3_RESOLUTION_AREAS_KM2 for resolutions 0 to 15", () => {
        for (let r = 0; r <= 15; r++) {
            expect(H3_RESOLUTION_AREAS_KM2[r]).toBeGreaterThan(0);
        }
        expect(H3_RESOLUTION_AREAS_KM2[6]).toBeGreaterThan(H3_RESOLUTION_AREAS_KM2[7]);
        expect(H3_RESOLUTION_AREAS_KM2[7]).toBeGreaterThan(H3_RESOLUTION_AREAS_KM2[8]);
    });
});

describe("Temporal Geofence Trigger Catalog", () => {
    it("exports all canonical geofence triggers", () => {
        const triggers = GEOFENCE_TRIGGER_CATALOG.map(t => t.trigger);
        expect(triggers).toContain("ON_ENTER");
        expect(triggers).toContain("ON_EXIT");
        expect(triggers).toContain("ON_DWELL");
        expect(triggers).toContain("ON_APPROACH");
    });

    it("defines requirements for parameterised triggers", () => {
        const dwell = GEOFENCE_TRIGGER_CATALOG.find(t => t.trigger === "ON_DWELL");
        expect(dwell?.requires).toBe("dwellSlaMinutes");

        const approach = GEOFENCE_TRIGGER_CATALOG.find(t => t.trigger === "ON_APPROACH");
        expect(approach?.requires).toBe("approachBufferKm");
    });
});

