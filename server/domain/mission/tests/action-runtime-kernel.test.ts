import { describe, expect, it, vi } from "vitest";
import {
    createRuntimeSnapshot,
    diffRuntimeSnapshots,
    runActionWithRuntimeKernel,
} from "../core/actions/action-runtime-kernel.js";
import type { ActionContext, ActionHandler } from "../core/actions/action-handler.js";

function makeContext(overrides: Partial<ActionContext> = {}): ActionContext {
    return {
        missionRunId: 99,
        missionId: 7,
        userId: "user-123",
        orgId: 1,
        objective: "Test objective",
        blackboard: {},
        missionContext: {},
        allowedTools: [],
        cycleCount: 1,
        maxCycles: 10,
        effectiveUserEmail: "user@example.com",
        mlPredictedStrategy: "dynamic_hybrid",
        mlCycleStartMs: Date.now(),
        currentCycle: 1,
        appendTrace: vi.fn().mockResolvedValue(undefined),
        trackAsset: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as ActionContext;
}

describe("action runtime kernel", () => {
    it("diffs blackboard and mission context snapshots", () => {
        const before = createRuntimeSnapshot({
            status: "active",
            blackboard: { stable: "a", changed: 1, removed: true },
            missionContext: { cycleCount: 1 },
        });
        const after = createRuntimeSnapshot({
            status: "active",
            blackboard: { stable: "a", changed: 2, added: "new" },
            missionContext: { cycleCount: 2, mode: "debug" },
        });

        expect(diffRuntimeSnapshots(before, after)).toEqual({
            blackboard: {
                added: ["added"],
                changed: ["changed"],
                removed: ["removed"],
            },
            missionContext: {
                added: ["mode"],
                changed: ["cycleCount"],
                removed: [],
            },
        });
    });

    it("emits validating, executing, and succeeded action records", async () => {
        const ctx = makeContext();
        let after = false;
        const handler: ActionHandler = {
            execute: vi.fn(async () => {
                after = true;
            }),
        };

        await runActionWithRuntimeKernel({
            ctx,
            decision: { action: "CONCLUDE", thought_process: "done", action_details: { final_product: "ok" } },
            handler,
            traceCycleId: "99:1",
            loadSnapshot: async () => createRuntimeSnapshot({
                status: "active",
                blackboard: after ? { final: "ok" } : {},
                missionContext: { cycleCount: 1 },
            }),
        });

        const events = (ctx.appendTrace as any).mock.calls.map((call: any[]) => call[1]);
        expect(events.map((event: any) => event.status)).toEqual(["validating", "executing", "succeeded"]);
        expect(events[0]).toMatchObject({
            type: "action_execution",
            event: "action_validating",
            action: "CONCLUDE",
            missionRunId: 99,
            missionId: 7,
            traceCycleId: "99:1",
        });
        expect(events[2].diff.blackboard.added).toEqual(["final"]);
    });

    it("emits paused action records without marking success", async () => {
        const ctx = makeContext();
        const handler: ActionHandler = {
            execute: vi.fn(async () => ({ status: "paused" as const, reason: "breakpoint", debug: true })),
        };

        const result = await runActionWithRuntimeKernel({
            ctx,
            decision: { action: "CALL_TOOL", action_details: { tool_name: "search" } },
            handler,
            loadSnapshot: async () => createRuntimeSnapshot({ status: "paused", blackboard: {}, missionContext: {} }),
        });

        const events = (ctx.appendTrace as any).mock.calls.map((call: any[]) => call[1]);
        expect(result).toEqual({ status: "paused", reason: "breakpoint", debug: true });
        expect(events.at(-1)).toMatchObject({
            event: "action_paused",
            status: "paused",
            pauseReason: "breakpoint",
            toolName: "search",
        });
    });

    it("emits failed action records and rethrows handler errors", async () => {
        const ctx = makeContext();
        const handler: ActionHandler = {
            execute: vi.fn(async () => {
                throw new Error("boom");
            }),
        };

        await expect(runActionWithRuntimeKernel({
            ctx,
            decision: { action: "FAIL" },
            handler,
            loadSnapshot: async () => createRuntimeSnapshot({ status: "active", blackboard: {}, missionContext: {} }),
        })).rejects.toThrow("boom");

        const events = (ctx.appendTrace as any).mock.calls.map((call: any[]) => call[1]);
        expect(events.at(-1)).toMatchObject({
            event: "action_failed",
            status: "failed",
            error: "boom",
        });
    });
});
