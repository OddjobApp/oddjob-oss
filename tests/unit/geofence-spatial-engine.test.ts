import { describe, it, expect } from "vitest";
import { GeofenceSpatialEngineService } from "../../server/domain/ai/core/geofence-spatial-engine.service.js";
import { XRayGraph, OperationalGuide } from "../../server/domain/ai/core/spec-compiler.js";

describe("Spatial-Temporal Geofence Engine Suite", () => {
    const mockGraph: XRayGraph = {
        scopeAppId: "global_logistics_mesh",
        fingerprint: "sha256-spatial-initial",
        nodes: [
            { id: "Port_LA_Customs_Zone", label: "Port of LA Customs Zone", type: "api_endpoint" },
            { id: "Rail_Express_Corridor", label: "Plan B: Rail Express Corridor", type: "api_endpoint" }
        ],
        edges: [],
        stats: { totalNodes: 2, totalRelationships: 1, endpointsCount: 2, agentsCount: 1 }
    };

    const mockGuide: OperationalGuide = {
        readinessScore: 92,
        readinessGaps: []
    };

    it("should process ON_ENTER spatial geofence event and inject regional tools in <50ms", () => {
        const spatialEngine = new GeofenceSpatialEngineService(mockGraph, mockGuide);

        const result = spatialEngine.processSpatialTelemetry(
            {
                assetId: "truck_402",
                assetName: "Reefer Truck #402",
                latitude: 33.74,
                longitude: -118.27,
                velocityKmh: 45,
                cargoValueUsd: 45000,
                timestamp: new Date()
            },
            {
                zoneId: "Port_LA_Customs_Zone",
                zoneName: "Port of LA Customs Zone",
                zoneType: "customs_port",
                maxDwellSlaMinutes: 120,
                regionalTools: ["us_customs_clearance_api", "la_port_traffic_cam"]
            },
            "ON_ENTER",
            "fleet_coldchain_agent"
        );

        expect(result.processingLatencyMs).toBeLessThan(50);
        expect(result.eventType).toBe("ON_ENTER");
        expect(result.spatialHudPrompt).toContain("EVENT: ON_ENTER [Geofence: Port of LA Customs Zone]");
        expect(result.spatialHudPrompt).toContain("us_customs_clearance_api");
    });

    it("should detect ON_DWELL SLA breach, drop trajectory score, and trigger location-aware GQE intervention", () => {
        const spatialEngine = new GeofenceSpatialEngineService(mockGraph, mockGuide);

        const result = spatialEngine.processSpatialTelemetry(
            {
                assetId: "reefer_104",
                assetName: "Reefer Truck #104",
                latitude: 32.54,
                longitude: -117.03,
                velocityKmh: 0, // Stopped inside border plaza
                cargoValueUsd: 45000,
                timestamp: new Date()
            },
            {
                zoneId: "Border_Plaza_Zone",
                zoneName: "Border Inspection Plaza",
                zoneType: "border_inspection",
                maxDwellSlaMinutes: 120, // 2 hour limit
                regionalTools: ["border_tariff_calculator"]
            },
            "ON_DWELL",
            "fleet_coldchain_agent",
            {
                planName: "Plan B: Rail Express",
                detourNodeId: "Rail_Express_Corridor",
                confidenceScore: 0.95
            }
        );

        // PROOF 1: Sub-50ms Reaction
        expect(result.processingLatencyMs).toBeLessThan(50);
        expect(result.isSlaBreached).toBe(true);

        // PROOF 2: Primary Trajectory Score Collapse (0.31 DEGRADED)
        expect(result.primaryTrajectoryResult.safeTransitionScore).toBeLessThan(0.40);
        expect(result.shadowTrajectoryResult?.safeTransitionScore).toBeGreaterThanOrEqual(0.85);

        // PROOF 3: Location-Aware GQE FormAgent UI Intervention Card
        expect(result.gqeSpatialQuestion).toBeDefined();
        expect(result.gqeSpatialQuestion?.formAgentPayload.type).toBe("FormAgent");
        expect(result.gqeSpatialQuestion?.formAgentPayload.title).toContain("Geofence Dwell SLA Threshold Exceeded");
        expect(result.gqeSpatialQuestion?.formAgentPayload.minimalProofContext.detectedRisk).toContain("$45,000 value");

        // PROOF 4: Spatial Socratic Resolution Options Emitted
        const options = result.gqeSpatialQuestion?.formAgentPayload.socraticDisambiguationOptions || [];
        expect(options.some(o => o.label.includes("Pay Expedited Inspection Fee"))).toBe(true);
        expect(options.some(o => o.label.includes("Reroute Back-up Refrigerated Unit"))).toBe(true);
    });
});
