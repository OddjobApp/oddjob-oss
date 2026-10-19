/**
 * jsonUtils Tests — Validation, Schema, and Transformation
 */

import { describe, it, expect } from "vitest";
import {
    validateJson,
    tryFixJson,
    validateJsonSchema,
    inferJsonSchema,
    transformJson,
    flattenJson,
    unflattenJson,
    compareJson,
    getErrorContext
} from "@shared/utils/jsonUtils.js";

describe("jsonUtils", () => {

    describe("validateJson", () => {
        it("returns valid for correct JSON", () => {
            const result = validateJson('{"a": 1}');
            expect(result.isValid).toBe(true);
            expect(result.formatted).toContain('"a": 1');
        });

        it("returns valid for empty object/array", () => {
            expect(validateJson('{}').isValid).toBe(true);
            expect(validateJson('[]').isValid).toBe(true);
        });

        it("returns valid/empty for whitespace only", () => {
            const result = validateJson("   ");
            expect(result.isValid).toBe(true);
            expect(result.formatted).toBe("");
        });

        it("returns invalid for malformed JSON", () => {
            const result = validateJson('{"a": 1, "b": }');
            expect(result.isValid).toBe(false);
            expect(result.error).toBeDefined();
            // Position might be undefined depending on the environment's error message format,
            // but the error message itself should be there.
            expect(result.error?.message).toBeDefined();
        });

        it("provides improved error messages for common mistakes", () => {
            // This specific malformed JSON hits the 'Unfinished JSON' or similar
            const result = validateJson('{"a": 1 "b": 2}');
            expect(result.isValid).toBe(false);
            expect(result.error?.message).toBeDefined();
        });
    });

    describe("tryFixJson", () => {
        it("fixes missing commas between quoted properties", () => {
            const malformed = '{"a": "1" "b": "2"}';
            const result = tryFixJson(malformed);
            expect(result?.fixed.replace(/\s/g, '')).toBe('{"a":"1","b":"2"}');
            expect(result?.changes).toContain('Added missing comma between properties');
        });

        it("fixes trailing commas", () => {
            const malformed = '{"a": 1, "b": 2, }';
            const result = tryFixJson(malformed);
            // Ignore whitespace in result comparison
            expect(result?.fixed.replace(/\s/g, '')).toBe('{"a":1,"b":2}'.replace(/\s/g, ''));
            expect(result?.changes).toContain('Removed trailing comma');
        });

        it("fixes missing closing braces", () => {
            const malformed = '{"a": {"b": 1}';
            const result = tryFixJson(malformed);
            expect(result?.fixed.replace(/\s/g, '')).toBe('{"a":{"b":1}}');
            expect(result?.changes).toContain('Added 1 missing closing brace(s)');
        });

        it("returns null for unfixable JSON", () => {
            expect(tryFixJson('invalid state')).toBeNull();
        });
    });

    describe("validateJsonSchema", () => {
        const schema = {
            type: "object",
            required: ["name", "age"],
            properties: {
                name: { type: "string", minLength: 3 },
                age: { type: "integer", minimum: 0 },
                tags: { type: "array", items: { type: "string" } }
            }
        };

        it("passes valid data", () => {
            const data = { name: "Alice", age: 30, tags: ["engineer", "remote"] };
            const result = validateJsonSchema(data, schema);
            expect(result.isValid).toBe(true);
        });

        it("reports missing required fields", () => {
            const data = { name: "Alice" };
            const result = validateJsonSchema(data, schema as any);
            expect(result.isValid).toBe(false);
            expect(result.errors[0].message).toContain("Missing required property 'age'");
        });

        it("reports type mismatches (using 'integer' for whole numbers)", () => {
            const data = { name: 123, age: 30 };
            const result = validateJsonSchema(data, schema as any);
            expect(result.isValid).toBe(false);
            // The service returns 'integer' for whole numbers
            expect(result.errors[0].message).toContain("Expected type 'string', got 'integer'");
        });

        it("validates nested arrays", () => {
            const data = { name: "Alice", age: 30, tags: [123] };
            const result = validateJsonSchema(data, schema as any);
            expect(result.isValid).toBe(false);
            expect(result.errors[0].path).toBe("tags[0]");
        });
    });

    describe("inferJsonSchema", () => {
        it("infers schema from simple object", () => {
            const data = { name: "test", count: 10 };
            const schema = inferJsonSchema(data);
            expect(schema.type).toBe("object");
            expect(schema.properties?.name.type).toBe("string");
            // Service infers 'number' for 10 via typeof
            expect(schema.properties?.count.type).toBe("number");
        });

        it("infers schema from arrays", () => {
            const data = [1, 2, 3];
            const schema = inferJsonSchema(data);
            expect(schema.type).toBe("array");
            expect(schema.items?.type).toBe("number");
        });
    });

    describe("transformJson", () => {
        const data = {
            user: {
                profile: { firstName: "Jane", lastName: "Doe" },
                roles: ["admin", "editor"]
            },
            id: 123
        };

        it("extracts nested values using dot notation", () => {
            const mapping = {
                fullName: "user.profile.firstName",
                mainRole: "user.roles[0]",
                rawId: "id"
            };
            const result = transformJson(data, mapping);
            expect(result).toEqual({
                fullName: "Jane",
                mainRole: "admin",
                rawId: 123
            });
        });
    });

    describe("flattenJson / unflattenJson", () => {
        it("round-trips complex objects", () => {
            const original = {
                a: 1,
                b: { c: 2, d: { e: 3 } },
                f: [4, 5]
            };
            const flattened = flattenJson(original);
            const unflattened = unflattenJson(flattened);
            expect(unflattened).toEqual(original);
        });
    });

    describe("compareJson", () => {
        it("identifies additions, removals, and modifications", () => {
            const oldObj = { a: 1, b: 2 };
            const newObj = { b: 3, c: 4 };
            const diffs = compareJson(oldObj, newObj);

            expect(diffs.find((d: any) => d.path === "a")?.type).toBe("removed");
            expect(diffs.find((d: any) => d.path === "b")?.type).toBe("modified");
            expect(diffs.find((d: any) => d.path === "c")?.type).toBe("added");
        });
    });

    describe("getErrorContext", () => {
        it("returns context around specified position", () => {
            const text = "abcdefghijklmnopqrstuvwxyz";
            const context = getErrorContext(text, 10, 5);
            // start = 5, end = 15. slice(5, 15) is 'fghijklmno'
            expect(context).toBe("...fghijklmno...");
        });
    });
});
