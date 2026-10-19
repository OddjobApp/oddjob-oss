import { describe, it, expect, beforeEach, vi } from "vitest";
import { missionBudgetGovernor } from "@domain/ai/core/mission-budget-governor.service.js";
import { missionCheckpointService } from "@domain/ai/core/mission-checkpoint.service.js";
import { AutonomousMissionWorker } from "@domain/ai/infrastructure/autonomous-mission.worker.js";
import { AUTONOMOUS_MISSION_TOOLS } from "@domain/tools/v1/capabilities/autonomous-mission-tools.js";
import type { TaskManifest } from "@domain/ai/core/autonomous-lifecycle.service.js";

// Mock dependencies that require live external servers
vi.mock("@domain/core/infrastructure/redis/redis-client.js", async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        getRedisClient: () => null,
        getRedisOptions: () => ({ host: "localhost", port: 6379 }),
        nodeRedisClient: null,
    };
});

vi.mock("@domain/mission/core/sentinel-service.js", () => ({
    SentinelService: {
        logSuccess: vi.fn().mockResolvedValue(undefined),
        logFailure: vi.fn().mockResolvedValue(undefined),
        getSkillHealth: vi.fn().mockResolvedValue({ reliabilityIndex: 90, totalRuns: 10 }),
    },
}));

vi.mock("@domain/governor/core/budget-governance.service.js", () => ({
    BudgetGovernanceService: {
        checkAgentSalary: vi.fn().mockResolvedValue({ allowed: true }),
        recordSpend: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock("@server/workers/base-worker.js", () => {
    return {
        BaseWorker: class MockBaseWorker {
            protected name = "MockWorker";
            protected logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
            constructor(queueName: string, options?: any) {}
        }
    };
});

describe("Superagent Phase III: Autonomous Mission Daemons & Budget Quotas", () => {
    const testSessionId = "session-daemon-test-101";
    const testMissionId = "mission-alpha-99";

    beforeEach(async () => {
        await missionBudgetGovernor.reset(testSessionId, testMissionId);
        missionCheckpointService.clearCheckpoints(testSessionId);
    });

    describe("1. MissionBudgetGovernor Envelopes", () => {
        it("initializes and enforces token budgets with soft warnings and hard stops", async () => {
            await missionBudgetGovernor.setMissionBudget(testSessionId, testMissionId, 10_000, 5.0, 0.8);

            // Step 1: 5,000 tokens (50% - normal)
            let check = await missionBudgetGovernor.checkBudget(testSessionId, testMissionId, 5_000);
            expect(check.allowed).toBe(true);
            expect(check.status).toBe("active");

            await missionBudgetGovernor.recordSpend(testSessionId, testMissionId, 5_000);
            const budgetAfter1 = await missionBudgetGovernor.getMissionBudget(testSessionId, testMissionId);
            expect(budgetAfter1?.tokensUsed).toBe(5_000);
            expect(budgetAfter1?.status).toBe("active");

            // Step 2: 3,500 tokens (85% - trips soft warning)
            await missionBudgetGovernor.recordSpend(testSessionId, testMissionId, 3_500);
            const budgetAfter2 = await missionBudgetGovernor.getMissionBudget(testSessionId, testMissionId);
            expect(budgetAfter2?.tokensUsed).toBe(8_500);
            expect(budgetAfter2?.status).toBe("warning");

            // Step 3: checkBudget for 2,000 tokens (would reach 10,500 > 10,000 limit)
            check = await missionBudgetGovernor.checkBudget(testSessionId, testMissionId, 2_000);
            expect(check.allowed).toBe(false);
            expect(check.status).toBe("exhausted");

            // Step 4: Increase budget by +10,000 tokens (HIL approval simulation)
            const increased = await missionBudgetGovernor.increaseBudget(testSessionId, testMissionId, 10_000);
            expect(increased.tokenBudget).toBe(20_000);
            expect(increased.status).toBe("active");

            // Re-check now succeeds
            check = await missionBudgetGovernor.checkBudget(testSessionId, testMissionId, 2_000);
            expect(check.allowed).toBe(true);
        });
    });

    describe("2. AutonomousMissionWorker Execution & Checkpointing", () => {
        it("executes multi-step manifests and records step checkpoints", async () => {
            const manifest: TaskManifest = {
                goal: "Analyze spatial telemetry and generate brief",
                steps: [
                    {
                        id: "step-1",
                        tool: "query_h3_spatial_nodes",
                        description: "Extract active cluster coordinates",
                        completionCriteria: ["Coordinates extracted"],
                        estimatedTokens: 1000,
                    },
                    {
                        id: "step-2",
                        tool: "compile_telemetry_report",
                        description: "Format spatial metrics table",
                        completionCriteria: ["Table compiled"],
                        dependencies: ["step-1"],
                        estimatedTokens: 1200,
                    },
                ],
            };

            const worker = new AutonomousMissionWorker();
            
            // Invoke execute directly with mock job
            const mockJob: any = {
                data: {
                    missionId: testMissionId,
                    sessionId: testSessionId,
                    agentId: 42,
                    organizationId: 1,
                    manifest,
                    tokenBudget: 50_000,
                    resumeFromCheckpoint: false,
                },
            };

            // Mock lifecycle methods on the worker's internal manager
            const result = await (worker as any).execute(mockJob);

            expect(result.success).toBe(true);
            expect(result.status).toBe("completed");
            expect(result.completedSteps).toEqual(["step-1", "step-2"]);

            // Verify checkpoints were recorded
            const latestCheckpoint = await missionCheckpointService.getLatestCheckpoint(testSessionId);
            expect(latestCheckpoint?.status).toBe("verified");
            expect(latestCheckpoint?.stepId).toBe("step-2");
            expect(latestCheckpoint?.completedStepIds).toContain("step-1");
            expect(latestCheckpoint?.completedStepIds).toContain("step-2");
        });

        it("pauses execution cleanly when token budget ceiling is hit", async () => {
            const manifest: TaskManifest = {
                goal: "Compute heavy deep learning matrix",
                steps: [
                    {
                        id: "step-1",
                        tool: "initialize_parameters",
                        description: "Init weights",
                        completionCriteria: ["Weights initialized"],
                        estimatedTokens: 2000,
                    },
                    {
                        id: "step-2",
                        tool: "train_weights_iteration",
                        description: "Heavy matrix multiply",
                        completionCriteria: ["Iteration complete"],
                        dependencies: ["step-1"],
                        estimatedTokens: 5000, // Will exceed 4,000 budget!
                    },
                ],
            };

            // Set small budget of 4,000 tokens
            await missionBudgetGovernor.setMissionBudget(testSessionId, testMissionId, 4_000);

            const worker = new AutonomousMissionWorker();
            const mockJob: any = {
                data: {
                    missionId: testMissionId,
                    sessionId: testSessionId,
                    agentId: 42,
                    organizationId: 1,
                    manifest,
                    tokenBudget: 4_000,
                    resumeFromCheckpoint: false,
                },
            };

            const result = await (worker as any).execute(mockJob);

            expect(result.success).toBe(false);
            expect(result.status).toBe("budget_paused");
            expect(result.completedSteps).toEqual(["step-1"]);
            expect(result.lastCheckpointId).toBeDefined();

            // Verify saved checkpoint reflects paused state
            const checkpoint = await missionCheckpointService.getLatestCheckpoint(testSessionId);
            expect(checkpoint?.status).toBe("paused");
            expect(checkpoint?.stepId).toBe("step-2");
            expect(checkpoint?.completedStepIds).toEqual(["step-1"]);
        });

        it("resumes an interrupted mission from checkpoint without repeating finished steps", async () => {
            const manifest: TaskManifest = {
                goal: "Multi-stage pipeline",
                steps: [
                    { id: "step-1", tool: "step1", description: "Step 1", completionCriteria: ["done"] },
                    { id: "step-2", tool: "step2", description: "Step 2", completionCriteria: ["done"], dependencies: ["step-1"] },
                    { id: "step-3", tool: "step3", description: "Step 3", completionCriteria: ["done"], dependencies: ["step-2"] },
                ],
            };

            // Pre-seed checkpoint having completed step-1 and step-2
            await missionCheckpointService.saveCheckpoint({
                sessionId: testSessionId,
                missionId: testMissionId,
                agentId: 42,
                stepId: "step-2",
                stepIndex: 2,
                status: "verified",
                workingMemorySnapshot: { step1: "done", step2: "done" },
                completedStepIds: ["step-1", "step-2"],
                consecutiveFailures: 0,
            });

            const worker = new AutonomousMissionWorker();
            const mockJob: any = {
                data: {
                    missionId: testMissionId,
                    sessionId: testSessionId,
                    agentId: 42,
                    organizationId: 1,
                    manifest,
                    tokenBudget: 50_000,
                    resumeFromCheckpoint: true,
                },
            };

            const result = await (worker as any).execute(mockJob);

            expect(result.success).toBe(true);
            expect(result.status).toBe("completed");
            // Only step-3 needed to be executed
            expect(result.completedSteps).toEqual(["step-3"]);
        });
    });

    describe("3. Autonomous Mission Agent Tools", () => {
        it("get_autonomous_mission_status returns latest checkpoint and budget state", async () => {
            await missionBudgetGovernor.setMissionBudget(testSessionId, testMissionId, 30_000);
            await missionBudgetGovernor.recordSpend(testSessionId, testMissionId, 6_000);

            await missionCheckpointService.saveCheckpoint({
                sessionId: testSessionId,
                missionId: testMissionId,
                agentId: 7,
                stepId: "step-prep",
                stepIndex: 1,
                status: "verified",
                workingMemorySnapshot: { ready: true },
                completedStepIds: ["step-prep"],
                consecutiveFailures: 0,
            });

            const tool = AUTONOMOUS_MISSION_TOOLS.get_autonomous_mission_status;
            const res = JSON.parse(
                await tool.execute({ sessionId: testSessionId, missionId: testMissionId }, {})
            );

            expect(res.success).toBe(true);
            expect(res.currentStepId).toBe("step-prep");
            expect(res.status).toBe("verified");
            expect(res.completedSteps).toContain("step-prep");
            expect(res.budget.tokensUsed).toBe(6_000);
            expect(res.budget.tokenBudget).toBe(30_000);
        });
    });
});
