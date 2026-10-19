/**
 * Autonomous Lifecycle Manager Unit Tests (Simplified)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock MoltProducer as it has Redis/Network dependencies
vi.mock("@domain/governor/core/molt-producer.js", () => ({
    MoltProducer: class {
        propose = vi.fn().mockResolvedValue({ approved: true, reason: "Testing" });
        produce = vi.fn().mockResolvedValue({ approved: true, reason: "Testing" });
    }
}));

vi.mock("@domain/governor/core/budget-governance.service.js", () => ({
    BudgetGovernanceService: {
        checkAgentSalary: vi.fn().mockResolvedValue({ allowed: true }),
        recordSpend: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock("@domain/agents/core/speculative/planner-strategies.js", () => ({
    MCTSPlannerStrategy: class {
        plan = vi.fn().mockResolvedValue({
            goal: "Goal",
            strategy: "MCTS Strategy",
            steps: [
                { id: "s1", description: "S1", tool: "t1", params: {}, hypothesis: "H1", risk: "low", status: "pending" }
            ],
            createdAt: new Date().toISOString()
        });
    },
    PromptPlannerStrategy: class {
        plan = vi.fn().mockResolvedValue({
            goal: "Goal",
            strategy: "Prompt Strategy",
            steps: [
                { id: "s1", description: "S1", tool: "t1", params: {}, hypothesis: "H1", risk: "low", status: "pending" }
            ],
            createdAt: new Date().toISOString()
        });
    }
}));

vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn(),
    })),
}));

import { AutonomousLifecycleManager } from "@domain/ai/core/autonomous-lifecycle.service.js";

describe("AutonomousLifecycleManager", () => {
    const mockClient = { execute: vi.fn() };
    let manager: AutonomousLifecycleManager;

    beforeEach(() => {
        vi.clearAllMocks();
        manager = new AutonomousLifecycleManager("s1", 1, mockClient as any, "key");
    });

    describe("plan", () => {
        it("should parse AI output into TaskManifest", async () => {
            const mockManifest = {
                goal: "Goal",
                strategy: "Strategy",
                steps: [
                    { id: "s1", description: "S1", tool: "t1", params: {}, hypothesis: "H1", risk: "low", status: "pending" }
                ],
                createdAt: new Date().toISOString()
            };

            mockClient.execute.mockResolvedValue({
                success: true,
                output: "```json\n" + JSON.stringify(mockManifest) + "\n```"
            });

            const manifest = await manager.plan("Goal", [{ name: "t1" }]);
            expect(manifest.goal).toBe("Goal");
            expect(manifest.steps).toHaveLength(1);
        });
    });

    describe("alert", () => {
        it("should auto-proceed for low risk steps", async () => {
            const step: any = { risk: "low", tool: "read_file" };
            const result = await manager.alert(step);
            expect(result.proceed).toBe(true);
        });
    });

    describe("verifyManifest", () => {
        it("rejects plans with missing dependencies and duplicate step ids", async () => {
            const result = await manager.verifyManifest({
                goal: "Ship the objective",
                strategy: "Execute and verify",
                successCriteria: ["The objective is shipped"],
                steps: [
                    { id: "s1", description: "First", tool: "t1", params: {}, hypothesis: "done", completionCriteria: ["output exists"], risk: "low", status: "pending", estimatedTokens: 100, dependencies: [] },
                    { id: "s1", description: "Second", tool: "t1", params: {}, hypothesis: "done", completionCriteria: ["output exists"], risk: "low", status: "pending", estimatedTokens: 100, dependencies: ["missing"] },
                ],
                createdAt: new Date().toISOString(),
                riskLevel: "low",
            });

            expect(result.valid).toBe(false);
            expect(result.blockers).toContain('Duplicate step id: "s1".');
            expect(result.blockers).toContain('Step "s1" depends on unknown step "missing".');
        });
    });

    describe("verify", () => {
        it("uses verification-specific parameters when provided", async () => {
            const executeTool = vi.fn().mockResolvedValue("verified");
            const step: any = {
                id: "s1",
                tool: "write_file",
                params: { path: "output.txt", content: "hello" },
                verificationTool: "read_file",
                verificationParams: { path: "output.txt" },
            };

            const result = await manager.verify(step, "written", executeTool);

            expect(result.success).toBe(true);
            expect(executeTool).toHaveBeenCalledWith("read_file", { path: "output.txt" });
        });
    });
});
