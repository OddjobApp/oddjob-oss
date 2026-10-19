import { describe, it, expect } from "vitest";
import { H3HexagonalSpatialEngineService } from "../h3-hexagonal-spatial-engine.service.js";

describe("H3 Hexagonal Spatial Engine - Deep Integration", () => {
    it("converts lat/lng to valid Uber H3 index and resolves adjacent hex cells", () => {
        const lat = 34.0522;
        const lng = -118.2437;
        const cell = H3HexagonalSpatialEngineService.latLngToH3Index(lat, lng, 8);

        expect(cell.h3Index).toBeDefined();
        expect(typeof cell.h3Index).toBe("string");
        expect(cell.resolution).toBe(8);

        const neighbors = H3HexagonalSpatialEngineService.getEquidistantNeighbors(cell.h3Index);
        expect(neighbors.length).toBeGreaterThanOrEqual(5);
    });

    it("materializes spatio-temporal triplets for knowledge graph integration", () => {
        const res = H3HexagonalSpatialEngineService.buildSpatioTemporalKnowledgeTriplets(
            "SIG-8842",
            "Generator Overheat",
            "GEN-8842-X",
            34.0522,
            -118.2437,
            8
        );

        expect(res.cell.h3Index).toBeDefined();
        expect(res.triplets.length).toBeGreaterThan(3);

        const anomalyTriplet = res.triplets.find(t => t.predicate === "OCCURRED_IN");
        expect(anomalyTriplet).toBeDefined();
        expect(anomalyTriplet?.subject).toBe("anomaly:SIG-8842");

        const assetTriplet = res.triplets.find(t => t.predicate === "BOUNDS_ASSET");
        expect(assetTriplet).toBeDefined();
        expect(assetTriplet?.object).toBe("asset:GEN-8842-X");
    });

    it("materializes user grounding triplets when assignedUserId is provided", () => {
        const res = H3HexagonalSpatialEngineService.buildSpatioTemporalKnowledgeTriplets(
            "SIG-8842",
            "Generator Overheat",
            "GEN-8842-X",
            34.0522,
            -118.2437,
            8,
            "usr_tech_09"
        );

        const userLocTriplet = res.triplets.find(t => t.subject === "user:usr_tech_09" && t.predicate === "LOCATED_IN");
        expect(userLocTriplet).toBeDefined();
        expect(userLocTriplet?.object).toBe(`h3_cell:${res.cell.h3Index}`);

        const userAssignTriplet = res.triplets.find(t => t.subject === "user:usr_tech_09" && t.predicate === "ASSIGNED_TO");
        expect(userAssignTriplet).toBeDefined();
        expect(userAssignTriplet?.object).toBe("anomaly:SIG-8842");
    });

    it("materializes squad grounding triplets when assignedTeamId is provided", () => {
        const res = H3HexagonalSpatialEngineService.buildSpatioTemporalKnowledgeTriplets(
            "SIG-8842",
            "Generator Overheat",
            "GEN-8842-X",
            34.0522,
            -118.2437,
            8,
            "usr_tech_09",
            4
        );

        const teamPatrolTriplet = res.triplets.find(t => t.subject === "team:4" && t.predicate === "PATROLS_HEX");
        expect(teamPatrolTriplet).toBeDefined();
        expect(teamPatrolTriplet?.object).toBe(`h3_cell:${res.cell.h3Index}`);

        const teamAssignTriplet = res.triplets.find(t => t.subject === "team:4" && t.predicate === "ASSIGNED_TO");
        expect(teamAssignTriplet).toBeDefined();
        expect(teamAssignTriplet?.object).toBe("anomaly:SIG-8842");
    });

    it("evaluates neuro-symbolic SLA distance decay correctly", () => {
        const nearResult = H3HexagonalSpatialEngineService.calculateSlaDistanceDecay(2.0, 40, 30);
        expect(nearResult.estTransitMins).toBe(3.0);
        expect(nearResult.remainingSlaMins).toBe(27.0);
        expect(nearResult.urgencyTier).toBe("NORMAL");

        const farResult = H3HexagonalSpatialEngineService.calculateSlaDistanceDecay(25.0, 20, 30);
        expect(farResult.remainingSlaMins).toBe(0);
        expect(farResult.urgencyTier).toBe("CRITICAL");
    });
});
