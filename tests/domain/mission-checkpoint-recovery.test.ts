import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    missionCheckpointService,
    MissionCheckpoint,
} from "@server/domain/ai/core/mission-checkpoint.service.js";
import {
    AutonomousLifecycleManager,
    TaskManifest,
} from "@server/domain/ai/core/autonomous-lifecycle.service.js";

// Mock Sentinel and Budget services so unit tests don't require external database connection
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

describe("MissionCheckpointService & Asynchronous Autonomous Recovery", () => {
    const testSessionId = "test-session-checkpoint-123";

    beforeEach(() => {
        missionCheckpointService.reset();
    });

    const mockManifest: TaskManifest = {
        goal: "Refactor database migrations and update service models",
        strategy: "Stepwise AST transformation with verification",
        successCriteria: ["All migrations applied cleanly"],
        steps: [
            {
                id: "step-1",
                description: "Inspect schema definition",
                tool: "read_file",
                params: { path: "schema.ts" },
                hypothesis: "Schema contains valid Drizzle tables",
                completionCriteria: ["File content is returned"],
                risk: "low",
                status: "pending",
                dependencies: [],
            },
            {
                id: "step-2",
                description: "Generate AST migration chunk",
                tool: "scaffold_tool",
                params: { table: "users" },
                hypothesis: "Generates correct TypeScript migration",
                completionCriteria: ["Valid TypeScript AST generated"],
                risk: "medium",
                status: "pending",
                dependencies: ["step-1"],
            },
            {
                id: "step-3",
                description: "Run schema migration runner",
                tool: "execute_migration",
                params: { env: "test" },
                hypothesis: "Migration executes without syntax errors",
                completionCriteria: ["Database responds with migration applied"],
                risk: "high",
                status: "pending",
                dependencies: ["step-2"],
            },
            {
                id: "step-4",
                description: "Validate database foreign key constraints",
                tool: "validate_db",
                params: {},
                hypothesis: "Constraints intact",
                completionCriteria: ["Verification passes"],
                risk: "low",
                status: "pending",
                dependencies: ["step-3"],
            },
        ],
        createdAt: new Date().toISOString(),
        riskLevel: "medium",
    };

    it("1. Persists sequential verified checkpoints and tracks completed step IDs", () => {
        const res1 = missionCheckpointService.recordStepOutcome({
            sessionId: testSessionId,
            missionId: 101,
            agentId: 42,
            stepId: "step-1",
            stepIndex: 0,
            totalSteps: 4,
            success: true,
            memorySnapshot: { fileRead: true },
        });

        expect(res1.circuitBreakerTripped).toBe(false);
        expect(res1.checkpoint.status).toBe("verified");
        expect(res1.checkpoint.completedStepIds).toEqual(["step-1"]);
        expect(res1.checkpoint.consecutiveFailures).toBe(0);

        const res2 = missionCheckpointService.recordStepOutcome({
            sessionId: testSessionId,
            missionId: 101,
            agentId: 42,
            stepId: "step-2",
            stepIndex: 1,
            totalSteps: 4,
            success: true,
            memorySnapshot: { astBuilt: true },
        });

        expect(res2.checkpoint.status).toBe("verified");
        expect(res2.checkpoint.completedStepIds).toEqual(["step-1", "step-2"]);
        expect(res2.checkpoint.workingMemorySnapshot).toEqual({ astBuilt: true });

        const latest = missionCheckpointService.getLatestCheckpoint(testSessionId);
        expect(latest?.checkpointId).toBe(res2.checkpoint.checkpointId);
    });

    it("2. Resumes interrupted manifest by fast-forwarding over verified steps", () => {
        // Simulate steps 1 and 2 already verified in previous wave
        missionCheckpointService.recordStepOutcome({
            sessionId: testSessionId,
            agentId: 42,
            stepId: "step-1",
            stepIndex: 0,
            totalSteps: 4,
            success: true,
        });
        missionCheckpointService.recordStepOutcome({
            sessionId: testSessionId,
            agentId: 42,
            stepId: "step-2",
            stepIndex: 1,
            totalSteps: 4,
            success: true,
        });

        const resumePlan = missionCheckpointService.getResumePlan(testSessionId, mockManifest.steps);

        expect(resumePlan.canResume).toBe(true);
        expect(resumePlan.completedStepIds).toEqual(["step-1", "step-2"]);
        expect(resumePlan.pendingSteps.length).toBe(2);
        expect(resumePlan.pendingSteps.map((s) => s.id)).toEqual(["step-3", "step-4"]);
    });

    it("3. Trips 3-strike circuit breaker on consecutive verification failures", () => {
        // Step 1 succeeds
        missionCheckpointService.recordStepOutcome({
            sessionId: testSessionId,
            agentId: 42,
            stepId: "step-1",
            stepIndex: 0,
            totalSteps: 4,
            success: true,
        });

        // Strike 1
        const strike1 = missionCheckpointService.recordStepOutcome({
            sessionId: testSessionId,
            agentId: 42,
            stepId: "step-2",
            stepIndex: 1,
            totalSteps: 4,
            success: false,
        });
        expect(strike1.circuitBreakerTripped).toBe(false);
        expect(strike1.checkpoint.consecutiveFailures).toBe(1);

        // Strike 2
        const strike2 = missionCheckpointService.recordStepOutcome({
            sessionId: testSessionId,
            agentId: 42,
            stepId: "step-2",
            stepIndex: 1,
            totalSteps: 4,
            success: false,
        });
        expect(strike2.circuitBreakerTripped).toBe(false);
        expect(strike2.checkpoint.consecutiveFailures).toBe(2);

        // Strike 3 -> Circuit breaker trips!
        const strike3 = missionCheckpointService.recordStepOutcome({
            sessionId: testSessionId,
            agentId: 42,
            stepId: "step-2",
            stepIndex: 1,
            totalSteps: 4,
            success: false,
        });
        expect(strike3.circuitBreakerTripped).toBe(true);
        expect(strike3.checkpoint.status).toBe("circuit_breaker_tripped");
        expect(strike3.checkpoint.consecutiveFailures).toBe(3);
        expect(strike3.reason).toContain("Circuit breaker tripped: 3 consecutive failures");
    });

    it("4. Automatically rolls back to the last clean verified checkpoint", () => {
        // Step 1 verified
        missionCheckpointService.recordStepOutcome({
            sessionId: testSessionId,
            agentId: 42,
            stepId: "step-1",
            stepIndex: 0,
            totalSteps: 4,
            success: true,
            memorySnapshot: { stableState: "schema_v1" },
        });

        // Step 2 fails 3 times and trips circuit breaker
        for (let i = 0; i < 3; i++) {
            missionCheckpointService.recordStepOutcome({
                sessionId: testSessionId,
                agentId: 42,
                stepId: "step-2",
                stepIndex: 1,
                totalSteps: 4,
                success: false,
            });
        }

        // Trigger rollback
        const rollbackResult = missionCheckpointService.rollbackToLastClean(testSessionId);

        expect(rollbackResult.rolledBack).toBe(true);
        expect(rollbackResult.checkpoint?.stepId).toBe("step-1");
        expect(rollbackResult.checkpoint?.status).toBe("rolled_back");
        expect(rollbackResult.checkpoint?.workingMemorySnapshot).toEqual({ stableState: "schema_v1" });
        expect(rollbackResult.checkpoint?.consecutiveFailures).toBe(0);
    });

    it("5. AutonomousLifecycleManager seamlessly integrates checkpoint verification and resumption", async () => {
        const manager = new AutonomousLifecycleManager(testSessionId, 42);

        // Verify a successful step through the manager
        const step1 = mockManifest.steps[0];
        const resSuccess = await manager.verify(
            step1,
            JSON.stringify({ content: "export const table = ..." }),
            async () => "ok",
            120,
            0,
            4
        );

        expect(resSuccess.success).toBe(true);
        expect(resSuccess.checkpoint?.status).toBe("verified");
        expect(resSuccess.circuitBreakerTripped).toBe(false);

        // Resume plan on manager fast-forwards over step 1
        const resumePlan = manager.getResumePlan(mockManifest);
        expect(resumePlan.canResume).toBe(true);
        expect(resumePlan.pendingSteps.length).toBe(3);
        expect(resumePlan.pendingSteps[0].id).toBe("step-2");

        // Simulate 3 failures through the manager on step 2
        const step2 = mockManifest.steps[1];
        let trippedRes;
        for (let i = 0; i < 3; i++) {
            trippedRes = await manager.verify(
                step2,
                "Error: Failed to compile AST syntax",
                async () => "error",
                50,
                1,
                4
            );
        }

        expect(trippedRes?.success).toBe(false);
        expect(trippedRes?.circuitBreakerTripped).toBe(true);
        expect(trippedRes?.circuitBreakerReason).toContain("Circuit breaker tripped");

        // Roll back through the manager
        const rollback = manager.rollbackToLastCleanCheckpoint();
        expect(rollback.rolledBack).toBe(true);
        expect(rollback.checkpoint?.stepId).toBe("step-1");
    });
});
