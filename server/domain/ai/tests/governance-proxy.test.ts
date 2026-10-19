import { describe, it, expect } from "vitest";
import { GovernanceProxyService } from "../core/governance-proxy.service.js";

describe("Drop-In Governance Proxy Sidecar (O5)", () => {
    it("evaluates safe read-only actions and returns auto_execute decision with small model routing", () => {
        const result = GovernanceProxyService.evaluateAction({
            actionKey: "query_dataset_metrics",
            targetResource: "analytics/dashboards",
            confidenceScore: 0.95,
            agentName: "ExternalLangChainAgent",
        });

        expect(result.evaluationId).toMatch(/^gov-eval-/);
        expect(result.actionKey).toBe("query_dataset_metrics");
        expect(result.riskClass).toBe("routine");
        expect(result.decision).toBe("auto_execute");
        expect(result.selectedModelTier).toBe("8b_small");
        expect(result.safeTransitionScore).toBeGreaterThanOrEqual(0.85);
        expect(result.requiresDualSignOff).toBe(false);
        expect(result.evaluationProofHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("evaluates high-risk or production resource mutations and enforces require_approval", () => {
        const result = GovernanceProxyService.evaluateAction({
            actionKey: "alter_production_table",
            targetResource: "prod/users/schema.sql",
            confidenceScore: 0.88,
            agentName: "ExternalCrewAIAgent",
        });

        expect(result.riskClass).toBe("critical");
        expect(result.decision).toBe("require_approval");
        expect(result.selectedModelTier).toBe("frontier_large");
        expect(result.requiresDualSignOff).toBe(true);
        expect(result.evaluationProofHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("detects agent retry loops across identical targets and enforces halt_loop", () => {
        const result = GovernanceProxyService.evaluateAction({
            actionKey: "patch_file",
            targetResource: "server/routes/auth.ts",
            stepStage: "Improve",
            stepHistory: [
                { stage: "Improve", targetFileOrNode: "server/routes/auth.ts" },
                { stage: "Diagnose", targetFileOrNode: "server/routes/auth.ts" },
                { stage: "Improve", targetFileOrNode: "server/routes/auth.ts" },
            ],
            agentName: "ExternalAutoGenAgent",
        });

        expect(result.decision).toBe("halt_loop");
        expect(result.safeTransitionScore).toBe(0.0);
        expect(result.reason).toContain("Multi-turn cycle repetition detected");
    });
});
