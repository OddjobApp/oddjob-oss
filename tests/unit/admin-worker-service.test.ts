import { describe, expect, it } from "vitest";
import { normalizeDlqLimit } from "../../server/services/admin-worker.service";

describe("normalizeDlqLimit", () => {
    it("uses the default for missing or invalid values", () => {
        expect(normalizeDlqLimit(undefined)).toBe(50);
        expect(normalizeDlqLimit("nope")).toBe(50);
        expect(normalizeDlqLimit("0")).toBe(50);
        expect(normalizeDlqLimit("1.5")).toBe(50);
    });

    it("accepts positive integers and caps large limits", () => {
        expect(normalizeDlqLimit("25")).toBe(25);
        expect(normalizeDlqLimit("500")).toBe(200);
    });
});
