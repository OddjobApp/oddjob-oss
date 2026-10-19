import { describe, it, expect } from "vitest";
import { compilePhasePrompt } from "../../server/domain/ai/core/phase-compiler.js";
import { XRayGraph, OperationalGuide } from "../../server/domain/ai/core/spec-compiler.js";

describe("Phase-Aware Spec Compiler", () => {
    const sampleGraph: XRayGraph = {
        scopeAppId: "analytics-suite",
        fingerprint: "sha256-phase123",
        nodes: [
            { id: "node1", label: "/api/agent-analytics", type: "api_endpoint" },
            { id: "node2", label: "Analytics Service", type: "service" }
        ],
        edges: [
            { source: "node1", target: "node2", relation: "calls" }
        ],
        stats: {
            totalNodes: 2,
            totalRelationships: 1,
            endpointsCount: 1,
            agentsCount: 0
        }
    };

    const sampleGuide: OperationalGuide = {
        readinessScore: 78,
        readinessGaps: [
            { gap: "coverage-missing-e2e_test", finding: "Missing Playwright tests", severity: "high" }
        ]
    };

    it("should compile targeted prompt for DIAGNOSE phase", () => {
        const result = compilePhasePrompt(sampleGraph, sampleGuide, {
            phase: "diagnose",
            targetNodeId: "node1"
        });

        expect(result.phase).toBe("diagnose");
        expect(result.prompt).toContain("CURRENT PHASE: [DIAGNOSE]");
        expect(result.prompt).toContain("Do NOT edit production code yet");
        expect(result.tokenWeightEst).toBeLessThan(400);
    });

    it("should compile targeted prompt for APPROVE phase without raw code noise", () => {
        const result = compilePhasePrompt(sampleGraph, sampleGuide, {
            phase: "approve",
            targetNodeId: "node1"
        });

        expect(result.phase).toBe("approve");
        expect(result.prompt).toContain("CURRENT PHASE: [APPROVE]");
        expect(result.prompt).toContain("Emit a FormAgent / InstantApp attestation payload");
        expect(result.tokenWeightEst).toBeLessThan(300);
    });
});
