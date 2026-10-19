import { describe, it, expect } from "vitest";
import { latLngToCell, cellToParent, isValidCell, getResolution } from "h3-js";
import { H3HexagonalSpatialEngineService } from "../../server/domain/ai/core/h3-hexagonal-spatial-engine.service.js";

// Downtown Los Angeles — a normal (non-pentagon) cell.
const LA_LAT = 34.0522;
const LA_LNG = -118.2437;

describe("Eulerian Hexagonal (Uber H3) Spatial Engine Suite", () => {
    it("produces genuine H3 indices that agree with the reference library", () => {
        const h3Cell = H3HexagonalSpatialEngineService.latLngToH3Index(LA_LAT, LA_LNG, 8);
        const parentH3 = H3HexagonalSpatialEngineService.h3ToParent(h3Cell, 5);

        // The index must be a real H3 cell, not a plausible-looking string.
        expect(isValidCell(h3Cell.h3Index)).toBe(true);
        expect(isValidCell(parentH3)).toBe(true);
        expect(h3Cell.h3Index).toBe(latLngToCell(LA_LAT, LA_LNG, 8));
        expect(parentH3).toBe(cellToParent(h3Cell.h3Index, 5));

        expect(getResolution(h3Cell.h3Index)).toBe(8);
        expect(getResolution(parentH3)).toBe(5);
    });

    it("reports the cell centroid rather than echoing the input coordinate", () => {
        const h3Cell = H3HexagonalSpatialEngineService.latLngToH3Index(LA_LAT, LA_LNG, 8);

        // Every point in a cell shares one centroid — that is what makes the
        // index usable as a grouping key. It is near the input but not equal to it.
        expect(h3Cell.centerLat).not.toBe(LA_LAT);
        expect(Math.abs(h3Cell.centerLat - LA_LAT)).toBeLessThan(0.01);
        expect(Math.abs(h3Cell.centerLng - LA_LNG)).toBeLessThan(0.01);
    });

    it("groups nearby points into the same cell and separates distant ones", () => {
        const a = H3HexagonalSpatialEngineService.latLngToH3Index(LA_LAT, LA_LNG, 8);
        const nearby = H3HexagonalSpatialEngineService.latLngToH3Index(LA_LAT + 0.0002, LA_LNG + 0.0002, 8);
        const faraway = H3HexagonalSpatialEngineService.latLngToH3Index(34.15, -118.45, 8);

        expect(nearby.h3Index).toBe(a.h3Index);
        expect(faraway.h3Index).not.toBe(a.h3Index);
    });

    it("returns adjacent cells at a real, near-uniform centroid distance", () => {
        const h3Cell = H3HexagonalSpatialEngineService.latLngToH3Index(LA_LAT, LA_LNG, 8);
        const neighbors = H3HexagonalSpatialEngineService.getEquidistantNeighbors(h3Cell.h3Index);

        expect(neighbors).toHaveLength(6);
        expect(new Set(neighbors).size).toBe(6);
        expect(neighbors).not.toContain(h3Cell.h3Index);
        for (const cell of neighbors) expect(isValidCell(cell)).toBe(true);

        const distances = neighbors.map(n =>
            H3HexagonalSpatialEngineService.centroidDistanceMeters(h3Cell.h3Index, n),
        );

        // Res-8 centroid spacing is roughly 0.9–1.1 km, and near-uniform: the
        // spread across the ring is what "no directional bias" actually means.
        for (const d of distances) {
            expect(d).toBeGreaterThan(700);
            expect(d).toBeLessThan(1300);
        }
        expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(150);
    });

    it("evaluates isotropic flux expansion and triggers the GQE FormAgent on high risk density in <50ms", () => {
        const engine = new H3HexagonalSpatialEngineService();

        const evalResult = engine.evaluateHexagonalSpatialState(
            "asset_reefer_99",
            "Reefer Fleet Cargo #99",
            LA_LAT,
            LA_LNG,
            55, // km/h
            0.85, // high risk density flux
            8,
        );

        expect(evalResult.processingLatencyMs).toBeLessThan(50);
        expect(evalResult.equidistantNeighborsCount).toBe(6);

        // Flux field is built over real adjacent cells with measured distances.
        expect(evalResult.isotropicFluxField.neighboringCells).toHaveLength(6);
        for (const cell of evalResult.isotropicFluxField.neighboringCells) {
            expect(isValidCell(cell.h3Index)).toBe(true);
            expect(cell.distanceMeters).toBeGreaterThan(700);
        }

        expect(evalResult.gqeHexInterventionPayload).toBeDefined();
        expect(evalResult.gqeHexInterventionPayload?.formAgentPayload.title).toContain("Eulerian Hex Flux Threshold Breached");
        expect(evalResult.gqeHexInterventionPayload?.formAgentPayload.socraticDisambiguationOptions[0].label).toContain("Execute 60° Radial Hex Detour");

        expect(evalResult.spatialHudPromptFragment).toContain("NEIGHBOR_TOPOLOGY: 6 Adjacent Centroids");
        expect(evalResult.spatialHudPromptFragment).toContain("DWELL_BOUNDARY_SMOOTHING:");
    });
});
