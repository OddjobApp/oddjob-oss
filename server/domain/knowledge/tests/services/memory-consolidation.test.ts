import { describe, it, expect } from "vitest";
import { memoryConsolidationService } from "../../core/rag/memory-consolidation.service.js";
import { prmTreeSearchService } from "../../../agents/core/prm-tree-search.service.js";
import { symbolicRuleVerifierService } from "../../../rules/core/symbolic-rule-verifier.service.js";

describe("Cutting-Edge AI Research Integration Tests", () => {
    describe("1. Surprise-Gated Memory Consolidation Service", () => {
        it("should calculate surprise score correctly for aligned trace", () => {
            const score = memoryConsolidationService.calculateSurpriseScore({
                predictedOutcome: "Execute database backup",
                actualOutcome: "Execute database backup successfully",
                executionTimeMs: 500
            });
            expect(score).toBeGreaterThanOrEqual(0.0);
            expect(score).toBeLessThan(0.4);
        });

        it("should calculate high surprise score for divergent trace with errors", () => {
            const score = memoryConsolidationService.calculateSurpriseScore({
                predictedOutcome: "Query customer records",
                actualOutcome: "Database connection failed unexpectedly",
                executionTimeMs: 12000,
                errorTrace: "ETIMEDOUT: Connection refused"
            });
            expect(score).toBeGreaterThan(0.5);
        });
    });

    describe("2. Process Reward Model (PRM) Guided Tree Search", () => {
        it("should score valid tool candidate steps highly", () => {
            const score = prmTreeSearchService.evaluateStepReward({
                stepId: "step-1",
                actionType: "tool_call",
                toolName: "db_query_service",
                payload: { query: "SELECT * FROM users" },
                estimatedCostTokens: 500
            });
            expect(score).toBeGreaterThan(0.7);
        });

        it("should prune low reward branches in tree search", async () => {
            const steps = [
                {
                    stepId: "step-good",
                    actionType: "tool_call",
                    toolName: "api_fetch_data",
                    payload: { endpoint: "/api/v1/metrics" },
                    estimatedCostTokens: 1000
                },
                {
                    stepId: "step-bad",
                    actionType: "unknown",
                    payload: {},
                    estimatedCostTokens: 15000
                }
            ];

            const result = await prmTreeSearchService.searchBestExecutionPlan(steps, 2, 0.6);
            expect(result.selectedPlan.length).toBe(1);
            expect(result.selectedPlan[0].stepId).toBe("step-good");
            expect(result.prunedBranchesCount).toBe(1);
        });
    });

    describe("3. Symbolic SMT Rule Verification", () => {
        it("should generate a valid proof certificate for non-contradictory rules", () => {
            const cert = symbolicRuleVerifierService.verifyRuleBranch({
                ruleId: "rule-101",
                action: "ALERT_HIGH_CPU",
                conditions: [
                    { field: "cpuUsage", operator: ">", value: 80 },
                    { field: "cpuUsage", operator: "<=", value: 100 }
                ]
            });
            expect(cert.isSatisfiable).toBe(true);
            expect(cert.hasContradictions).toBe(false);
            expect(cert.certificateId).toContain("CERT_rule-101");
        });

        it("should detect logical contradictions in contradictory rule conditions", () => {
            const cert = symbolicRuleVerifierService.verifyRuleBranch({
                ruleId: "rule-contradictory",
                action: "INVALID_BRANCH",
                conditions: [
                    { field: "memoryUsage", operator: ">", value: 90 },
                    { field: "memoryUsage", operator: "<", value: 50 }
                ]
            });
            expect(cert.isSatisfiable).toBe(false);
            expect(cert.hasContradictions).toBe(true);
            expect(cert.proofDetails[0]).toContain("Contradiction detected");
        });
    });
});
