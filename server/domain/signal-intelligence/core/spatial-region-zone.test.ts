import { describe, it, expect, beforeEach, vi } from "vitest";
import { latLngToCell, cellToParent } from "h3-js";
import { SpatialPredicateEngineService, type RegionStore } from "./spatial-predicate-engine.service.js";
import type { SpatialCondition } from "@shared/contracts/spatial-predicates.js";

/**
 * Rules referencing a stored `spatial_regions` row rather than inlining cells.
 *
 * The behaviour that matters most here is the REFUSAL: spatial_regions stores
 * mixed-resolution cell sets by design, and the engine's zone model is
 * single-resolution. Collapsing a mixed set to one resolution would distort the
 * boundary, and a distorted boundary is not a cosmetic problem — an exclusion
 * rule ("alert me if the asset LEFT the zone") reads a wrong boundary as a
 * departure. Refusing to answer is the safe outcome; answering wrongly is not.
 */

// A real position and the res-7 cell containing it.
const LAT = 33.74;
const LNG = -118.25;
const CELL_R7 = latLngToCell(LAT, LNG, 7);
const CELL_R6 = cellToParent(CELL_R7, 6);
const CELL_R5 = cellToParent(CELL_R7, 5);

function condition(regionId: number): SpatialCondition {
    return {
        type: "spatial",
        mode: "topological",
        predicate: "there",
        geometry: { regionId },
    } as SpatialCondition;
}

function observation() {
    return {
        subjectId: "vessel-1",
        latitude: LAT,
        longitude: LNG,
        h3Index: CELL_R7,
    };
}

/** A RegionStore backed by a plain map, so no database is involved. */
function storeOf(rows: Array<{ id: number; name: string; cells: string[] }>): RegionStore {
    return { load: vi.fn(async (_org: number, ids: number[]) => rows.filter((r) => ids.includes(r.id))) };
}

describe("stored region references", () => {
    let engine: SpatialPredicateEngineService;

    beforeEach(() => {
        engine = new SpatialPredicateEngineService();
    });

    it("resolves a uniform-resolution region into a zone that matches a position inside it", async () => {
        engine.setRegionStore(storeOf([{ id: 7, name: "Harbour", cells: [CELL_R7] }]));
        const conds = [condition(7)];

        await engine.hydrateRegions(1, conds);
        const summary = engine.evaluate(conds, observation() as never);

        expect(summary.passed).toBe(true);
        expect(summary.results[0].explanation).toContain("Harbour");
    });

    it("does not match a position outside the region", async () => {
        const elsewhere = latLngToCell(51.5, -0.12, 7); // London, not Long Beach
        engine.setRegionStore(storeOf([{ id: 8, name: "Harbour", cells: [elsewhere] }]));
        const conds = [condition(8)];

        await engine.hydrateRegions(1, conds);
        const summary = engine.evaluate(conds, observation() as never);

        expect(summary.passed).toBe(false);
    });

    it("refuses a mixed-resolution region rather than distorting its boundary", async () => {
        // Coarse interior + fine boundary — exactly what spatial_regions is for.
        engine.setRegionStore(storeOf([{ id: 9, name: "Mixed Corridor", cells: [CELL_R5, CELL_R6, CELL_R7] }]));
        const conds = [condition(9)];

        await engine.hydrateRegions(1, conds);
        const summary = engine.evaluate(conds, observation() as never);

        // The position IS geometrically inside, so a passing result here would
        // mean the mixed set was silently collapsed.
        expect(summary.passed).toBe(false);
        expect(summary.results[0].explanation).toMatch(/geometry|zone|region/i);
    });

    it("refuses a condition whose region was never hydrated", async () => {
        engine.setRegionStore(storeOf([{ id: 10, name: "Harbour", cells: [CELL_R7] }]));
        const conds = [condition(10)];

        // hydrateRegions deliberately not called.
        const summary = engine.evaluate(conds, observation() as never);

        expect(summary.passed).toBe(false);
    });

    it("refuses a region that belongs to another org", async () => {
        // The store only ever returns rows it was asked for AND owns; a
        // cross-org id simply comes back empty.
        engine.setRegionStore(storeOf([{ id: 11, name: "Other Org Harbour", cells: [CELL_R7] }]));
        const conds = [condition(999)];

        await engine.hydrateRegions(1, conds);
        const summary = engine.evaluate(conds, observation() as never);

        expect(summary.passed).toBe(false);
    });

    it("keeps two regions apart in the zone cache", async () => {
        const elsewhere = latLngToCell(51.5, -0.12, 7);
        engine.setRegionStore(
            storeOf([
                { id: 20, name: "Here", cells: [CELL_R7] },
                { id: 21, name: "Elsewhere", cells: [elsewhere] },
            ]),
        );
        const conds = [condition(20), condition(21)];

        await engine.hydrateRegions(1, conds);

        // Both geometries are `{ regionId }` and differ only by id — if the
        // memo key ignored regionId the second would reuse the first's cells.
        const here = engine.evaluate([conds[0]], observation() as never);
        const elsewhereResult = engine.evaluate([conds[1]], observation() as never);

        expect(here.passed).toBe(true);
        expect(elsewhereResult.passed).toBe(false);
    });

    it("loads each referenced region once per pass", async () => {
        const store = storeOf([{ id: 30, name: "Harbour", cells: [CELL_R7] }]);
        engine.setRegionStore(store);
        const conds = [condition(30)];

        await engine.hydrateRegions(1, conds);
        await engine.hydrateRegions(1, conds); // already cached

        expect(store.load).toHaveBeenCalledTimes(1);
    });

    it("is inert when no region store is attached", async () => {
        const conds = [condition(40)];

        await expect(engine.hydrateRegions(1, conds)).resolves.toBeUndefined();
        expect(engine.evaluate(conds, observation() as never).passed).toBe(false);
    });
});
