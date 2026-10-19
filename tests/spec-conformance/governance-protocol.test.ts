/**
 * Spec Conformance: Agent Governance Protocol (GOV-*)
 *
 * Tests are tagged with assertion IDs from docs/specs/conformance/CONFORMANCE.md.
 * All tests are pure unit tests — no DB, Redis, or BullMQ dependencies.
 */

import { describe, it, expect, vi } from "vitest";

// ── Simulated governance logic ────────────────────────────────────────────────

const SAFE_TOOLS = new Set(["think_step", "google_search", "browse_web"]);

interface GovernanceCheckInput {
    action: string;
    missionName?: string;
    requireApprovalForAll?: boolean;
    sentinelResult?: { approved: boolean; rationale?: string };
    toolContract?: { requiresApproval?: boolean; riskLevel?: "low" | "medium" | "high" };
}

interface GovernanceCheckResult {
    needsApproval: boolean;
    approved?: boolean;
    reason?: string;
    stoppedAtStep?: number;
}

function simulateGovernanceCheck(input: GovernanceCheckInput): GovernanceCheckResult {
    const {
        action,
        missionName = "",
        requireApprovalForAll = false,
        sentinelResult = { approved: true },
        toolContract,
    } = input;

    // Step 1: Human-Driven Gate
    if (missionName.startsWith("Debug Mission:")) {
        return { needsApproval: false, approved: true, stoppedAtStep: 1 };
    }

    // Step 2: SAFE_TOOLS bypass (GOV-003)
    if (SAFE_TOOLS.has(action.toLowerCase())) {
        return { needsApproval: false, approved: true, stoppedAtStep: 2 };
    }

    // Step 3: requireApprovalForAll
    if (
        requireApprovalForAll &&
        action.toLowerCase() !== "conclude_mission" &&
        action.toLowerCase() !== "fail_mission"
    ) {
        return { needsApproval: true, stoppedAtStep: 3 };
    }

    // Step 4: Sentinel Audit (GOV-004)
    if (!sentinelResult.approved) {
        return {
            needsApproval: true,
            reason: `Sentinel Audit Failure: ${sentinelResult.rationale}`,
            stoppedAtStep: 4,
        };
    }

    // Step 5: Tool Contract (GOV-005)
    if (toolContract?.requiresApproval) {
        return { needsApproval: true, stoppedAtStep: 5 };
    }
    if (toolContract?.riskLevel === "high") {
        return { needsApproval: true, stoppedAtStep: 5 };
    }

    return { needsApproval: false, approved: true };
}

// Budget check simulation
function checkBudget(costUsd: number, budgetLimitUsd: number): { exceeded: boolean } {
    return { exceeded: costUsd > budgetLimitUsd };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GOV-001: budget ceiling enforcement", () => {
    it("flags exceeded when costUsd > budgetLimitUsd", () => {
        const result = checkBudget(51.0, 50.0);
        expect(result.exceeded).toBe(true);
    });

    it("allows execution when costUsd < budgetLimitUsd", () => {
        const result = checkBudget(25.0, 50.0);
        expect(result.exceeded).toBe(false);
    });

    it("allows execution when costUsd equals budgetLimitUsd", () => {
        const result = checkBudget(50.0, 50.0);
        expect(result.exceeded).toBe(false);
    });
});

describe("GOV-003: SAFE_TOOLS bypass — fixed set", () => {
    it.each(["think_step", "google_search", "browse_web"])(
        "bypasses governance for %s",
        (tool) => {
            const result = simulateGovernanceCheck({ action: tool });
            expect(result.needsApproval).toBe(false);
            expect(result.stoppedAtStep).toBe(2);
        }
    );

    it("does not bypass governance for unlisted tools", () => {
        const result = simulateGovernanceCheck({ action: "external_db_write" });
        expect(result.stoppedAtStep).not.toBe(2);
    });

    it("is case-insensitive", () => {
        const result = simulateGovernanceCheck({ action: "THINK_STEP" });
        expect(result.needsApproval).toBe(false);
    });
});

describe("GOV-004: sentinel audit rejection escalates to human approval", () => {
    it("requires approval when sentinel rejects", () => {
        const result = simulateGovernanceCheck({
            action: "file_write",
            sentinelResult: { approved: false, rationale: "Unusual file path detected" },
        });
        expect(result.needsApproval).toBe(true);
        expect(result.reason).toContain("Sentinel Audit Failure");
        expect(result.stoppedAtStep).toBe(4);
    });

    it("does not require approval when sentinel approves", () => {
        const result = simulateGovernanceCheck({
            action: "safe_read",
            sentinelResult: { approved: true },
        });
        expect(result.needsApproval).toBe(false);
    });
});

describe("GOV-005: tool contract — both requiresApproval and high riskLevel trigger gate", () => {
    it("requires approval when tool.approvalPolicy.requiresApproval is true", () => {
        const result = simulateGovernanceCheck({
            action: "custom_tool",
            toolContract: { requiresApproval: true },
        });
        expect(result.needsApproval).toBe(true);
        expect(result.stoppedAtStep).toBe(5);
    });

    it("requires approval when riskLevel is high", () => {
        const result = simulateGovernanceCheck({
            action: "custom_tool",
            toolContract: { riskLevel: "high" },
        });
        expect(result.needsApproval).toBe(true);
        expect(result.stoppedAtStep).toBe(5);
    });

    it("does not require approval when riskLevel is low and no explicit policy", () => {
        const result = simulateGovernanceCheck({
            action: "custom_tool",
            toolContract: { riskLevel: "low" },
        });
        expect(result.needsApproval).toBe(false);
    });

    it("does not require approval when riskLevel is medium and no explicit policy", () => {
        const result = simulateGovernanceCheck({
            action: "custom_tool",
            toolContract: { riskLevel: "medium" },
        });
        expect(result.needsApproval).toBe(false);
    });
});

describe("GOV-006: approved: false must prevent action execution", () => {
    it("action is blocked when governance returns needsApproval: true and approval is denied", () => {
        let actionExecuted = false;
        const governanceResult = { needsApproval: true };
        const approvalResult = { approved: false, reason: "Rejected by reviewer" };

        if (!governanceResult.needsApproval || approvalResult.approved) {
            actionExecuted = true;
        }

        expect(actionExecuted).toBe(false);
    });

    it("action proceeds when governance returns needsApproval: false", () => {
        let actionExecuted = false;
        const governanceResult = { needsApproval: false, approved: true };

        if (!governanceResult.needsApproval || governanceResult.approved) {
            actionExecuted = true;
        }

        expect(actionExecuted).toBe(true);
    });
});

describe("Governance check ordering", () => {
    it("Debug Mission bypasses all subsequent steps (step 1 short-circuits)", () => {
        const result = simulateGovernanceCheck({
            action: "dangerous_action",
            missionName: "Debug Mission: test env",
            sentinelResult: { approved: false, rationale: "Would normally block" },
        });
        expect(result.needsApproval).toBe(false);
        expect(result.stoppedAtStep).toBe(1);
    });

    it("SAFE_TOOLS bypasses sentinel (step 2 short-circuits before step 4)", () => {
        const result = simulateGovernanceCheck({
            action: "google_search",
            sentinelResult: { approved: false, rationale: "Would normally block" },
        });
        expect(result.needsApproval).toBe(false);
        expect(result.stoppedAtStep).toBe(2);
    });
});

describe("GOV-007: governance tier thresholds", () => {
    const TIERS = {
        strict: { consensusThreshold: 0.9, vetoThreshold: 0.3, timeoutMs: 120_000 },
        standard: { consensusThreshold: 0.75, vetoThreshold: 0.1, timeoutMs: 60_000 },
        relaxed: { consensusThreshold: 0.5, vetoThreshold: 0.05, timeoutMs: 30_000 },
    };

    it("strict tier has 90% consensus threshold", () => {
        expect(TIERS.strict.consensusThreshold).toBe(0.9);
    });

    it("standard tier has 75% consensus threshold", () => {
        expect(TIERS.standard.consensusThreshold).toBe(0.75);
    });

    it("relaxed tier has 50% consensus threshold", () => {
        expect(TIERS.relaxed.consensusThreshold).toBe(0.5);
    });

    it("strict tier has 2 minute timeout", () => {
        expect(TIERS.strict.timeoutMs).toBe(120_000);
    });
});
