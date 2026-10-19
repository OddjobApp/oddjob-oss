import { describe, expect, it } from "vitest";
import { normalizeAuditFilter, parseProposalId } from "../../server/services/self-modification-input";

describe("self-modification admin input", () => {
    it("normalizes audit filters", () => {
        expect(normalizeAuditFilter(undefined)).toBeUndefined();
        expect(normalizeAuditFilter("  code_edit  ")).toBe("code_edit");
        expect(normalizeAuditFilter("   ")).toBeUndefined();
    });

    it("rejects invalid filters", () => {
        expect(() => normalizeAuditFilter(["code_edit"])).toThrow("must be a string");
        expect(() => normalizeAuditFilter("x".repeat(101))).toThrow("cannot exceed 100");
    });

    it("accepts only positive safe proposal IDs", () => {
        expect(parseProposalId("42")).toBe(42);
        for (const invalid of ["0", "-1", "1.5", "nope", "9007199254740992"]) {
            expect(() => parseProposalId(invalid)).toThrow("Invalid proposal id");
        }
    });
});
