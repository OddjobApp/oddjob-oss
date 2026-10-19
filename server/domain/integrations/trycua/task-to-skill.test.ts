/** @vitest-environment node */

/**
 * Saving a task as a skill used to read `payload.x`, `payload.text` and
 * `payload.url`, none of which the Gemini desktop loop writes: it stores its
 * executed actions under `payload.actions` and drives by screen coordinates. The
 * result was a draft of clicks on `https://localhost` with the selector `body`,
 * with every key press silently dropped — a skill that could be approved and
 * could never replay.
 *
 * The payloads below are copied from rows on a real run.
 */

import { describe, it, expect } from "vitest";
import { browserStepsFromTask, COORDINATE_ONLY } from "./learned-skills.service.js";

const step = (action: string | null, payload: unknown, plan: unknown = {}, phase = "action") =>
    ({ action, phase, payload, plan });

const geminiRun = [
    step("click", { actions: [{ action: "click", params: { x: 500, y: 115 } }] },
        { call: { name: "click", arguments: { x: 500, y: 115, intent: "Click address bar in Chromium" } } }),
    step("type", { actions: [{ action: "type_text", params: { text: "[REDACTED_TEXT:28]" } }, { action: "key_press", params: { key: "enter" } }] },
        { call: { name: "type", arguments: { intent: "Type URL and press enter" } } }),
    step("press_key", { actions: [{ action: "key_press", params: { key: "enter" } }] }),
    step("hotkey", { actions: [{ action: "hotkey", params: { keys: ["alt", "tab"] } }] }),
];

describe("browserStepsFromTask", () => {
    it("produces nothing from a run that only knew screen coordinates", () => {
        const { steps, skipped } = browserStepsFromTask(geminiRun);

        expect(steps).toEqual([]);
        expect(skipped.some((s) => s.reason === COORDINATE_ONLY)).toBe(true);
        // Every recorded action is accounted for rather than quietly dropped.
        expect(skipped.length).toBeGreaterThanOrEqual(geminiRun.length);
    });

    it("never invents a URL or a selector for a coordinate click", () => {
        const { steps } = browserStepsFromTask(geminiRun);
        expect(JSON.stringify(steps)).not.toContain("localhost");
        expect(JSON.stringify(steps)).not.toContain("body");
    });

    it("maps a browser run: navigation, a targeted fill, and a key press", () => {
        const { steps, skipped } = browserStepsFromTask([
            step("navigate", { actions: [{ action: "navigate", params: { url: "https://example.com/login" } }] }),
            step("fill", { url: "https://example.com/login", target: { tag: "input", css: "#user" }, text: "ada" }),
            step("press_key", { url: "https://example.com/login", actions: [{ action: "key_press", params: { key: "Enter" } }] }),
        ]);

        expect(skipped).toEqual([]);
        expect(steps).toEqual([
            { kind: "navigate", url: "https://example.com/login", direct: true, at: 1000 },
            { kind: "fill", url: "https://example.com/login", target: { tag: "input", css: "#user" }, value: "ada", at: 2000 },
            { kind: "press", url: "https://example.com/login", key: "Enter", at: 3000 },
        ]);
    });

    it("carries the page forward, so a later step inherits the URL it happened on", () => {
        const { steps } = browserStepsFromTask([
            step("navigate", { actions: [{ action: "navigate", params: { url: "https://example.com/a" } }] }),
            step("click", { target: { tag: "button", css: "#go" }, actions: [{ action: "click", params: {} }] }),
        ]);

        expect(steps[1]).toMatchObject({ kind: "click", url: "https://example.com/a", target: { css: "#go" } });
    });

    it("gives each extraction its own output name", () => {
        const { steps } = browserStepsFromTask([
            step("navigate", { actions: [{ action: "navigate", params: { url: "https://example.com" } }] }),
            step("dom_extract", { url: "https://example.com", selector: "h1", mode: "text" }),
            step("dom_extract", { url: "https://example.com", selector: "td", mode: "table" }),
        ]);

        const outputs = steps.filter((s) => s.kind === "extract").map((s) => s.output);
        expect(outputs).toEqual(["extracted_1", "extracted_2"]);
        expect(new Set(outputs).size).toBe(outputs.length);
    });

    it("refuses a navigation that recorded no URL rather than guessing one", () => {
        const { steps, skipped } = browserStepsFromTask([
            step("navigate", { actions: [{ action: "navigate", params: {} }] }),
        ]);

        expect(steps).toEqual([]);
        expect(skipped[0].reason).toContain("no URL");
    });

    it("keeps redacted text out of a skill, and says why", () => {
        const { steps, skipped } = browserStepsFromTask([
            step("navigate", { actions: [{ action: "navigate", params: { url: "https://example.com" } }] }),
            step("fill", { url: "https://example.com", target: { tag: "input", css: "#pw" }, text: "[REDACTED_TEXT:9]" }),
        ]);

        expect(steps).toHaveLength(1);
        expect(skipped[0].reason).toContain("redacted");
    });
});
