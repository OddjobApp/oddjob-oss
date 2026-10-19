/**
 * SchemaInferenceService Tests — 100% coverage of infer() and all private helpers
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
}));

import { SchemaInferenceService } from "@domain/knowledge/core/schema-inference.service.js";

const svc = new SchemaInferenceService();

describe("SchemaInferenceService.infer", () => {
    describe("null", () => {
        it("should return { type: 'null' } for null", () => {
            expect(svc.infer(null)).toEqual({ type: "null" });
        });
    });

    describe("primitives", () => {
        it("returns string type for plain string", () => {
            expect(svc.infer("hello")).toEqual({ type: "string" });
        });

        it("returns date-time format for ISO date string", () => {
            expect(svc.infer("2024-01-15T10:00:00")).toEqual({ type: "string", format: "date-time" });
        });

        it("returns email format for email string", () => {
            expect(svc.infer("user@example.com")).toEqual({ type: "string", format: "email" });
        });

        it("returns uri format for URL string", () => {
            expect(svc.infer("https://example.com/path")).toEqual({ type: "string", format: "uri" });
        });

        it("returns number type for numbers", () => {
            expect(svc.infer(42)).toEqual({ type: "number" });
            expect(svc.infer(3.14)).toEqual({ type: "number" });
        });

        it("returns boolean type for booleans", () => {
            expect(svc.infer(true)).toEqual({ type: "boolean" });
            expect(svc.infer(false)).toEqual({ type: "boolean" });
        });
    });

    describe("arrays", () => {
        it("returns array type with empty items for empty array", () => {
            const result = svc.infer([]);
            expect(result.type).toBe("array");
            expect(result.items).toEqual({});
        });

        it("infers item type from first element of string array", () => {
            const result = svc.infer(["hello", "world"]);
            expect(result.type).toBe("array");
            expect(result.items?.type).toBe("string");
        });

        it("infers item type from first element of number array", () => {
            const result = svc.infer([1, 2, 3]);
            expect(result.items?.type).toBe("number");
        });

        it("infers nested object schema from first element", () => {
            const result = svc.infer([{ id: 1, name: "Alice" }]);
            expect(result.type).toBe("array");
            expect(result.items?.type).toBe("object");
            expect(result.items?.properties?.id).toEqual({ type: "number" });
        });
    });

    describe("objects", () => {
        it("returns object type with properties and required", () => {
            const result = svc.infer({ name: "Alice", age: 30 });
            expect(result.type).toBe("object");
            expect(result.properties?.name).toEqual({ type: "string" });
            expect(result.properties?.age).toEqual({ type: "number" });
            expect(result.required).toContain("name");
            expect(result.required).toContain("age");
        });

        it("skips __metadata keys", () => {
            const result = svc.infer({ name: "Bob", __metadata: { internal: true } });
            expect(result.properties?.__metadata).toBeUndefined();
            expect(result.properties?.name).toBeDefined();
        });

        it("skips formatted_prompt keys", () => {
            const result = svc.infer({ title: "test", formatted_prompt: "secret" });
            expect(result.properties?.formatted_prompt).toBeUndefined();
        });

        it("returns date-time schema for Date instance", () => {
            const result = svc.infer(new Date());
            expect(result).toEqual({ type: "string", format: "date-time" });
        });

        it("handles nested objects recursively", () => {
            const result = svc.infer({ user: { email: "a@b.com" } });
            expect(result.properties?.user?.type).toBe("object");
            expect(result.properties?.user?.properties?.email?.format).toBe("email");
        });

        it("handles null values in object fields", () => {
            const result = svc.infer({ active: null });
            expect(result.properties?.active).toEqual({ type: "null" });
        });

        it("handles nested arrays in object", () => {
            const result = svc.infer({ tags: ["typescript", "rust"] });
            expect(result.properties?.tags?.type).toBe("array");
        });
    });
});
