import { describe, it, expect } from "vitest";
import { CREW_RAIL_TOOLS } from "../../tools/v1/capabilities/crew-rail-tools.js";

describe("CREW Specialized Rail Capability Tools", () => {
    it("propose_decision_matrix tool computes overall weighted scores and sorts candidates", async () => {
        const resultJson = await CREW_RAIL_TOOLS.propose_decision_matrix.execute({
            topic: "Database Architecture",
            candidates: [
                { id: "pg", name: "PostgreSQL", scores: { scalability: 7, cost: 9 } },
                { id: "spanner", name: "Google Cloud Spanner", scores: { scalability: 10, cost: 4 } },
            ],
            criteria: [
                { key: "scalability", label: "Scalability", weight: 2.0 },
                { key: "cost", label: "Cost", weight: 1.0 },
            ],
            personaStances: [
                { agentName: "DBA", preferredCandidateId: "spanner", confidence: 95, rationale: "Global scale" },
            ],
        }, { organizationId: 1, userId: "test", named: {}, positional: {} } as any);

        const result = JSON.parse(resultJson);
        expect(result.type).toBe("crew_decision_matrix_pod");
        expect(result.module).toBe("CrewDecisionMatrixRail");
        expect(result.topic).toBe("Database Architecture");
        expect(result.candidates.length).toBe(2);
        
        // Spanner: (10*2 + 4*1)/3 = 24/3 = 8.0
        // Postgres: (7*2 + 9*1)/3 = 23/3 = 7.7
        expect(result.candidates[0].id).toBe("spanner");
        expect(result.candidates[0].overallScore).toBe(8);
        expect(result.candidates[1].id).toBe("pg");
        expect(result.candidates[1].overallScore).toBe(7.7);
    });

    it("request_governance_approval tool generates checkpoint artifact with blast radius", async () => {
        const resultJson = await CREW_RAIL_TOOLS.request_governance_approval.execute({
            actionKey: "migrate_fleet_pods",
            actionTitle: "Migrate Fleet Pods to NodePool-2",
            riskTier: "high",
            requestedBy: "ClusterOrchestrator",
            blastRadius: {
                affectedServices: ["search", "analytics"],
                dataDestructionRisk: false,
                estimatedCostUsd: 120,
                tenantsImpactedCount: 50,
            },
            executionPayload: { targetNodePool: "nodepool-2-c3" },
        }, { organizationId: 1, userId: "test", named: {}, positional: {} } as any);

        const result = JSON.parse(resultJson);
        expect(result.type).toBe("crew_governance_gate_pod");
        expect(result.checkpoint.actionKey).toBe("migrate_fleet_pods");
        expect(result.checkpoint.riskTier).toBe("high");
        expect(result.checkpoint.status).toBe("pending");
        expect(result.checkpoint.blastRadius.tenantsImpactedCount).toBe(50);
    });

    it("pin_forensic_event tool generates forensic timeline artifact", async () => {
        const resultJson = await CREW_RAIL_TOOLS.pin_forensic_event.execute({
            incidentTitle: "Worker OOM Incident",
            eventTimestamp: "2026-08-28T06:00:00Z",
            severity: "critical",
            source: "Worker-7",
            description: "Heap out of memory error in transform stage",
            hypothesis: {
                statement: "Unbounded array allocation in CSV parser",
                confidence: "high",
                supportingAgents: ["Analyst"],
            },
        }, { organizationId: 1, userId: "test", named: {}, positional: {} } as any);

        const result = JSON.parse(resultJson);
        expect(result.type).toBe("crew_forensic_timeline_pod");
        expect(result.incidentTitle).toBe("Worker OOM Incident");
        expect(result.event.severity).toBe("critical");
        expect(result.event.source).toBe("Worker-7");
        expect(result.event.hypothesis.confidence).toBe("high");
    });
});
