/**
 * Tool Executor Unit Tests (Simplified)
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Mock dependencies only
vi.mock("@domain/tools/v1/tool-registry.service.js", () => {
    const AGENT_TOOLS = {
        "test_tool": {
            name: "test_tool",
            execute: vi.fn().mockResolvedValue("Tool Output")
        },
        "side_effect": {
            name: "side_effect",
            execute: vi.fn().mockResolvedValue("Executed Side Effect")
        }
    };
    return {
        AGENT_TOOLS,
        getAgentTools: vi.fn(() => AGENT_TOOLS),
        normalizeToolName: vi.fn(n => n),
        normalizeToolArguments: vi.fn((n, args) => args),
        isToolAvailable: vi.fn().mockResolvedValue(true),
        getToolMetadata: vi.fn().mockReturnValue({}),
        TOOL_ALIASES: {},
        JOB_SCHEMAS: {}
    };
});

vi.mock("@domain/knowledge/core/sidecar-sync-service.js", () => ({
    sidecarSyncService: { logObservation: vi.fn().mockResolvedValue(undefined) }
}));

vi.mock("@domain/agents/core/tool-analytics.service.js", () => ({
    toolAnalyticsService: {
        logToolUsage: vi.fn().mockResolvedValue(undefined),
        inferTaskType: vi.fn().mockReturnValue("unknown")
    }
}));

vi.mock("@domain/core/infrastructure/circuit-breaker.service.js", () => ({
    withCircuitBreaker: vi.fn((name, fn) => fn()),
    createCircuitBreaker: vi.fn(),
    getCircuitState: vi.fn().mockReturnValue(null)
}));

import { ToolExecutor } from "@domain/tools/v1/tool-executor.service.js";
import { AGENT_TOOLS } from "@domain/tools/v1/tool-registry.service.js";

describe("ToolExecutor", () => {
    const context: any = { organizationId: 1, userId: "u1" };
    const allowedTools = [{ name: "test_tool" }, { name: "side_effect" }];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should execute an allowed tool", async () => {
        const result = await ToolExecutor.execute(
            "test_tool",
            { param: "val" },
            context,
            allowedTools,
            false,
            "full"
        );

        expect(result).toBe("Tool Output");
        expect(AGENT_TOOLS.test_tool.execute).toHaveBeenCalledWith(
            { param: "val" },
            expect.objectContaining({
                named: {},
                positional: {},
                organizationId: 1,
                userId: "u1",
                missionId: undefined
            })
        );
    });

    it("should block execution if tool is not allowed", async () => {
        const result = await ToolExecutor.execute("unknown", {}, context, allowedTools, false, "full");
        expect(result).toContain("not found or not allowed");
    });

    // Regression guard: every org-scoped site in this file used to coerce with
    // `Number(context.organizationId) || 1`, so an agent run that carried no
    // organization silently executed tools — and governance/guardrail checks —
    // against organization 1. The same `|| 1` pattern was removed once before
    // and grew back, so the fail-closed behaviour is pinned here.
    describe.each([
        ["null", null],
        ["undefined", undefined],
        ["zero", 0],
        ["a non-numeric value", "not-an-org"],
    ])("when the agent context carries %s as the organization", (_label, orgValue) => {
        it("refuses to execute rather than defaulting to organization 1", async () => {
            const result = await ToolExecutor.execute(
                "test_tool",
                { param: "val" },
                { organizationId: orgValue, userId: "u1" } as any,
                allowedTools,
                false,
                "full"
            );

            expect(result).toContain("requires an organization context");
            expect(AGENT_TOOLS.test_tool.execute).not.toHaveBeenCalled();
        });
    });

    it("passes the caller's real organization through to the tool, not a default", async () => {
        await ToolExecutor.execute(
            "test_tool",
            { param: "val" },
            { organizationId: 42, userId: "u1" } as any,
            allowedTools,
            false,
            "full"
        );

        expect(AGENT_TOOLS.test_tool.execute).toHaveBeenCalledWith(
            { param: "val" },
            expect.objectContaining({ organizationId: 42 })
        );
    });
});
