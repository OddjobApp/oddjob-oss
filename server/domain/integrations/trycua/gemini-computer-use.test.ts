/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
    geminiInteractionClient,
    isVisualCall,
    mapCall,
    normalizeKey,
    pngSize,
    runComputerUseLoop,
    type GeminiFunctionCall,
    type GeminiInteraction,
    type LoopDeps,
} from "./gemini-computer-use.js";

// A real 1000x800 PNG header (IHDR only) is enough for pngSize.
function fakePng(width: number, height: number, tag = 0): string {
    const buf = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
    buf.writeUInt32BE(13, 8);
    buf.write("IHDR", 12);
    buf.writeUInt32BE(width, 16);
    buf.writeUInt32BE(height, 20);
    buf[32] = tag; // makes successive screenshots distinguishable
    return `data:image/png;base64,${buf.toString("base64")}`;
}

const screen = { width: 1000, height: 800 };
const call = (name: string, args: Record<string, unknown> = {}, id = `call-${name}`): GeminiFunctionCall => ({ id, name, arguments: args });
const turn = (id: string, ...calls: GeminiFunctionCall[]): GeminiInteraction => ({
    id,
    steps: calls.map((c) => ({ type: "function_call", id: c.id, name: c.name, arguments: c.arguments })),
});
const done = (id: string, text: string): GeminiInteraction => ({
    id,
    steps: [{ type: "model_output", content: [{ type: "text", text }] }],
});

function harness(turns: GeminiInteraction[]) {
    const requests: Array<{ input: any; previousInteractionId?: string }> = [];
    const executed: unknown[] = [];
    const steps: unknown[] = [];
    let shots = 0;
    const deps: LoopDeps = {
        createInteraction: vi.fn(async (req) => {
            requests.push(req);
            const next = turns.shift();
            if (!next) throw new Error("model called more times than scripted");
            return next;
        }),
        screenshot: async () => fakePng(1000, 800, ++shots),
        execute: async (action) => {
            executed.push(action);
            return { success: true };
        },
        recordStep: async (step) => {
            steps.push(step);
        },
        isCancelled: async () => false,
        sleep: async () => {},
    };
    return { deps, requests, executed, steps };
}

describe("mapCall", () => {
    it("denormalizes 0-999 coordinates to the screenshot's pixels", () => {
        expect(mapCall(call("click", { x: 500, y: 250 }), screen)).toEqual({
            kind: "actions",
            actions: [{ action: "click", params: { x: 500, y: 200 } }],
        });
        expect(mapCall(call("click_at", { x: 999, y: 999 }), screen)).toMatchObject({
            actions: [{ params: { x: 999, y: 799 } }],
        });
    });

    it("types into a field by clicking, clearing, typing and optionally pressing Enter", () => {
        expect(mapCall(call("type", { x: 100, y: 100, text: "hawaii", press_enter: true }), screen)).toEqual({
            kind: "actions",
            actions: [
                { action: "click", params: { x: 100, y: 80 } },
                { action: "hotkey", params: { keys: ["ctrl", "a"] } },
                { action: "key_press", params: { key: "backspace" } },
                { action: "type_text", params: { text: "hawaii" } },
                { action: "key_press", params: { key: "enter" } },
            ],
        });
        expect(mapCall(call("type", { text: "no field" }), screen)).toEqual({
            kind: "actions",
            actions: [{ action: "type_text", params: { text: "no field" } }],
        });
    });

    it("scrolls in clicks, positive meaning down, at the given point", () => {
        expect(mapCall(call("scroll", { x: 500, y: 500, direction: "up", magnitude_in_pixels: 300 }), screen)).toEqual({
            kind: "actions",
            actions: [{ action: "scroll", params: { x: 500, y: 400, clicks: -3 } }],
        });
    });

    it("maps key names to what computer-server (pynput) accepts", () => {
        expect(mapCall(call("hotkey", { keys: ["Control", "L"] }), screen)).toEqual({
            kind: "actions",
            actions: [{ action: "hotkey", params: { keys: ["ctrl", "l"] } }],
        });
        expect(mapCall(call("key_combination", { keys: "Control+Shift+T" }), screen)).toMatchObject({
            actions: [{ action: "hotkey", params: { keys: ["ctrl", "shift", "t"] } }],
        });
        expect(normalizeKey("Return", false)).toBe("enter");
        expect(normalizeKey("PageDown", false)).toBe("page_down");
        expect(normalizeKey("ArrowLeft", false)).toBe("left");
        expect(normalizeKey("F5", false)).toBe("f5");
        expect(normalizeKey("A", false)).toBe("A");
        // X11 keysym names, as gemini-3.8-flash sent them in a live run.
        expect(normalizeKey("Control_L", true)).toBe("ctrl_l");
        expect(normalizeKey("Shift_R", true)).toBe("shift_r");
        expect(normalizeKey("Super_L", true)).toBe("cmd_l");
        expect(normalizeKey("Page_Down", false)).toBe("page_down");
        expect(normalizeKey("l", true)).toBe("l");
    });

    it("accepts both drag_and_drop argument shapes", () => {
        const expected = { action: "drag", params: { startX: 100, startY: 80, endX: 200, endY: 160, durationMs: 500 } };
        expect(mapCall(call("drag_and_drop", { start_x: 100, start_y: 100, end_x: 200, end_y: 200 }), screen)).toMatchObject({ actions: [expected] });
        expect(mapCall(call("drag_and_drop", { x: 100, y: 100, destination_x: 200, destination_y: 200 }), screen)).toMatchObject({ actions: [expected] });
    });

    it("reports actions the desktop cannot do instead of failing the run", () => {
        expect(mapCall(call("middle_click", { x: 1, y: 1 }), screen)).toMatchObject({ kind: "unsupported" });
        expect(mapCall(call("take_screenshot"), screen)).toEqual({ kind: "noop" });
    });

    it("reads the screen size from the PNG header", () => {
        expect(pngSize(fakePng(1440, 900))).toEqual({ width: 1440, height: 900 });
    });
});

describe("runComputerUseLoop", () => {
    const options = { goal: "Find the weather in Boston", maxTurns: 10, supervised: false };

    it("sends goal + screenshot, executes calls, answers every call, and finishes on a text reply", async () => {
        const h = harness([
            turn("i1", call("click", { x: 500, y: 500, intent: "focus search" }, "c1"), call("type", { text: "weather boston" }, "c2")),
            done("i2", "It is 18°C and sunny in Boston."),
        ]);
        const outcome = await runComputerUseLoop(h.deps, options, {});

        expect(outcome).toMatchObject({ status: "succeeded", summary: "It is 18°C and sunny in Boston.", turns: 2 });
        expect(h.requests[0].input[0]).toEqual({ type: "text", text: options.goal });
        expect(h.requests[0].input[1]).toMatchObject({ type: "image", mime_type: "image/png" });
        expect(h.requests[0].previousInteractionId).toBeUndefined();

        // Second request chains the conversation and returns one function_result per call.
        expect(h.requests[1].previousInteractionId).toBe("i1");
        expect(h.requests[1].input.map((r: any) => [r.type, r.name, r.call_id])).toEqual([
            ["function_result", "click", "c1"],
            ["function_result", "type", "c2"],
        ]);
        // Image first: injection detection rejects text-then-image.
        expect(h.requests[1].input[0].result[0]).toMatchObject({ type: "image" });
        expect(h.executed).toEqual([
            { action: "click", params: { x: 500, y: 400 } },
            { action: "type_text", params: { text: "weather boston" } },
        ]);
    });

    it("feeds execution errors back to the model instead of ending the run", async () => {
        const h = harness([turn("i1", call("click", { x: 1, y: 1 }, "c1")), done("i2", "Recovered.")]);
        h.deps.execute = async () => {
            throw new Error("Trycua action rate limit exceeded");
        };
        const outcome = await runComputerUseLoop(h.deps, options, {});
        expect(outcome.status).toBe("succeeded");
        expect(JSON.parse(h.requests[1].input[0].result[1].text)).toEqual({ error: "Trycua action rate limit exceeded" });
    });

    it("pauses on require_confirmation, then resumes with safety_acknowledgement", async () => {
        const risky = call("click", { x: 10, y: 10, safety_decision: { decision: "require_confirmation", explanation: "Buys a ticket" } }, "c-buy");
        const h = harness([turn("i1", call("click", { x: 1, y: 1 }, "c-first"), risky)]);
        const paused = await runComputerUseLoop(h.deps, options, {});

        expect(paused).toMatchObject({ status: "needs_confirmation", kind: "safety", explanation: "Buys a ticket" });
        expect(h.executed).toHaveLength(1); // the call before the risky one ran; the risky one did not
        expect(paused.state.pendingCalls?.map((c) => c.id)).toEqual(["c-buy"]);
        expect(paused.state.doneResults?.map((r) => r.call.id)).toEqual(["c-first"]);

        const h2 = harness([done("i2", "Bought.")]);
        const resumed = await runComputerUseLoop(h2.deps, { ...options, resume: { approved: true } }, paused.state);

        expect(resumed.status).toBe("succeeded");
        expect(h2.executed).toEqual([{ action: "click", params: { x: 10, y: 8 } }]);
        expect(h2.requests[0].previousInteractionId).toBe("i1");
        // Both calls of the paused turn are answered together, the approved one acknowledged.
        const results = h2.requests[0].input;
        expect(results.map((r: any) => r.call_id)).toEqual(["c-first", "c-buy"]);
        expect(JSON.parse(results[1].result[1].text)).toEqual({ safety_acknowledgement: true });
        expect(resumed.state.pendingCalls).toBeUndefined();
    });

    it("stops on a blocked safety decision without executing", async () => {
        const h = harness([turn("i1", call("click", { x: 1, y: 1, safety_decision: { decision: "blocked", explanation: "Prohibited" } }))]);
        const outcome = await runComputerUseLoop(h.deps, options, {});
        expect(outcome).toMatchObject({ status: "blocked", explanation: "Prohibited" });
        expect(h.executed).toHaveLength(0);
    });

    it("hands control to the user on yield_to_user and passes their reply back", async () => {
        const h = harness([turn("i1", call("yield_to_user", { reason: "Please log in to LinkedIn" }, "c-y"))]);
        const paused = await runComputerUseLoop(h.deps, options, {});
        expect(paused).toMatchObject({ status: "needs_confirmation", kind: "yield", explanation: "Please log in to LinkedIn" });

        const h2 = harness([done("i2", "Posted.")]);
        await runComputerUseLoop(h2.deps, { ...options, resume: { approved: true, userResponse: "Logged in." } }, paused.state);
        expect(JSON.parse(h2.requests[0].input[0].result[1].text)).toEqual({ user_response: "Logged in." });
        expect(h2.executed).toHaveLength(0);
    });

    it("in supervised mode pauses before every action", async () => {
        const h = harness([turn("i1", call("click", { x: 1, y: 1, intent: "Open the menu" }, "c1"))]);
        const outcome = await runComputerUseLoop(h.deps, { ...options, supervised: true }, {});
        expect(outcome).toMatchObject({ status: "needs_confirmation", kind: "supervised", explanation: "Open the menu" });
        expect(h.executed).toHaveLength(0);
    });

    it("refuses to resume a paused run without approval", async () => {
        const h = harness([]);
        const outcome = await runComputerUseLoop(h.deps, options, { interactionId: "i1", pendingCalls: [call("click", { x: 1, y: 1 })] });
        expect(outcome.status).toBe("failed");
        expect(h.executed).toHaveLength(0);
    });

    it("fails with a clear message at the turn limit", async () => {
        const h = harness([turn("i1", call("wait", {}, "a")), turn("i2", call("wait", {}, "b"))]);
        const outcome = await runComputerUseLoop(h.deps, { ...options, maxTurns: 2 }, {});
        expect(outcome.status).toBe("failed");
        expect((outcome as any).error).toMatch(/2 model turns/);
    });

    it("spaces out a call's actions so the session rate limiter does not reject them", async () => {
        const h = harness([turn("i1", call("type", { x: 1, y: 1, text: "x", press_enter: true })), done("i2", "ok")]);
        const sleeps: number[] = [];
        h.deps.sleep = async (ms) => {
            sleeps.push(ms);
        };
        h.deps.actionGapMs = 300;
        await runComputerUseLoop(h.deps, options, {});
        expect(h.executed).toHaveLength(5);
        expect(sleeps).toEqual([300, 300, 300, 300]);
    });
});

describe("geminiInteractionClient", () => {
    it("posts to the Interactions API with the key in a header, never the URL", async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "i9", steps: [] }), { status: 200 }));
        const create = geminiInteractionClient({ apiKey: "secret-key", model: "gemini-3.8-flash", systemInstruction: "sys", fetchImpl });
        await create({ input: "hi", previousInteractionId: "i8" });

        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
        expect(url).not.toContain("secret-key");
        expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({ model: "gemini-3.8-flash", input: "hi", previous_interaction_id: "i8", system_instruction: "sys" });
        expect(body.tools[0]).toEqual({ type: "computer_use", environment: "desktop", enable_prompt_injection_detection: true });
        expect(body.tools[1]).toMatchObject({ type: "function", name: "yield_to_user" });
    });

    it("surfaces API errors with the status", async () => {
        const fetchImpl = vi.fn(async () => new Response("quota exceeded", { status: 429 }));
        const create = geminiInteractionClient({ apiKey: "k", model: "m", systemInstruction: "s", fetchImpl });
        await expect(create({ input: "hi" })).rejects.toThrow(/HTTP 429/);
    });
});

describe("isVisualCall", () => {
    it("marks pointer and navigation actions as visual", () => {
        const visual = ["click", "double_click", "right_click", "drag_and_drop", "navigate", "go_back", "go_forward", "search", "scroll", "type", "type_text_at", "window_maximize"];
        for (const name of visual) {
            expect(isVisualCall({ id: name, name, arguments: {} }), `${name} should be visual`).toBe(true);
        }
    });

    it("observes waits, keyboard actions, hover and explicit screenshot requests", () => {
        const visual = ["wait", "wait_5_seconds", "hotkey", "key_combination", "move", "hover_at", "take_screenshot", "press_key"];
        for (const name of visual) {
            expect(isVisualCall({ id: name, name, arguments: {} }), `${name} should be visual`).toBe(true);
        }
    });
});

describe("runComputerUseLoop: conditional screenshot capture", () => {
    it("recaptures after waiting so completed page loads are visible", async () => {
        const h = harness([
            turn("t1", call("wait", { seconds: 1 })),
            turn("t2", call("click", { x: 500, y: 400 })),
            done("t3", "all done"),
        ]);
        const screenshotSpy = vi.spyOn(h.deps, "screenshot");
        const options = { goal: "test", maxTurns: 10, supervised: false };
        const result = await runComputerUseLoop(h.deps, options, {});
        expect(result.status).toBe("succeeded");
        expect(screenshotSpy).toHaveBeenCalledTimes(3);
        expect(h.requests[1].input[0].result[0].data).not.toBe(h.requests[0].input[1].data);
    });

    it("always recaptures after a visual action (click)", async () => {
        const h = harness([
            turn("t1", call("click", { x: 100, y: 200 })),
            done("t2", "done"),
        ]);
        const screenshotSpy = vi.spyOn(h.deps, "screenshot");
        const options = { goal: "test", maxTurns: 10, supervised: false };
        const result = await runComputerUseLoop(h.deps, options, {});
        expect(result.status).toBe("succeeded");
        // Initial capture + after click = 2
        expect(screenshotSpy).toHaveBeenCalledTimes(2);
    });
});

describe("computer-use reliability regressions", () => {
    const options = { goal: "Continue with the updated task", maxTurns: 10, supervised: false };

    it.each(["press_key", "hotkey", "hover_at", "take_screenshot"])("returns a fresh screenshot after %s", async (name) => {
        const h = harness([turn("i1", call(name, { key: "Enter", keys: ["Alt", "Tab"], x: 1, y: 1 })), done("i2", "done")]);
        await runComputerUseLoop(h.deps, options, {});
        expect(h.requests[1].input[0].result[0].data).not.toBe(h.requests[0].input[1].data);
    });

    it("observes earlier actions even when the last call is unsupported", async () => {
        const h = harness([turn("i1", call("click", { x: 1, y: 1 }), call("unsupported")), done("i2", "done")]);
        await runComputerUseLoop(h.deps, options, {});
        expect(h.requests[1].input[0].result[0].data).not.toBe(h.requests[0].input[1].data);
    });

    it("reuses the screenshot when no supported action ran", async () => {
        const h = harness([turn("i1", call("unsupported")), done("i2", "done")]);
        await runComputerUseLoop(h.deps, options, {});
        expect(h.requests[1].input[0].result[0].data).toBe(h.requests[0].input[1].data);
    });

    it("sends the new goal when continuing an interaction chain", async () => {
        const h = harness([done("i2", "done")]);
        await runComputerUseLoop(h.deps, options, { interactionId: "i1" });
        expect(h.requests[0]).toMatchObject({ previousInteractionId: "i1", input: [{ type: "text", text: options.goal }, { type: "image" }] });
    });

    it("stops between actions within a compound typing call and records partial execution", async () => {
        const h = harness([turn("i1", call("type", { x: 1, y: 1, text: "do not type", press_enter: true }))]);
        h.deps.isCancelled = async () => h.executed.length > 0;
        const result = await runComputerUseLoop(h.deps, options, {});
        expect(result.status).toBe("cancelled");
        expect(h.executed).toHaveLength(1);
        expect(h.steps).toMatchObject([{ actions: [{ action: "click" }], result: { cancelled: true } }]);
    });

    it("stops between calls in the same model response", async () => {
        const h = harness([turn("i1", call("click", { x: 1, y: 1 }), call("type", { text: "do not type" }))]);
        h.deps.isCancelled = async () => h.executed.length > 0;
        expect((await runComputerUseLoop(h.deps, options, {})).status).toBe("cancelled");
        expect(h.executed).toHaveLength(1);
    });

    it("honors cancellation arriving while the model is responding", async () => {
        const h = harness([done("i1", "done")]);
        h.deps.isCancelled = async () => h.requests.length > 0;
        expect((await runComputerUseLoop(h.deps, options, {})).status).toBe("cancelled");
    });
});
