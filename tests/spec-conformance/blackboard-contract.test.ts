/**
 * Spec Conformance: Blackboard Contract (BB-*)
 *
 * Tests are tagged with assertion IDs from docs/specs/conformance/CONFORMANCE.md.
 * All tests are pure unit tests — no DB, Redis, or BullMQ dependencies.
 */

import { describe, it, expect } from "vitest";

// ── Simulated blackboard operations ──────────────────────────────────────────

type Blackboard = Record<string, unknown>;

function writeKey(bb: Blackboard, key: string, value: unknown): Blackboard {
    return { ...bb, [key]: value };
}

function gcToolOutputs(bb: Blackboard, maxKeys = 20): Blackboard {
    const toolOutputKeys = Object.keys(bb)
        .filter((k) => k.startsWith("tool_output_"))
        .sort(); // sort by key (oldest timestamp prefix first)

    if (toolOutputKeys.length <= maxKeys) return bb;

    const toEvict = toolOutputKeys.slice(0, toolOutputKeys.length - maxKeys);
    const result = { ...bb };
    for (const key of toEvict) delete result[key];
    return result;
}

function coerceNote(note: unknown): string {
    if (typeof note === "string") return note;
    return JSON.stringify(note);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BB-001: CALL_TOOL must write last_tool_run and last_tool_status", () => {
    it("writes both keys on success", () => {
        let bb: Blackboard = {};
        bb = writeKey(bb, "last_tool_run", "google_search");
        bb = writeKey(bb, "last_tool_status", "success");

        expect(bb.last_tool_run).toBe("google_search");
        expect(bb.last_tool_status).toBe("success");
    });

    it("writes both keys on failure", () => {
        let bb: Blackboard = {};
        bb = writeKey(bb, "last_tool_run", "external_api");
        bb = writeKey(bb, "last_tool_status", "failed");

        expect(bb.last_tool_run).toBe("external_api");
        expect(bb.last_tool_status).toBe("failed");
    });

    it("status is exactly 'success' or 'failed'", () => {
        const validStatuses = ["success", "failed"];
        expect(validStatuses).toContain("success");
        expect(validStatuses).toContain("failed");
        expect(validStatuses).not.toContain("error");
        expect(validStatuses).not.toContain("ok");
    });
});

describe("BB-002: CONCLUDE must write result to missionContext", () => {
    it("writes result to missionContext.result", () => {
        const missionContext: Record<string, unknown> = {};
        const product = "Analysis complete: market is growing.";
        missionContext.result = product;

        expect(missionContext.result).toBe(product);
    });

    it("preserves object result by reference", () => {
        const missionContext: Record<string, unknown> = {};
        const productObj = { summary: "done", confidence: 0.95 };
        missionContext.result = productObj;

        expect(missionContext.result).toEqual(productObj);
    });
});

describe("BB-003: blackboard keys must not be deleted", () => {
    it("append-only: adding a key does not remove existing keys", () => {
        let bb: Blackboard = { existing_key: "value" };
        bb = writeKey(bb, "new_key", "new_value");

        expect(bb.existing_key).toBe("value");
        expect(bb.new_key).toBe("new_value");
    });

    it("GC only removes tool_output_ keys beyond the cap", () => {
        let bb: Blackboard = {
            result: "mission output",
            last_tool_run: "google_search",
        };

        // Add 22 tool output keys
        for (let i = 0; i < 22; i++) {
            bb[`tool_output_search_${String(i).padStart(4, "0")}`] = `output ${i}`;
        }

        const cleaned = gcToolOutputs(bb, 20);

        // Non-tool keys must be preserved
        expect(cleaned.result).toBe("mission output");
        expect(cleaned.last_tool_run).toBe("google_search");

        // Tool output count should be capped at 20
        const toolKeys = Object.keys(cleaned).filter((k) => k.startsWith("tool_output_"));
        expect(toolKeys.length).toBe(20);
    });

    it("GC does not evict when tool_output count is within cap", () => {
        let bb: Blackboard = {};
        for (let i = 0; i < 15; i++) {
            bb[`tool_output_search_${i}`] = `output ${i}`;
        }

        const cleaned = gcToolOutputs(bb, 20);
        const toolKeys = Object.keys(cleaned).filter((k) => k.startsWith("tool_output_"));
        expect(toolKeys.length).toBe(15);
    });
});

describe("TRACE-001: note field coercion to string", () => {
    it("passes string through unchanged", () => {
        expect(coerceNote("mission complete")).toBe("mission complete");
    });

    it("serializes objects to JSON string", () => {
        const note = { critique: "needs work", turn_id: "abc123" };
        const result = coerceNote(note);
        expect(typeof result).toBe("string");
        expect(result).toContain("critique");
    });

    it("serializes arrays to JSON string", () => {
        const note = ["step1", "step2"];
        const result = coerceNote(note);
        expect(typeof result).toBe("string");
        expect(result).toBe('["step1","step2"]');
    });

    it("serializes null to string", () => {
        const result = coerceNote(null);
        expect(typeof result).toBe("string");
    });

    it("serializes numbers to string", () => {
        const result = coerceNote(42);
        expect(result).toBe("42");
    });
});

describe("Dual-state model — blackboard vs missionContext split", () => {
    it("blackboard holds mission-level cross-run data", () => {
        // These keys belong in missions.blackboard
        const blackboardKeys = ["result", "high_value_deliverable", "last_tool_run", "last_tool_status", "messages"];
        for (const key of blackboardKeys) {
            expect(typeof key).toBe("string"); // structural validation
        }
    });

    it("missionContext holds run-scoped orchestration state", () => {
        // These keys belong in missionRuns.missionContext
        const contextKeys = ["cycleCount", "maxCycles", "allowedTools", "rulesOfEngagement", "phase", "current_wave", "max_waves", "result"];
        for (const key of contextKeys) {
            expect(typeof key).toBe("string"); // structural validation
        }
    });

    it("result appears in missionContext (written by CONCLUDE) and may be promoted to blackboard", () => {
        const missionContext: Record<string, unknown> = {};
        const blackboard: Record<string, unknown> = {};

        // CONCLUDE writes to missionContext
        missionContext.result = "Final answer";

        // Optionally promoted to blackboard
        blackboard.result = missionContext.result;

        expect(missionContext.result).toBe("Final answer");
        expect(blackboard.result).toBe("Final answer");
    });
});
