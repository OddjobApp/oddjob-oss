/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
    createAnthropicComputerUseLoop,
    getToolConfig,
    mapCall,
    pngSize,
} from "./anthropic-computer-use.js";
import type { ComputerUseCall, ComputerUseLoopDeps } from "./computer-use-loop.js";

function fakePng(width: number, height: number, tag = 0): string {
    const buf = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    buf.writeUInt32BE(13, 8);
    buf.write("IHDR", 12);
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    buf[32] = tag;
    return `data:image/png;base64,${buf.toString("base64")}`;
}

const call = (name: string, input: Record<string, unknown> = {}, id = `call-${name}`): ComputerUseCall => ({
    id,
    name,
    arguments: input,
});

function assistantResponse(id: string, ...blocks: Array<Record<string, unknown>>) {
    return { id, content: blocks };
}

function computerCall(id: string, action: string, input: Record<string, unknown> = {}) {
    return { type: "tool_use", id, name: "computer", input: { action, ...input } };
}

describe("getToolConfig", () => {
    it("selects the 2025-11-24 tool version for Claude 4.5/4.6 models", () => {
        expect(getToolConfig("claude-opus-4-5-20251101").toolVersion).toBe("computer_20251124");
        expect(getToolConfig("claude-sonnet-4-6-20251101").toolVersion).toBe("computer_20251124");
    });

    it("selects the 2025-01-24 tool version for Claude 4 and 3.7 models", () => {
        expect(getToolConfig("claude-sonnet-4-5-20251101").toolVersion).toBe("computer_20250124");
        expect(getToolConfig("claude-4-opus").toolVersion).toBe("computer_20250124");
        expect(getToolConfig("claude-3-7-sonnet").toolVersion).toBe("computer_20250124");
    });

    it("selects the 2024-10-22 tool version for Claude 3.5 models", () => {
        expect(getToolConfig("claude-3-5-sonnet").toolVersion).toBe("computer_20241022");
    });
});

describe("mapCall", () => {
    it("clicks at a coordinate", () => {
        expect(mapCall(call("computer", { action: "click", coordinate: [500, 400] }), { width: 1000, height: 800 })).toEqual({
            kind: "actions",
            actions: [{ action: "click", params: { x: 500, y: 400 } }],
        });
    });

    it("types into a field by clicking, clearing, and typing", () => {
        expect(mapCall(call("computer", { action: "type", coordinate: [100, 100], text: "hawaii" }), { width: 1000, height: 800 })).toEqual({
            kind: "actions",
            actions: [
                { action: "click", params: { x: 100, y: 100 } },
                { action: "hotkey", params: { keys: ["ctrl", "a"] } },
                { action: "key_press", params: { key: "backspace" } },
                { action: "type_text", params: { text: "hawaii" } },
            ],
        });
    });

    it("types without a coordinate when none is given", () => {
        expect(mapCall(call("computer", { action: "type_text", text: "no field" }), { width: 1000, height: 800 })).toEqual({
            kind: "actions",
            actions: [{ action: "type_text", params: { text: "no field" } }],
        });
    });

    it("scrolls with direction and amount", () => {
        expect(mapCall(call("computer", { action: "scroll", coordinate: [500, 500], scroll_direction: "up", scroll_amount: 3 }), { width: 1000, height: 800 })).toEqual({
            kind: "actions",
            actions: [{ action: "scroll", params: { x: 500, y: 500, deltaX: 0, deltaY: -3 } }],
        });
    });

    it("pauses on yield_to_user", () => {
        expect(mapCall(call("yield_to_user", { reason: "Need 2FA" }), { width: 1000, height: 800 })).toEqual({
            kind: "yield",
            reason: "Need 2FA",
        });
    });
});

describe("createAnthropicComputerUseLoop", () => {
    it("runs to completion when the model returns no tool calls", async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            text: async () => JSON.stringify(assistantResponse("resp-1", { type: "text", text: "Done." })),
        })) as any;

        const driver = createAnthropicComputerUseLoop({ apiKey: "test", model: "claude-sonnet-4", fetchImpl });
        const deps: ComputerUseLoopDeps = {
            screenshot: vi.fn(async () => fakePng(1000, 800, 1)),
            execute: vi.fn(async () => ({ success: true })),
            recordStep: vi.fn(async () => {}),
            isCancelled: vi.fn(async () => false),
            sleep: vi.fn(async () => {}),
        };

        const outcome = await driver.runLoop(deps, { goal: "Open browser", maxTurns: 5, supervised: false }, {});
        expect(outcome.status).toBe("succeeded");
        if (outcome.status !== "succeeded") throw new Error("Expected a completed computer-use outcome");
        expect(outcome.summary).toBe("Done.");
    });

    it("executes a computer action and sends back a tool_result", async () => {
        const responses = [
            assistantResponse("resp-1", computerCall("tu-1", "click", { coordinate: [500, 400] })),
            assistantResponse("resp-2", { type: "text", text: "Done." }),
        ];
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            text: async () => JSON.stringify(responses.shift()),
        })) as any;

        const driver = createAnthropicComputerUseLoop({ apiKey: "test", model: "claude-sonnet-4", fetchImpl });
        const executed: unknown[] = [];
        const deps: ComputerUseLoopDeps = {
            screenshot: vi.fn(async () => fakePng(1000, 800, 1)),
            execute: vi.fn(async (action) => { executed.push(action); return { success: true }; }),
            recordStep: vi.fn(async () => {}),
            isCancelled: vi.fn(async () => false),
            sleep: vi.fn(async () => {}),
        };

        const outcome = await driver.runLoop(deps, { goal: "Click the button", maxTurns: 5, supervised: false }, {});
        expect(outcome.status).toBe("succeeded");
        expect(executed).toHaveLength(1);
        expect(executed[0]).toEqual({ action: "click", params: { x: 500, y: 400 } });
    });
});
