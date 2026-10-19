import { describe, it, expect } from "vitest";
import { detectSpatialRequirement } from "../autonomous/component-lookup.service.js";

/**
 * The detector decides whether an assembly pulls in map components. Its failure
 * mode is not missing a spatial app — that costs one absent component — but
 * firing on ordinary product language, which would drag a map into every
 * roadmap, sitemap and regional-sales app in the catalogue.
 */

describe("detectSpatialRequirement — positives", () => {
    it.each([
        "Build a fleet dispatch dashboard",
        "Track assets by location across zones",
        "Show a map of active incidents",
        "Geofence alerts for the northern corridor",
        "Optimise delivery routes",
        "Plot coordinates on an H3 grid",
    ])("detects %j as spatial", (objective) => {
        expect(detectSpatialRequirement(objective).required).toBe(true);
    });

    it("reports which terms triggered it, so the choice is auditable", () => {
        const result = detectSpatialRequirement("A dispatch console for fleet routes");
        expect(result.required).toBe(true);
        expect(result.matchedTerms.sort()).toEqual(["dispatch", "fleet", "routes"]);
    });
});

describe("detectSpatialRequirement — the false positives it must avoid", () => {
    it.each([
        // "roadmap" and "sitemap" contain "map"
        "Build a product roadmap viewer",
        "Generate a sitemap for the docs site",
        // "regional" contains "region"
        "Dashboard for the regional sales manager",
        // "relocation" contains "location"
        "Employee relocation request form",
    ])("does not treat %j as spatial", (objective) => {
        expect(detectSpatialRequirement(objective).required).toBe(false);
    });

    it("is not fooled by a substring, only by a whole word", () => {
        expect(detectSpatialRequirement("roadmap").required).toBe(false);
        expect(detectSpatialRequirement("road map").required).toBe(true);
    });
});

describe("detectSpatialRequirement — degenerate input", () => {
    it("treats a missing objective as non-spatial rather than throwing", () => {
        expect(detectSpatialRequirement(undefined).required).toBe(false);
        expect(detectSpatialRequirement("").required).toBe(false);
    });

    it("is case-insensitive", () => {
        expect(detectSpatialRequirement("GEOFENCE THE PORT").required).toBe(true);
    });

    it("matches across punctuation", () => {
        expect(detectSpatialRequirement("latitude/longitude ingest").matchedTerms.sort())
            .toEqual(["latitude", "longitude"]);
    });
});
