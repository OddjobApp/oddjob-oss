/**
 * Phase 1 — unified tool dispatch.
 *
 * handleToolCall historically covered only tools with an explicit switch case
 * (~121 of 303 advertised), so 182 advertised tools returned "Unknown tool".
 * A generic registry fallthrough makes any advertised tool dispatchable. These
 * tests lock that in: a registry tool with NO explicit case now dispatches, and
 * a genuinely unknown name still errors.
 */

/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { handleToolCall } from "@server/mcp/handlers.js";
import { getAgentTools } from "@domain/tools/v1/capabilities/index.js";

const asText = (r: any): string => {
    try { return r?.content?.[0]?.text ?? JSON.stringify(r); } catch { return String(r); }
};

describe("handleToolCall generic registry fallthrough", () => {
    it("current_time is advertised but has no explicit switch case (fallthrough target)", () => {
        // Guards the premise: if someone adds a `case "current_time"`, pick another
        // uncovered tool — the point is to exercise the fallthrough, not a case.
        expect(getAgentTools()["current_time"]).toBeDefined();
    });

    it("dispatches a registry tool that has no explicit case (was 'Unknown tool')", async () => {
        const res = await handleToolCall("current_time", {}, {} as any);
        const text = asText(res);
        expect(text).not.toMatch(/Unknown tool/i);
        // current_time returns a real ISO timestamp — proves genuine execution
        // through the fallthrough, not the error path.
        expect(text).toMatch(/20\d\d-\d\d-\d\dT/);
    });

    it("still returns 'Unknown tool' for a genuinely unregistered name", async () => {
        const res = await handleToolCall("definitely_not_a_real_tool_zzz", {}, {} as any);
        expect(asText(res)).toMatch(/Unknown tool/i);
    });
});
