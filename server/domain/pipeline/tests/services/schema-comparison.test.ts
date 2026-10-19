/**
 * SchemaComparisonService Tests — 100% coverage of pure comparison logic
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@domain/core/infrastructure/SchemaInferenceService.service.js", () => ({
    JSONSchema: {}
}));

vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
}));

import { SchemaComparisonService } from "@domain/knowledge/core/schema-comparison.service.js";

const svc = new SchemaComparisonService();

describe("SchemaComparisonService.compare", () => {
    it("should return no changes when schemas are identical", () => {
        const schema = { type: "object", properties: { name: { type: "string" } } };
        const result = svc.compare(schema as any, schema as any);
        expect(result.hasChanges).toBe(false);
        expect(result.breakingChanges).toHaveLength(0);
        expect(result.nonBreakingChanges).toHaveLength(0);
    });

    it("should detect FIELD_ADDED as non-breaking", () => {
        const old = { type: "object", properties: { name: { type: "string" } } };
        const next = { type: "object", properties: { name: { type: "string" }, age: { type: "number" } } };
        const result = svc.compare(old as any, next as any);
        expect(result.hasChanges).toBe(true);
        expect(result.nonBreakingChanges.some(c => c.type === "FIELD_ADDED" && c.path === "age")).toBe(true);
        expect(result.breakingChanges).toHaveLength(0);
    });

    it("should detect FIELD_REMOVED as breaking", () => {
        const old = { type: "object", properties: { name: { type: "string" }, age: { type: "number" } } };
        const next = { type: "object", properties: { name: { type: "string" } } };
        const result = svc.compare(old as any, next as any);
        expect(result.hasChanges).toBe(true);
        expect(result.breakingChanges.some(c => c.type === "FIELD_REMOVED" && c.path === "age")).toBe(true);
    });

    it("should detect TYPE_CHANGED as breaking", () => {
        const old = { type: "object", properties: { id: { type: "string" } } };
        const next = { type: "object", properties: { id: { type: "number" } } };
        const result = svc.compare(old as any, next as any);
        expect(result.breakingChanges.some(c => c.type === "TYPE_CHANGED" && c.path === "id")).toBe(true);
    });

    it("should detect top-level type change to null as breaking", () => {
        const old = { type: "string" };
        const next = { type: "null" };
        const result = svc.compare(old as any, next as any);
        expect(result.breakingChanges.some(c => c.type === "TYPE_CHANGED" && c.newValue === "null")).toBe(true);
    });

    it("should detect type change between non-null types as breaking", () => {
        const old = { type: "string" };
        const next = { type: "number" };
        const result = svc.compare(old as any, next as any);
        expect(result.breakingChanges.some(c => c.type === "TYPE_CHANGED")).toBe(true);
    });

    it("should recurse into nested objects", () => {
        const old = {
            type: "object",
            properties: {
                user: { type: "object", properties: { email: { type: "string" } } }
            }
        };
        const next = {
            type: "object",
            properties: {
                user: { type: "object", properties: {} }
            }
        };
        const result = svc.compare(old as any, next as any);
        expect(result.breakingChanges.some(c => c.path === "user.email")).toBe(true);
    });

    it("should recurse into array items", () => {
        const old = {
            type: "array",
            items: { type: "object", properties: { id: { type: "number" } } }
        };
        const next = {
            type: "array",
            items: { type: "object", properties: { id: { type: "string" } } }
        };
        const result = svc.compare(old as any, next as any);
        expect(result.breakingChanges.some(c => c.type === "TYPE_CHANGED" && c.path.includes("id"))).toBe(true);
    });

    it("should use nested path separator for deep changes", () => {
        const old = {
            type: "object",
            properties: {
                parent: { type: "object", properties: { child: { type: "string" } } }
            }
        };
        const next = {
            type: "object",
            properties: {
                parent: { type: "object", properties: { child: { type: "string" }, extra: { type: "boolean" } } }
            }
        };
        const result = svc.compare(old as any, next as any);
        expect(result.nonBreakingChanges.some(c => c.path === "parent.extra")).toBe(true);
    });

    it("should report hasChanges false for two different types that are equivalent strings", () => {
        // Same type string representation — no change
        const old = { type: "string" };
        const next = { type: "string" };
        const result = svc.compare(old as any, next as any);
        expect(result.hasChanges).toBe(false);
    });
});
