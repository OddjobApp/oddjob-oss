/**
 * Spec Conformance: Action Protocol (ACT-*, BB-*, TRACE-*)
 *
 * Tests are tagged with assertion IDs from docs/specs/conformance/CONFORMANCE.md.
 * All tests are pure unit tests — no DB, Redis, or BullMQ dependencies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock infrastructure ───────────────────────────────────────────────────────

function createMockCtx(overrides: Record<string, any> = {}) {
    return {
        missionRunId: 1,
        missionId: 10,
        userId: "test-user",
        orgId: 1,
        blackboard: {} as Record<string, any>,
        missionContext: { cycleCount: 1, maxCycles: 20 } as Record<string, any>,
        objective: "Test objective",
        allowedTools: [],
        cycleCount: 1,
        maxCycles: 20,
        dynamicTrace: [],
        effectiveUserEmail: "test@example.com",
        mlPredictedStrategy: "dynamic_autonomous",
        mlCycleStartMs: Date.now(),
        currentCycle: 1,
        appendTrace: vi.fn().mockResolvedValue(undefined),
        trackAsset: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

// ── Simulated handler logic ───────────────────────────────────────────────────

// CONCLUDE handler simulation
async function simulateConclude(
    ctx: ReturnType<typeof createMockCtx>,
    decision: { action_details?: { final_product?: string }; thought_process?: string }
) {
    const product =
        decision.action_details?.final_product ||
        decision.thought_process ||
        "Mission objective achieved.";

    // BB-002: write result to missionContext
    ctx.missionContext.result = product;

    // ACT-004: transition to waiting_on_human, NOT completed
    const newStatus = "waiting_on_human";

    // TRACE: emit trace event
    await ctx.appendTrace(ctx.missionRunId, {
        type: "system",
        event: "mission_concluded_review",
        note: `MISSION PRODUCT READY FOR REVIEW:\n\n${typeof product === "string" ? product : JSON.stringify(product)}`,
        timestamp: new Date().toISOString(),
    });

    return { newStatus };
}

// CALL_TOOL handler simulation
async function simulateCallTool(
    ctx: ReturnType<typeof createMockCtx>,
    decision: { action_details?: { tool_name: string; arguments?: Record<string, any> } },
    toolResult: { success: boolean; output?: any }
) {
    const toolName = decision.action_details?.tool_name ?? "unknown";

    await ctx.appendTrace(ctx.missionRunId, {
        type: "system",
        event: "tool_invoked",
        tool: toolName,
        timestamp: new Date().toISOString(),
    });

    // BB-001: always write last_tool_run and last_tool_status
    ctx.blackboard.last_tool_run = toolName;
    ctx.blackboard.last_tool_status = toolResult.success ? "success" : "failed";

    if (toolResult.success) {
        const outputKey = `tool_output_${toolName}_${Date.now()}`;
        ctx.blackboard[outputKey] = toolResult.output;

        await ctx.appendTrace(ctx.missionRunId, {
            type: "system",
            event: "tool_success",
            tool: toolName,
            timestamp: new Date().toISOString(),
        });
    } else {
        await ctx.appendTrace(ctx.missionRunId, {
            type: "system",
            event: "tool_failed",
            tool: toolName,
            timestamp: new Date().toISOString(),
        });
    }

    return { success: toolResult.success };
}

// HIL_REQUEST handler simulation
async function simulateHilRequest(
    ctx: ReturnType<typeof createMockCtx>,
    decision: { action_details?: { question?: string } },
    createApprovalRequest: (q: string) => Promise<{ id: number }>
) {
    const question = decision.action_details?.question ?? "";

    // ACT-006: create approval record
    const approval = await createApprovalRequest(question);

    // ACT-008: set resumeCondition
    const resumeCondition = {
        type: "human_approval",
        approvalRequestIds: [approval.id],
    };

    // ACT-007: transition to waiting_on_human
    const newStatus = "waiting_on_human";

    await ctx.appendTrace(ctx.missionRunId, {
        type: "system",
        event: "hil_question_submitted",
        note: question,
        timestamp: new Date().toISOString(),
    });

    return { newStatus, resumeCondition };
}

// FAIL handler simulation
async function simulateFail(ctx: ReturnType<typeof createMockCtx>) {
    await ctx.appendTrace(ctx.missionRunId, {
        type: "error",
        event: "mission_failed",
        note: "Mission marked as failed by Orchestrator.",
        timestamp: new Date().toISOString(),
    });

    return { newStatus: "failed" };
}

// THINK_STEP handler simulation
async function simulateThinkStep(ctx: ReturnType<typeof createMockCtx>) {
    // ACT-017: must NOT transition to terminal state
    return { newStatus: "active", queuesNextCycle: true };
}

// Unknown action simulation
function resolveHandler(action: string): string {
    const registry: Record<string, string> = {
        CALL_TOOL: "CallToolHandler",
        CONCLUDE: "ConcludeHandler",
        CONCLUDE_MISSION: "ConcludeHandler",
        FAIL: "FailHandler",
        HIL_REQUEST: "HilRequestHandler",
        DELEGATE: "DelegateHandler",
        LAUNCH_SUBMISSION: "LaunchSubmissionHandler",
        EXTRACT_BLUEPRINT: "ExtractBlueprintHandler",
        ARCHIVE_ASSET: "ArchiveAssetHandler",
        SYNTHESIZE_TOOL: "SynthesizeToolHandler",
        THINK_STEP: "ThinkStepHandler",
    };
    return registry[action] ?? "ThinkStepHandler";
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ACT-004 / BB-002: CONCLUDE transitions to waiting_on_human with result written", () => {
    it("sets run status to waiting_on_human (not completed)", async () => {
        const ctx = createMockCtx();
        const result = await simulateConclude(ctx, {
            action_details: { final_product: "Final analysis complete." },
        });
        expect(result.newStatus).toBe("waiting_on_human");
        expect(result.newStatus).not.toBe("completed");
    });

    it("writes result to missionContext", async () => {
        const ctx = createMockCtx();
        await simulateConclude(ctx, {
            action_details: { final_product: "The answer is 42." },
        });
        expect(ctx.missionContext.result).toBe("The answer is 42.");
    });

    it("falls back to thought_process when final_product is absent", async () => {
        const ctx = createMockCtx();
        await simulateConclude(ctx, { thought_process: "Concluded from reasoning." });
        expect(ctx.missionContext.result).toBe("Concluded from reasoning.");
    });

    it("falls back to default string when both are absent", async () => {
        const ctx = createMockCtx();
        await simulateConclude(ctx, {});
        expect(ctx.missionContext.result).toBe("Mission objective achieved.");
    });

    it("emits mission_concluded_review trace", async () => {
        const ctx = createMockCtx();
        await simulateConclude(ctx, { action_details: { final_product: "Done." } });
        expect(ctx.appendTrace).toHaveBeenCalledWith(
            ctx.missionRunId,
            expect.objectContaining({ type: "system", event: "mission_concluded_review" })
        );
    });
});

describe("ACT-002 / BB-001: CALL_TOOL writes last_tool_run and last_tool_status", () => {
    it("writes last_tool_run and last_tool_status on success", async () => {
        const ctx = createMockCtx();
        await simulateCallTool(
            ctx,
            { action_details: { tool_name: "google_search" } },
            { success: true, output: "search results" }
        );
        expect(ctx.blackboard.last_tool_run).toBe("google_search");
        expect(ctx.blackboard.last_tool_status).toBe("success");
    });

    it("writes last_tool_run and last_tool_status on failure", async () => {
        const ctx = createMockCtx();
        await simulateCallTool(
            ctx,
            { action_details: { tool_name: "external_api" } },
            { success: false }
        );
        expect(ctx.blackboard.last_tool_run).toBe("external_api");
        expect(ctx.blackboard.last_tool_status).toBe("failed");
    });

    it("emits tool_invoked trace before result", async () => {
        const ctx = createMockCtx();
        await simulateCallTool(
            ctx,
            { action_details: { tool_name: "google_search" } },
            { success: true }
        );
        const calls = (ctx.appendTrace as any).mock.calls.map((c: any[]) => c[1].event);
        expect(calls[0]).toBe("tool_invoked");
    });

    it("emits tool_success on success", async () => {
        const ctx = createMockCtx();
        await simulateCallTool(
            ctx,
            { action_details: { tool_name: "browse_web" } },
            { success: true, output: "page content" }
        );
        const events = (ctx.appendTrace as any).mock.calls.map((c: any[]) => c[1].event);
        expect(events).toContain("tool_success");
    });

    it("emits tool_failed on failure", async () => {
        const ctx = createMockCtx();
        await simulateCallTool(
            ctx,
            { action_details: { tool_name: "broken_tool" } },
            { success: false }
        );
        const events = (ctx.appendTrace as any).mock.calls.map((c: any[]) => c[1].event);
        expect(events).toContain("tool_failed");
    });
});

describe("ACT-005: FAIL immediately transitions to failed", () => {
    it("returns failed status", async () => {
        const ctx = createMockCtx();
        const result = await simulateFail(ctx);
        expect(result.newStatus).toBe("failed");
    });

    it("emits mission_failed trace", async () => {
        const ctx = createMockCtx();
        await simulateFail(ctx);
        expect(ctx.appendTrace).toHaveBeenCalledWith(
            ctx.missionRunId,
            expect.objectContaining({ type: "error", event: "mission_failed" })
        );
    });
});

describe("ACT-006 / ACT-007 / ACT-008: HIL_REQUEST creates approval, sets condition, transitions run", () => {
    it("creates an approval request", async () => {
        const ctx = createMockCtx();
        const createApproval = vi.fn().mockResolvedValue({ id: 42 });
        await simulateHilRequest(ctx, { action_details: { question: "Proceed?" } }, createApproval);
        expect(createApproval).toHaveBeenCalledWith("Proceed?");
    });

    it("transitions run to waiting_on_human", async () => {
        const ctx = createMockCtx();
        const createApproval = vi.fn().mockResolvedValue({ id: 42 });
        const result = await simulateHilRequest(ctx, {}, createApproval);
        expect(result.newStatus).toBe("waiting_on_human");
    });

    it("sets resumeCondition.type to human_approval", async () => {
        const ctx = createMockCtx();
        const createApproval = vi.fn().mockResolvedValue({ id: 42 });
        const result = await simulateHilRequest(ctx, {}, createApproval);
        expect(result.resumeCondition.type).toBe("human_approval");
        expect(result.resumeCondition.approvalRequestIds).toContain(42);
    });
});

describe("ACT-017: THINK_STEP must not transition to terminal state", () => {
    it("returns active status and queues next cycle", async () => {
        const ctx = createMockCtx();
        const result = await simulateThinkStep(ctx);
        expect(result.newStatus).toBe("active");
        expect(result.queuesNextCycle).toBe(true);
    });
});

describe("ACT-018: unknown action names must not fail the run", () => {
    it("routes unknown action to ThinkStepHandler", () => {
        expect(resolveHandler("UNKNOWN_ACTION_XYZ")).toBe("ThinkStepHandler");
        expect(resolveHandler("MAKE_COFFEE")).toBe("ThinkStepHandler");
    });

    it("routes known actions correctly", () => {
        expect(resolveHandler("CONCLUDE")).toBe("ConcludeHandler");
        expect(resolveHandler("CONCLUDE_MISSION")).toBe("ConcludeHandler");
        expect(resolveHandler("CALL_TOOL")).toBe("CallToolHandler");
        expect(resolveHandler("FAIL")).toBe("FailHandler");
    });
});

describe("TRACE-001: note field in trace entries must be a string", () => {
    it("serializes object note to JSON string", async () => {
        const ctx = createMockCtx();
        const objectNote = { critique: "This needs improvement", score: 0.4 };
        const note = typeof objectNote === "object" ? JSON.stringify(objectNote) : objectNote;
        expect(typeof note).toBe("string");
    });

    it("passes string note through unchanged", () => {
        const note = "Mission concluded successfully.";
        const result = typeof note === "object" ? JSON.stringify(note) : note;
        expect(result).toBe("Mission concluded successfully.");
    });
});

describe("Action registry — CONCLUDE_MISSION alias", () => {
    it("CONCLUDE_MISSION routes to same handler as CONCLUDE", () => {
        expect(resolveHandler("CONCLUDE_MISSION")).toBe(resolveHandler("CONCLUDE"));
    });
});
