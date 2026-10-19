import { describe, it, expect } from "vitest";
import { TelemetryAlertStreamService } from "../../server/domain/ai/core/telemetry-alert-stream.service.js";
import { XRayGraph, OperationalGuide } from "../../server/domain/ai/core/spec-compiler.js";

describe("Real-Time Telemetry & Trajectory Mutation Engine Suite", () => {
    const mockGraph: XRayGraph = {
        scopeAppId: "fleet_logistics_system",
        fingerprint: "sha256-fleet-initial",
        nodes: [
            { id: "Route_4", label: "Primary Fleet Corridor Route 4", type: "api_endpoint" },
            { id: "Corridor_7", label: "Shadow Detour Corridor 7", type: "api_endpoint" }
        ],
        edges: [],
        stats: { totalNodes: 2, totalRelationships: 1, endpointsCount: 2, agentsCount: 1 }
    };

    const mockGuide: OperationalGuide = {
        readinessScore: 90,
        readinessGaps: []
    };

    it("should process alert feed, drop primary trajectory score, and hot-swap to shadow plan (<50ms)", () => {
        const streamService = new TelemetryAlertStreamService(mockGraph, mockGuide);

        const result = streamService.processAlertFeed(
            {
                alertId: "alert_lat_4099",
                targetNodeId: "Route_4",
                conditionType: "HIGH_LATENCY",
                severity: "critical",
                metricValue: 450,
                thresholdValue: 100
            },
            "fleet_routing_agent",
            "topic::dispatch_and_routing",
            {
                planId: "shadow_plan_b",
                planName: "Corridor 7 Detour",
                detourNodeId: "Corridor_7",
                confidenceScore: 0.95,
                estimatedCostImpactUsd: 1200, // Under $5000 approval threshold
                requiresApprovalThresholdUsd: 5000
            }
        );

        // PROOF 1: Sub-50ms Processing Latency
        expect(result.processingLatencyMs).toBeLessThan(50);
        expect(result.nodeMutationSuccess).toBe(true);

        // PROOF 2: World Model State Mutated
        expect(result.invalidatedTopicKeys).toContain("topic::dispatch_and_routing");

        // PROOF 3: Trajectory Recalculation (Primary T drops, Shadow T is optimal)
        expect(result.primaryTrajectoryResult.safeTransitionScore).toBeLessThan(0.40);
        expect(result.shadowTrajectoryResult).toBeDefined();
        expect(result.shadowTrajectoryResult?.safeTransitionScore).toBeGreaterThanOrEqual(0.85);

        // PROOF 4: Hot-Swap Action Executed
        expect(result.chosenAction).toBe("execute_shadow_swap");

        // PROOF 5: JIT HUD Prompt Updated with Alert State
        expect(result.updatedHudPrompt).toContain("ALERT DETECTED: [HIGH_LATENCY] on Node: Route_4");
        expect(result.updatedHudPrompt).toContain("Corridor 7 Detour");
    });

    it("should trigger GQE FormAgent UI escalation when shadow plan cost exceeds authority threshold", () => {
        const streamService = new TelemetryAlertStreamService(mockGraph, mockGuide);

        const result = streamService.processAlertFeed(
            {
                alertId: "alert_coldchain_881",
                targetNodeId: "Route_4",
                conditionType: "TEMPERATURE_SPIKE",
                severity: "critical",
                metricValue: 42,
                thresholdValue: 4
            },
            "cold_chain_agent",
            "topic::dispatch_and_routing",
            {
                planId: "shadow_plan_air_freight",
                planName: "Expedited Air Freight",
                detourNodeId: "Corridor_7",
                confidenceScore: 0.95,
                estimatedCostImpactUsd: 12000, // Exceeds $5000 authority threshold!
                requiresApprovalThresholdUsd: 5000
            }
        );

        expect(result.processingLatencyMs).toBeLessThan(50);
        expect(result.chosenAction).toBe("gqe_escalation_required");

        // PROOF 6: GQE FormAgent UI Payload Emitted for Supervisor Approval
        expect(result.gqeQuestion).toBeDefined();
        expect(result.gqeQuestion?.formAgentPayload.type).toBe("FormAgent");
        expect(result.gqeQuestion?.formAgentPayload.title).toContain("TEMPERATURE_SPIKE");
        expect(result.gqeQuestion?.formAgentPayload.minimalProofContext.detectedRisk).toContain("12,000");
    });
});
