/**
 * dataset/utils.ts Tests — pure validation logic, 100% coverage
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@shared/schema", () => ({ datasets: {} }));
vi.mock("drizzle-orm", () => ({
    eq: vi.fn(),
    sql: vi.fn()
}));

import { validateRecord } from "@domain/knowledge/core/dataset/utils.js";

describe("validateRecord", () => {
    it("should return empty array when no rules", () => {
        expect(validateRecord({ name: "Alice" }, null)).toEqual([]);
        expect(validateRecord({ name: "Alice" }, undefined)).toEqual([]);
    });

    it("should ignore non-array rule specs", () => {
        const errors = validateRecord({ name: "Alice" }, { name: "not-an-array" });
        expect(errors).toEqual([]);
    });

    describe("required rule", () => {
        it("should error when required field is missing", () => {
            const errors = validateRecord({}, { name: [{ type: "required" }] });
            expect(errors).toContain("name is required");
        });

        it("should error when required field is empty string", () => {
            const errors = validateRecord({ name: "" }, { name: [{ type: "required" }] });
            expect(errors).toContain("name is required");
        });

        it("should error when required field is null", () => {
            const errors = validateRecord({ name: null }, { name: [{ type: "required" }] });
            expect(errors).toContain("name is required");
        });

        it("should use custom message for required", () => {
            const errors = validateRecord({}, { name: [{ type: "required", message: "Name is mandatory" }] });
            expect(errors[0]).toBe("Name is mandatory");
        });

        it("should pass when required field has a value", () => {
            const errors = validateRecord({ name: "Alice" }, { name: [{ type: "required" }] });
            expect(errors).toHaveLength(0);
        });
    });

    describe("regex rule", () => {
        it("should error when value does not match pattern", () => {
            const errors = validateRecord(
                { code: "abc123" },
                { code: [{ type: "regex", params: { pattern: "^\\d+$" } }] }
            );
            expect(errors).toContain("code format is invalid");
        });

        it("should pass when value matches pattern", () => {
            const errors = validateRecord(
                { code: "12345" },
                { code: [{ type: "regex", params: { pattern: "^\\d+$" } }] }
            );
            expect(errors).toHaveLength(0);
        });

        it("should skip regex check if value is empty", () => {
            const errors = validateRecord(
                { code: "" },
                { code: [{ type: "regex", params: { pattern: "^\\d+$" } }] }
            );
            expect(errors).toHaveLength(0);
        });

        it("should use custom message for regex failure", () => {
            const errors = validateRecord(
                { code: "abc" },
                { code: [{ type: "regex", params: { pattern: "^\\d+$" }, message: "Must be digits" }] }
            );
            expect(errors[0]).toBe("Must be digits");
        });
    });

    describe("number_range rule", () => {
        it("should error for non-numeric value", () => {
            const errors = validateRecord(
                { age: "abc" },
                { age: [{ type: "number_range", params: { min: 0, max: 100 } }] }
            );
            expect(errors).toContain("age must be a number");
        });

        it("should error when below min", () => {
            const errors = validateRecord(
                { age: -1 },
                { age: [{ type: "number_range", params: { min: 0 } }] }
            );
            expect(errors[0]).toMatch(/at least/);
        });

        it("should error when above max", () => {
            const errors = validateRecord(
                { age: 200 },
                { age: [{ type: "number_range", params: { max: 100 } }] }
            );
            expect(errors[0]).toMatch(/at most/);
        });

        it("should pass when in range", () => {
            const errors = validateRecord(
                { age: 25 },
                { age: [{ type: "number_range", params: { min: 0, max: 100 } }] }
            );
            expect(errors).toHaveLength(0);
        });

        it("should use custom message for range violation", () => {
            const errors = validateRecord(
                { age: -5 },
                { age: [{ type: "number_range", params: { min: 0 }, message: "Too young" }] }
            );
            expect(errors[0]).toBe("Too young");
        });
    });

    describe("email rule", () => {
        it("should error for invalid email", () => {
            const errors = validateRecord(
                { email: "not-an-email" },
                { email: [{ type: "email" }] }
            );
            expect(errors).toContain("email must be a valid email");
        });

        it("should pass for valid email", () => {
            const errors = validateRecord(
                { email: "user@example.com" },
                { email: [{ type: "email" }] }
            );
            expect(errors).toHaveLength(0);
        });

        it("should skip for empty value", () => {
            const errors = validateRecord({ email: "" }, { email: [{ type: "email" }] });
            expect(errors).toHaveLength(0);
        });
    });

    describe("url rule", () => {
        it("should error for invalid URL", () => {
            const errors = validateRecord(
                { website: "not a url" },
                { website: [{ type: "url" }] }
            );
            expect(errors).toContain("website must be a valid URL");
        });

        it("should pass for valid URL", () => {
            const errors = validateRecord(
                { website: "https://example.com" },
                { website: [{ type: "url" }] }
            );
            expect(errors).toHaveLength(0);
        });

        it("should skip for empty value", () => {
            const errors = validateRecord({ website: "" }, { website: [{ type: "url" }] });
            expect(errors).toHaveLength(0);
        });
    });

    describe("enum rule", () => {
        it("should error when value not in enum", () => {
            const errors = validateRecord(
                { status: "unknown" },
                { status: [{ type: "enum", params: { values: ["active", "inactive"] } }] }
            );
            expect(errors[0]).toMatch(/must be one of/);
        });

        it("should pass when value is in enum", () => {
            const errors = validateRecord(
                { status: "active" },
                { status: [{ type: "enum", params: { values: ["active", "inactive"] } }] }
            );
            expect(errors).toHaveLength(0);
        });

        it("should skip for empty value", () => {
            const errors = validateRecord(
                { status: "" },
                { status: [{ type: "enum", params: { values: ["active", "inactive"] } }] }
            );
            expect(errors).toHaveLength(0);
        });

        it("should use custom message for enum failure", () => {
            const errors = validateRecord(
                { status: "bad" },
                { status: [{ type: "enum", params: { values: ["active"] }, message: "Invalid status" }] }
            );
            expect(errors[0]).toBe("Invalid status");
        });
    });

    it("should collect multiple errors across multiple fields", () => {
        const errors = validateRecord({}, {
            name: [{ type: "required" }],
            email: [{ type: "required" }]
        });
        expect(errors).toHaveLength(2);
    });
});
