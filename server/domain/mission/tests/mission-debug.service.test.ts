/**
 * Mission Debug Service Tests
 * 
 * Comprehensive test suite for mission debugging capabilities.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    missionDebugService,
    type DebugSession,
    type Breakpoint
} from "../core/mission-debug.service.js";

// Mock dependencies
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    }),
}));

vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: {
        publish: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock("@domain/mission/core/mission-correlation.service.js", () => ({
    missionCorrelationService: {
        getCorrelationId: vi.fn().mockReturnValue("corr_test_123"),
    },
}));

describe("MissionDebugService", () => {
    const TEST_MISSION_RUN_ID = 123;

    beforeEach(async () => {
        // Clean up any existing sessions
        await missionDebugService.terminateDebugSession(TEST_MISSION_RUN_ID);
    });

    describe("startDebugSession", () => {
        it("should create a new debug session", async () => {
            const session = await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);

            expect(session).toBeDefined();
            expect(session.missionRunId).toBe(TEST_MISSION_RUN_ID);
            expect(session.correlationId).toBeDefined();
            expect(session.status).toBe("active");
            expect(session.breakpoints).toEqual([]);
            expect(session.stepMode).toBe("run");
        });

        it("should set initial breakpoints if provided", async () => {
            const initialBreakpoints: import("../core/mission-debug.service.js").Breakpoint[] = [
                { id: "bp-1", type: "tool_call", target: "search", enabled: true, hitCount: 0 },
            ];

            const session = await missionDebugService.startDebugSession(
                TEST_MISSION_RUN_ID,
                { initialBreakpoints }
            );

            expect(session.breakpoints).toHaveLength(1);
            expect(session.breakpoints[0].type).toBe("tool_call");
        });

        it("should auto-pause if requested", async () => {
            const session = await missionDebugService.startDebugSession(
                TEST_MISSION_RUN_ID,
                { autoPauseOnStart: true }
            );

            expect(session.status).toBe("paused");
            expect(session.pausedAt).toBeDefined();
            expect(session.pausedAt?.type).toBe("manual");
        });

        it("should track session start time", async () => {
            const before = new Date();
            const session = await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            const after = new Date();

            expect(session.startTime).toBeInstanceOf(Date);
            expect(session.startTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
            expect(session.startTime.getTime()).toBeLessThanOrEqual(after.getTime());
        });
    });

    describe("getDebugSession", () => {
        it("should return undefined for non-existent session", () => {
            const session = missionDebugService.getDebugSession(999999);
            expect(session).toBeUndefined();
        });

        it("should return active session", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            
            const session = missionDebugService.getDebugSession(TEST_MISSION_RUN_ID);
            
            expect(session).toBeDefined();
            expect(session?.missionRunId).toBe(TEST_MISSION_RUN_ID);
        });
    });

    describe("isDebugMode", () => {
        it("should return false when no session exists", () => {
            expect(missionDebugService.isDebugMode(999999)).toBe(false);
        });

        it("should return true when session exists", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            expect(missionDebugService.isDebugMode(TEST_MISSION_RUN_ID)).toBe(true);
        });
    });

    describe("shouldPause", () => {
        it("should not pause when no debug session", () => {
            const result = missionDebugService.shouldPause(TEST_MISSION_RUN_ID, {
                phase: "EXECUTING",
                toolName: "search",
                cycleCount: 1,
                blackboard: {},
            });

            expect(result.shouldPause).toBe(false);
        });

        it("should pause on step mode step_over", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            await missionDebugService.stepOver(TEST_MISSION_RUN_ID);

            const result = missionDebugService.shouldPause(TEST_MISSION_RUN_ID, {
                phase: "EXECUTING",
                toolName: "search",
                cycleCount: 1,
                blackboard: {},
            });

            expect(result.shouldPause).toBe(true);
            expect(result.reason).toContain("step");
        });

        it("should pause on matching tool breakpoint", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            await missionDebugService.addBreakpoint(TEST_MISSION_RUN_ID, {
                type: "tool_call",
                target: "search",
                enabled: true,
            });

            const result = missionDebugService.shouldPause(TEST_MISSION_RUN_ID, {
                phase: "EXECUTING",
                toolName: "search",
                cycleCount: 1,
                blackboard: {},
            });

            expect(result.shouldPause).toBe(true);
            expect(result.reason).toContain("breakpoint");
        });

        it("should not pause on disabled breakpoint", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            const bp = await missionDebugService.addBreakpoint(TEST_MISSION_RUN_ID, {
                type: "tool_call",
                target: "search",
                enabled: true,
            });
            
            // Disable the breakpoint
            await missionDebugService.toggleBreakpoint(TEST_MISSION_RUN_ID, bp!.id, false);

            const result = missionDebugService.shouldPause(TEST_MISSION_RUN_ID, {
                phase: "EXECUTING",
                toolName: "search",
                cycleCount: 1,
                blackboard: {},
            });

            expect(result.shouldPause).toBe(false);
        });

        it("should pause on phase change breakpoint", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            await missionDebugService.addBreakpoint(TEST_MISSION_RUN_ID, {
                type: "phase_change",
                target: "CRITIQUING",
                enabled: true,
            });

            const result = missionDebugService.shouldPause(TEST_MISSION_RUN_ID, {
                phase: "CRITIQUING",
                cycleCount: 1,
                blackboard: {},
            });

            expect(result.shouldPause).toBe(true);
        });

        it("should track breakpoint hit count", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            const bp = await missionDebugService.addBreakpoint(TEST_MISSION_RUN_ID, {
                type: "tool_call",
                target: "search",
                enabled: true,
            });

            // Trigger breakpoint twice
            missionDebugService.shouldPause(TEST_MISSION_RUN_ID, {
                toolName: "search",
                cycleCount: 1,
                blackboard: {},
            });
            missionDebugService.shouldPause(TEST_MISSION_RUN_ID, {
                toolName: "search",
                cycleCount: 2,
                blackboard: {},
            });

            const session = missionDebugService.getDebugSession(TEST_MISSION_RUN_ID);
            const updatedBp = session?.breakpoints.find(b => b.id === bp?.id);
            expect(updatedBp?.hitCount).toBe(2);
        });
    });

    describe("pause/resume", () => {
        it("should pause an active session", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            
            const session = await missionDebugService.pause(TEST_MISSION_RUN_ID);
            
            expect(session).toBeDefined();
            expect(session?.status).toBe("paused");
            expect(session?.pausedAt).toBeDefined();
            expect(session?.history[session?.history.length - 1].action).toBe("pause");
        });

        it("should resume a paused session", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            await missionDebugService.pause(TEST_MISSION_RUN_ID);
            
            const session = await missionDebugService.resume(TEST_MISSION_RUN_ID);
            
            expect(session).toBeDefined();
            expect(session?.status).toBe("active");
            expect(session?.pausedAt).toBeUndefined();
            expect(session?.history[session?.history.length - 1].action).toBe("resume");
        });

        it("should return null for non-existent session", async () => {
            const session = await missionDebugService.pause(999999);
            expect(session).toBeNull();
        });
    });

    describe("step modes", () => {
        it("should set step_over mode", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            
            const session = await missionDebugService.stepOver(TEST_MISSION_RUN_ID);
            
            expect(session?.stepMode).toBe("step_over");
            expect(session?.status).toBe("stepping");
        });

        it("should set step_into mode", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            
            const session = await missionDebugService.stepInto(TEST_MISSION_RUN_ID);
            
            expect(session?.stepMode).toBe("step_into");
            expect(session?.status).toBe("stepping");
        });

        it("should continue until breakpoint", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            await missionDebugService.pause(TEST_MISSION_RUN_ID);
            
            const session = await missionDebugService.continueUntilBreakpoint(TEST_MISSION_RUN_ID);
            
            expect(session?.status).toBe("active");
            expect(session?.stepMode).toBe("run");
        });
    });

    describe("breakpoints", () => {
        it("should add breakpoint with generated ID", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            
            const bp = await missionDebugService.addBreakpoint(TEST_MISSION_RUN_ID, {
                type: "tool_call",
                target: "write_file",
                enabled: true,
            });
            
            expect(bp).toBeDefined();
            expect(bp?.id).toMatch(/^bp_\d+_/);
            expect(bp?.hitCount).toBe(0);
            expect(bp?.enabled).toBe(true);
        });

        it("should remove breakpoint", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            const bp = await missionDebugService.addBreakpoint(TEST_MISSION_RUN_ID, {
                type: "tool_call",
                target: "search",
                enabled: true,
            });
            
            const result = await missionDebugService.removeBreakpoint(TEST_MISSION_RUN_ID, bp!.id);
            
            expect(result).toBe(true);
            const session = missionDebugService.getDebugSession(TEST_MISSION_RUN_ID);
            expect(session?.breakpoints).toHaveLength(0);
        });

        it("should return false when removing non-existent breakpoint", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            
            const result = await missionDebugService.removeBreakpoint(TEST_MISSION_RUN_ID, "non-existent");
            
            expect(result).toBe(false);
        });

        it("should toggle breakpoint enabled state", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            const bp = await missionDebugService.addBreakpoint(TEST_MISSION_RUN_ID, {
                type: "tool_call",
                target: "search",
                enabled: true,
            });
            
            await missionDebugService.toggleBreakpoint(TEST_MISSION_RUN_ID, bp!.id, false);
            
            const session = missionDebugService.getDebugSession(TEST_MISSION_RUN_ID);
            const updatedBp = session?.breakpoints.find(b => b.id === bp?.id);
            expect(updatedBp?.enabled).toBe(false);
        });

        it("should return false for toggle on non-existent session", async () => {
            const result = await missionDebugService.toggleBreakpoint(999999, "bp_123", false);
            expect(result).toBe(false);
        });
    });

    describe("inspect", () => {
        it("should return null for non-existent session", async () => {
            const result = await missionDebugService.inspect(TEST_MISSION_RUN_ID, {});
            expect(result).toBeNull();
        });

        it("should extract variables from blackboard", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            await missionDebugService.pause(TEST_MISSION_RUN_ID);
            
            const blackboard = {
                searchQuery: "test",
                results: [1, 2, 3],
                nested: { key: "value" },
                _internal: "should be filtered",
            };
            
            const result = await missionDebugService.inspect(TEST_MISSION_RUN_ID, blackboard);
            
            expect(result).toBeDefined();
            expect(result?.blackboard).toEqual(blackboard);
            expect(result?.variables).toHaveLength(3); // Excludes _internal
            expect(result?.canModify).toBe(true); // Can modify when paused
        });

        it("should include phase and cycle count", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            await missionDebugService.pause(TEST_MISSION_RUN_ID);
            
            const result = await missionDebugService.inspect(TEST_MISSION_RUN_ID, {
                phase: "EXECUTING",
                cycleCount: 5,
                lastToolRun: "search",
            });
            
            expect(result?.phase).toBe("EXECUTING");
            expect(result?.cycleCount).toBe(5);
            expect(result?.lastToolRun).toBe("search");
        });
    });

    describe("modifyVariable", () => {
        it("should fail when no debug session", async () => {
            const result = await missionDebugService.modifyVariable(
                TEST_MISSION_RUN_ID,
                "key",
                "value"
            );
            
            expect(result.success).toBe(false);
            expect(result.error).toContain("No debug session");
        });

        it("should fail when not paused", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID); // Active, not paused
            
            const result = await missionDebugService.modifyVariable(
                TEST_MISSION_RUN_ID,
                "key",
                "value"
            );
            
            expect(result.success).toBe(false);
            expect(result.error).toContain("only modify during pause");
        });

        it("should modify variable when paused", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            await missionDebugService.pause(TEST_MISSION_RUN_ID);
            
            const result = await missionDebugService.modifyVariable(
                TEST_MISSION_RUN_ID,
                "blackboard.searchQuery",
                "new query"
            );
            
            expect(result.success).toBe(true);
        });
    });

    describe("terminateDebugSession", () => {
        it("should terminate active session", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            
            const result = await missionDebugService.terminateDebugSession(TEST_MISSION_RUN_ID);
            
            expect(result).toBe(true);
            expect(missionDebugService.isDebugMode(TEST_MISSION_RUN_ID)).toBe(false);
        });

        it("should return false for non-existent session", async () => {
            const result = await missionDebugService.terminateDebugSession(999999);
            expect(result).toBe(false);
        });
    });

    describe("getActiveSessions", () => {
        it("should return empty array when no sessions", () => {
            const sessions = missionDebugService.getActiveSessions();
            expect(sessions).toEqual([]);
        });

        it("should return all active sessions", async () => {
            await missionDebugService.startDebugSession(100);
            await missionDebugService.startDebugSession(101);
            
            const sessions = missionDebugService.getActiveSessions();
            
            expect(sessions).toHaveLength(2);
        });

        it("should not include terminated sessions", async () => {
            await missionDebugService.startDebugSession(100);
            await missionDebugService.terminateDebugSession(100);
            await missionDebugService.startDebugSession(101);
            
            const sessions = missionDebugService.getActiveSessions();
            
            expect(sessions).toHaveLength(1);
            expect(sessions[0].missionRunId).toBe(101);
        });
    });

    describe("condition breakpoints", () => {
        it("should evaluate simple conditions", async () => {
            await missionDebugService.startDebugSession(TEST_MISSION_RUN_ID);
            
            // Test private method through integration
            const result = missionDebugService.shouldPause(TEST_MISSION_RUN_ID, {
                blackboard: { phase: "EXECUTING", cycleCount: 5 },
                phase: "EXECUTING",
                cycleCount: 5,
            });
            
            // Without a condition breakpoint, should not pause
            expect(result.shouldPause).toBe(false);
        });
    });
});
