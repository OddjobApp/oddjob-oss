import { describe, it, expect } from "vitest";
import { SPATIAL_TOOLS } from "../../server/domain/tools/v1/capabilities/spatial-tools.js";

describe("Spatial Tools Agent Capabilities Suite", () => {
    it("should execute geofence_spatial_evaluate tool definition cleanly", async () => {
        const resultJson = await SPATIAL_TOOLS.geofence_spatial_evaluate.execute({
            assetId: "truck_101",
            assetName: "Reefer Truck #101",
            latitude: 34.05,
            longitude: -118.25,
            velocityKmh: 60,
            zoneId: "Customs_Port_Zone",
            zoneName: "Port of LA Customs Zone",
            zoneType: "customs_port",
            eventType: "ON_ENTER",
            maxDwellSlaMinutes: 120,
            agentId: "fleet_agent"
        }, {});

        const result = JSON.parse(resultJson);
        expect(result.eventType).toBe("ON_ENTER");
        expect(result.processingLatencyMs).toBeLessThan(50);
        expect(result.spatialHudPrompt).toContain("Port of LA Customs Zone");
    });

    it("should execute h3_hexagonal_spatial_evaluate tool definition cleanly", async () => {
        const resultJson = await SPATIAL_TOOLS.h3_hexagonal_spatial_evaluate.execute({
            assetId: "cargo_hex_99",
            assetName: "Hex Fleet Cargo #99",
            latitude: 34.0522,
            longitude: -118.2437,
            speedKmh: 45,
            riskFluxDensity: 0.85,
            resolution: 8
        }, {});

        const result = JSON.parse(resultJson);
        expect(result.equidistantNeighborsCount).toBe(6);
        expect(result.processingLatencyMs).toBeLessThan(15);
        expect(result.gqeHexInterventionPayload).toBeDefined();
    });
});
