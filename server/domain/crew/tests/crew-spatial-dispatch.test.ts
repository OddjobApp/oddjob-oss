import { describe, it, expect } from "vitest";
import { CREW_RAIL_TOOLS } from "../../tools/v1/capabilities/crew-rail-tools.js";

describe("CREW Spatial Squad Dispatch & Bayesian Trajectory Governance", () => {
    it("evaluates safety trajectory and mounts a governance checkpoint for spatial squad dispatch", async () => {
        const resultJson = await CREW_RAIL_TOOLS.dispatch_spatial_squad.execute({
            targetH3Index: "8828308281fffff",
            squadId: "squad-4-alpha",
            missionObjective: "Inspect critical breaker fault at Substation Delta",
            estimatedDurationMinutes: 45,
            assetRiskClass: "high",
            assignedPersonnel: ["Agent-SRE", "Human-TechLead"],
        }, { organizationId: 1, userId: "test", named: {}, positional: {} } as any);

        const result = JSON.parse(resultJson);
        expect(result.type).toBe("crew_governance_gate_pod");
        expect(result.module).toBe("CrewGovernanceGateRail");
        expect(result.checkpoint.actionKey).toBe("dispatch_spatial_squad");
        expect(result.checkpoint.actionTitle).toContain("squad-4-alpha");
        expect(result.checkpoint.actionTitle).toContain("8828308281fffff");
        expect(result.checkpoint.riskTier).toBe("high");
        expect(result.checkpoint.requestedBy).toBe("SpatialDispatcher");
        expect(result.checkpoint.blastRadius.affectedServices).toContain("spatial_fleet");
        expect(result.checkpoint.blastRadius.estimatedCostUsd).toBe(225); // 45 * 5
        expect(result.checkpoint.executionPayload.squadId).toBe("squad-4-alpha");
        expect(result.checkpoint.executionPayload.trajectoryScore).toBeGreaterThan(0);
        expect(result.checkpoint.status).toBe("pending");
    });

    it("enforces critical risk tier and dual sign-off when asset risk is critical", async () => {
        const resultJson = await CREW_RAIL_TOOLS.dispatch_spatial_squad.execute({
            targetH3Index: "8828308281fffff",
            squadId: "squad-9-critical",
            missionObjective: "High-voltage grid containment",
            estimatedDurationMinutes: 60,
            assetRiskClass: "critical",
        }, { organizationId: 1, userId: "test", named: {}, positional: {} } as any);

        const result = JSON.parse(resultJson);
        expect(result.checkpoint.riskTier).toBe("critical");
        expect(result.checkpoint.requiresDualSignOff).toBe(true);
    });
});
