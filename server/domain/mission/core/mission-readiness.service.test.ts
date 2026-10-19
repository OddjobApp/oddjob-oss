import { describe, expect, it } from "vitest";
import type { ValidateResult } from "./mission-dependency-resolver.service";
import { buildMissionReadiness, type MissionReadinessJobProfile } from "./mission-readiness.service";

const dependencies: ValidateResult = { valid: true, resolved: [], missing: [], warnings: [], blockers: [] };
const testedAgent: MissionReadinessJobProfile = {
    id: 1,
    name: "Support responder",
    type: "email_send",
    tool: "email",
    dataClassification: "internal",
    isActive: true,
    lifecycleStatus: "active",
    lastTestStatus: "success",
};

describe("buildMissionReadiness", () => {
    it("produces a tested, governed preflight for a complete mission", () => {
        const result = buildMissionReadiness({
            name: "Governed support triage",
            objective: "Classify the support issue using policy evidence and send an approved customer response.",
            budgetLimitUsd: 5,
            executionStrategy: "pre_planned",
            hilStrictness: "moderate",
            members: [{ entityType: "job", entityId: 1, role: "responder" }],
            knowledgeAssetCount: 2,
            sampleInput: "Customer payment retries failed three times.",
            expectedCriteria: "Cite policy and request approval before sending.",
        }, dependencies, [testedAgent], new Date("2026-07-19T12:00:00Z"));

        expect(result.ready).toBe(true);
        expect(result.promotionState).toBe("tested");
        expect(result.policy.decision).toBe("review");
        expect(result.permissions).toContainEqual(expect.objectContaining({ scope: "external", access: "write", requiresApproval: true }));
        expect(result.dryRunPlan.every((step) => step.touchesLiveSystems === false)).toBe(true);
    });

    it("fails closed on missing dependencies and insufficient budget", () => {
        const result = buildMissionReadiness({
            name: "Risky mission",
            objective: "Run the complete operational workflow with the assigned worker.",
            budgetLimitUsd: 0.01,
            members: [{ entityType: "job", entityId: 1, role: "worker" }],
        }, { ...dependencies, valid: false, blockers: ["Credential #7 not found"] }, [testedAgent]);

        expect(result.ready).toBe(false);
        expect(result.promotionState).toBe("draft");
        expect(result.checks.filter((check) => check.status === "block").map((check) => check.id)).toEqual(expect.arrayContaining(["dependencies", "budget"]));
    });

    it("marks an otherwise launchable mission ready for testing when evaluation evidence is missing", () => {
        const result = buildMissionReadiness({
            name: "Internal analysis",
            objective: "Analyze the supplied operational records and prepare an internal summary.",
            budgetLimitUsd: 5,
            members: [{ entityType: "job", entityId: 1, role: "analyst" }],
            knowledgeAssetCount: 1,
        }, dependencies, [{ ...testedAgent, type: "ai_agent" }]);

        expect(result.ready).toBe(true);
        expect(result.promotionState).toBe("ready_for_test");
        expect(result.checks.find((check) => check.id === "evaluation")?.status).toBe("warning");
    });
});

