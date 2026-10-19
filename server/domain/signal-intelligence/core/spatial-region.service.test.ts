import { describe, it, expect } from "vitest";
import { latLngToCell, cellToParent } from "h3-js";
import { SpatialRegionService, type MeasuredPosition } from "./spatial-region.service.js";
import type { SpatialRegion } from "@shared/schema/spatial-regions.js";

/**
 * These exercise `locateAmong`, the pure half of the service, so they run without
 * a database. What they are really pinning is the property the whole spatial
 * stack rests on: a region the measurement cannot resolve must never come back
 * as "not inside".
 */

const SF = { lat: 37.7749, lng: -122.4194 };
const LONDON = { lat: 51.5074, lng: -0.1278 };

const service = new SpatialRegionService();

let nextId = 1;
function region(name: string, cells: string[]): SpatialRegion {
    return {
        id: nextId++,
        organizationId: 1,
        name,
        description: null,
        kind: "region",
        cells,
        minResolution: null,
        maxResolution: null,
        parentRegionId: null,
        metadata: {},
        createdBy: "test",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
    } as SpatialRegion;
}

/** A coarse area around SF: one res-5 cell, ~10km across. */
const sfCoarse = region("SF Coarse", [cellToParent(latLngToCell(SF.lat, SF.lng, 15), 5)]);
/** A fine area around SF: one res-11 cell, a few tens of metres across. */
const sfFine = region("SF Fine", [cellToParent(latLngToCell(SF.lat, SF.lng, 15), 11)]);
/** Somewhere else entirely. */
const londonCoarse = region("London Coarse", [cellToParent(latLngToCell(LONDON.lat, LONDON.lng, 15), 5)]);

const at = (p: { lat: number; lng: number }, precisionMetres: number | null): MeasuredPosition => ({
    lat: p.lat,
    lng: p.lng,
    precisionMetres,
});

describe("locateAmong — definitive results", () => {
    it("places a precise fix inside the region that contains it", () => {
        const result = service.locateAmong([sfCoarse, londonCoarse], at(SF, 5));

        expect(result.inside.map(r => r.name)).toEqual(["SF Coarse"]);
        expect(result.indeterminate).toEqual([]);
    });

    it("omits regions the fix is definitively outside of, rather than listing them", () => {
        const result = service.locateAmong([sfCoarse, londonCoarse], at(SF, 5));

        // London appears in neither list: definitively outside is silence.
        const named = [...result.inside, ...result.indeterminate].map(r => r.name);
        expect(named).not.toContain("London Coarse");
    });
});

describe("locateAmong — the indeterminate cases that matter", () => {
    it("reports a region as indeterminate when the fix is too coarse to resolve its boundary", () => {
        // A ±5km fix cannot say which side of a ~50m boundary cell it falls on.
        const result = service.locateAmong([sfFine], at(SF, 5_000));

        expect(result.inside).toEqual([]);
        expect(result.indeterminate.map(r => r.name)).toEqual(["SF Fine"]);
    });

    it("treats an unplaceable fix as indeterminate against EVERY region, not outside them", () => {
        const result = service.locateAmong([sfCoarse, sfFine, londonCoarse], at(SF, null));

        expect(result.placedAtResolution).toBeNull();
        expect(result.inside).toEqual([]);
        expect(result.indeterminate).toHaveLength(3);
    });

    it("does not let a country-centroid fix read as outside a small zone", () => {
        // The exact false-departure shape: ±500km 'position' against a fine zone.
        const result = service.locateAmong([sfFine], at(SF, 500_000));

        expect(result.inside).toEqual([]);
        // Crucially NOT an empty result — an empty result reads as "checked, not there".
        expect(result.indeterminate.map(r => r.name)).toEqual(["SF Fine"]);
    });

    it("still resolves a coarse interior definitively for a coarse fix", () => {
        // `inside` beats `indeterminate`: wholly within a coarse cell is inside,
        // whatever the precision, because the geometry says so.
        const result = service.locateAmong([sfCoarse], at(SF, 50));

        expect(result.inside.map(r => r.name)).toEqual(["SF Coarse"]);
    });
});

describe("locateAmong — result shape", () => {
    it("never returns an outside list, so absence cannot be mistaken for evidence", () => {
        const result = service.locateAmong([sfCoarse, londonCoarse], at(SF, 5));
        expect(result).not.toHaveProperty("outside");
    });

    it("reports the resolution the fix actually supports", () => {
        const precise = service.locateAmong([sfCoarse], at(SF, 5));
        const vague = service.locateAmong([sfCoarse], at(SF, 20_000));

        expect(precise.placedAtResolution).not.toBeNull();
        expect(vague.placedAtResolution).not.toBeNull();
        // A worse fix is never placed more finely than a better one.
        expect(vague.placedAtResolution!).toBeLessThan(precise.placedAtResolution!);
    });

    it("handles a region with an empty cell set without claiming containment", () => {
        const empty = region("Empty", []);
        const result = service.locateAmong([empty], at(SF, 5));

        expect(result.inside).toEqual([]);
        expect(result.indeterminate).toEqual([]);
    });
});
