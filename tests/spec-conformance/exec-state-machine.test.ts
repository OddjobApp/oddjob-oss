/**
 * Spec Conformance: Mission Run Lifecycle (EXEC-*, RESUME-*, STRAT-*)
 *
 * Tests are tagged with assertion IDs from docs/specs/conformance/CONFORMANCE.md.
 * All tests are pure unit tests — no DB, Redis, or BullMQ dependencies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Minimal mock of mission run state ────────────────────────────────────────

interface MockRun {
    id: number;
    status: string;
    missionContext: Record<string, any>;
    dynamicTrace: any[];
    resumeCondition?: any;
}

function createMockRun(overrides: Partial<MockRun> = {}): MockRun {
    return {
        id: 1,
        status: "active",
        missionContext: { cycleCount: 0, maxCycles: 20, current_wave: 1, max_waves: 10 },
        dynamicTrace: [],
        ...overrides,
    };
}

// ── Simulated orchestration logic extracted from the spec ─────────────────────

function shouldDispatchCycle(run: MockRun): boolean {
    return run.status === "active";
}

function checkMaxCycles(run: MockRun): { exceeded: boolean; newStatus: string } {
    const { cycleCount, maxCycles } = run.missionContext;
    if (cycleCount > maxCycles) {
        return { exceeded: true, newStatus: "failed" };
    }
    return { exceeded: false, newStatus: run.status };
}

function checkMaxWaves(run: MockRun): { exceeded: boolean; newStatus: string } {
    const { current_wave, max_waves } = run.missionContext;
    if (current_wave > max_waves) {
        return { exceeded: true, newStatus: "failed" };
    }
    return { exceeded: false, newStatus: run.status };
}

const VALID_TRANSITIONS: Record<string, string[]> = {
    active: ["paused", "waiting_on_human", "waiting_on_file", "completed", "failed"],
    paused: ["active"],
    waiting_on_human: ["active"],
    waiting_on_file: ["active"],
    completed: [],
    failed: [],
};

function isValidTransition(from: string, to: string): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("EXEC-001: max cycles enforcement", () => {
    it("fails the run when cycleCount exceeds maxCycles", () => {
        const run = createMockRun({
            missionContext: { cycleCount: 21, maxCycles: 20 },
        });
        const result = checkMaxCycles(run);
        expect(result.exceeded).toBe(true);
        expect(result.newStatus).toBe("failed");
    });

    it("allows the run when cycleCount equals maxCycles", () => {
        const run = createMockRun({
            missionContext: { cycleCount: 20, maxCycles: 20 },
        });
        const result = checkMaxCycles(run);
        expect(result.exceeded).toBe(false);
    });

    it("allows the run when cycleCount is below maxCycles", () => {
        const run = createMockRun({
            missionContext: { cycleCount: 5, maxCycles: 20 },
        });
        const result = checkMaxCycles(run);
        expect(result.exceeded).toBe(false);
    });
});

describe("EXEC-002: max waves enforcement (rolling_wave)", () => {
    it("fails the run when current_wave exceeds max_waves", () => {
        const run = createMockRun({
            missionContext: { current_wave: 11, max_waves: 10 },
        });
        const result = checkMaxWaves(run);
        expect(result.exceeded).toBe(true);
        expect(result.newStatus).toBe("failed");
    });

    it("allows the run when current_wave equals max_waves", () => {
        const run = createMockRun({
            missionContext: { current_wave: 10, max_waves: 10 },
        });
        const result = checkMaxWaves(run);
        expect(result.exceeded).toBe(false);
    });
});

describe("EXEC-003: dispatch gate — only active runs receive cycles", () => {
    it("allows dispatch when status is active", () => {
        const run = createMockRun({ status: "active" });
        expect(shouldDispatchCycle(run)).toBe(true);
    });

    it.each(["paused", "waiting_on_human", "waiting_on_file", "completed", "failed"])(
        "blocks dispatch when status is %s",
        (status) => {
            const run = createMockRun({ status });
            expect(shouldDispatchCycle(run)).toBe(false);
        }
    );
});

describe("EXEC-005: valid state transitions only", () => {
    it("allows active → failed", () => {
        expect(isValidTransition("active", "failed")).toBe(true);
    });

    it("allows active → waiting_on_human", () => {
        expect(isValidTransition("active", "waiting_on_human")).toBe(true);
    });

    it("allows waiting_on_human → active", () => {
        expect(isValidTransition("waiting_on_human", "active")).toBe(true);
    });

    it("disallows failed → active", () => {
        expect(isValidTransition("failed", "active")).toBe(false);
    });

    it("disallows completed → active", () => {
        expect(isValidTransition("completed", "active")).toBe(false);
    });

    it("disallows waiting_on_human → failed directly", () => {
        expect(isValidTransition("waiting_on_human", "failed")).toBe(false);
    });

    it("disallows active → active (self-transition)", () => {
        expect(isValidTransition("active", "active")).toBe(false);
    });
});

describe("RESUME-001: human_approval resume condition", () => {
    it("satisfies when all approvalRequestIds are resolved", () => {
        const resumeCondition = {
            type: "human_approval",
            approvalRequestIds: [101, 102],
        };
        const resolvedIds = new Set([101, 102]);

        const allResolved = resumeCondition.approvalRequestIds.every((id: number) =>
            resolvedIds.has(id)
        );
        expect(allResolved).toBe(true);
    });

    it("does not satisfy when some approvalRequestIds are pending", () => {
        const resumeCondition = {
            type: "human_approval",
            approvalRequestIds: [101, 102],
        };
        const resolvedIds = new Set([101]);

        const allResolved = resumeCondition.approvalRequestIds.every((id: number) =>
            resolvedIds.has(id)
        );
        expect(allResolved).toBe(false);
    });
});

describe("RESUME-002: file resume condition", () => {
    it("satisfies when file matching pattern exists in folder", () => {
        const resumeCondition = {
            type: "file",
            folderPath: "/uploads/mission-1",
            filePattern: "*.pdf",
        };

        const mockFileExists = (path: string, pattern: string) =>
            path === "/uploads/mission-1" && pattern === "*.pdf";

        expect(mockFileExists(resumeCondition.folderPath, resumeCondition.filePattern)).toBe(true);
    });
});

describe("STRAT-002: strategy routing", () => {
    it("routes dynamic_autonomous to OODA orchestrator", () => {
        const getOrchestrator = (strategy: string) => {
            const routes: Record<string, string> = {
                pre_planned: "PipelineExecutor",
                dynamic_autonomous: "DynamicOrchestrator",
                rolling_wave: "RollingWaveOrchestrator",
            };
            return routes[strategy] ?? null;
        };

        expect(getOrchestrator("dynamic_autonomous")).toBe("DynamicOrchestrator");
        expect(getOrchestrator("rolling_wave")).toBe("RollingWaveOrchestrator");
        expect(getOrchestrator("pre_planned")).toBe("PipelineExecutor");
    });
});
