/**
 * Clicking "Resolve" on a rescue showed the operator "[object Object]".
 *
 * completeDispatch built its message with `String(result.error)`. This platform's
 * failure envelope is { success: false, error: { code, message, statusCode } }, so
 * result.error is an OBJECT and String(object) is literally "[object Object]" — the
 * actual reason sat unread in result.error.message.
 *
 * That mattered beyond cosmetics: the underlying call was failing for a nameable
 * reason, and the UI replaced it with a string that says nothing at all.
 */
import { describe, it, expect } from "vitest";
import { extractErrorMessage } from "./TacticalDispatchDashboard";

describe("extractErrorMessage", () => {
    it("reads the platform error envelope instead of stringifying it", () => {
        const body = {
            success: false,
            error: { code: "NOT_FOUND", message: "Pipeline not found", statusCode: 404 },
        };
        expect(extractErrorMessage(body)).toBe("Pipeline not found");
        expect(extractErrorMessage(body)).not.toContain("object Object");
    });

    it("accepts a plain string error field", () => {
        expect(extractErrorMessage({ error: "Budget exceeded" })).toBe("Budget exceeded");
    });

    it("falls back to a top-level message", () => {
        expect(extractErrorMessage({ message: "Upstream timed out" })).toBe("Upstream timed out");
    });

    it("returns JSON rather than [object Object] for an unrecognised shape", () => {
        const out = extractErrorMessage({ weird: { nested: true } });
        expect(out).not.toContain("object Object");
        expect(out).toBe('{"weird":{"nested":true}}');
    });

    it("ignores an empty envelope message and keeps looking", () => {
        // An empty error box is worse than a raw body.
        const out = extractErrorMessage({ error: { message: "   " }, message: "Real reason" });
        expect(out).toBe("Real reason");
    });

    it("handles a bare string body", () => {
        expect(extractErrorMessage("Internal Server Error")).toBe("Internal Server Error");
    });

    it("never returns [object Object] for any of these", () => {
        const bodies = [
            { error: { code: "X" } },
            { error: {} },
            {},
            null,
            undefined,
        ];
        for (const b of bodies) expect(extractErrorMessage(b)).not.toContain("object Object");
    });
});
