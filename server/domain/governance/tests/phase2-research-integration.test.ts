import { describe, it, expect } from "vitest";
import { conformalGovernanceService } from "../core/conformal-governance.service.js";
import { causalCascadePredictorService } from "../../graph/core/causal-cascade-predictor.service.js";
import { dpoDatasetCompilerService } from "../../transference/core/dpo-dataset-compiler.service.js";

describe("Phase 2 Cutting-Edge AI Research Integration Tests", () => {
    describe("1. Conformal Prediction Governance Service", () => {
        it("should allow autonomous execution when non-conformity is below coverage quantile", () => {
            const decision = conformalGovernanceService.evaluateConformalSafety({
                actionId: "act-001",
                actionType: "deploy_canary",
                modelConfidence: 0.95,
                riskTier: "medium",
                nonConformityScore: 0.05
            });

            expect(decision.isAutonomousAllowed).toBe(true);
            expect(decision.requiresHilEscalation).toBe(false);
            expect(decision.coverageLevel).toBe(0.95);
        });

        it("should escalate to HIL when non-conformity breaches coverage quantile threshold", () => {
            const decision = conformalGovernanceService.evaluateConformalSafety({
                actionId: "act-002",
                actionType: "drop_db_table",
                modelConfidence: 0.60,
                riskTier: "critical",
                nonConformityScore: 0.40
            });

            expect(decision.isAutonomousAllowed).toBe(false);
            expect(decision.requiresHilEscalation).toBe(true);
            expect(decision.coverageLevel).toBe(0.99); // Critical tier enforces 99% coverage
            expect(decision.reasoning).toContain("Escalating to Human-in-the-Loop");
        });
    });

    describe("2. Causal Discovery & Cascade Predictor Service", () => {
        it("should accurately predict failure cascade risk across microservices", () => {
            const triggerNode = { id: "node-auth", name: "Auth Service", type: "service" as const, failureProbability: 0.8 };
            const nodes = [
                triggerNode,
                { id: "node-api", name: "API Gateway", type: "service" as const, failureProbability: 0.1 },
                { id: "node-ui", name: "Dashboard UI", type: "endpoint" as const, failureProbability: 0.05 }
            ];
            const edges = [
                { sourceId: "node-auth", targetId: "node-api", causalWeight: 0.7 },
                { sourceId: "node-api", targetId: "node-ui", causalWeight: 0.8 }
            ];

            const result = causalCascadePredictorService.predictCascadeRisk(triggerNode, nodes, edges);
            expect(result.triggerNodeId).toBe("node-auth");
            expect(result.impactedNodes.length).toBeGreaterThan(1);
            expect(result.recommendedRerouteNodes).toContain("node-api");
            expect(result.isSafeToDeploy).toBe(false);
        });
    });

    describe("3. On-Policy DPO Dataset Compiler Service", () => {
        it("should compile paired telemetry traces into valid DPO JSONL format", () => {
            const pairs = [
                {
                    prompt: "Optimize database query for high traffic endpoint",
                    chosenResponse: "Add composite index (user_id, status) and apply pagination",
                    rejectedResponse: "Remove WHERE clause and select all rows into memory"
                }
            ];

            const dataset = dpoDatasetCompilerService.compileDpoDataset(pairs, "huggingface_dpo");
            expect(dataset.recordCount).toBe(1);

            const parsed = JSON.parse(dataset.jsonlLines[0]);
            expect(parsed.prompt).toContain("Optimize database query");
            expect(parsed.chosen).toContain("composite index");
            expect(parsed.rejected).toContain("select all rows");
        });
    });
});
