/**
 * flattening-service.ts Tests — pure function coverage
 * Targets all uncovered branches: coercion, transforms, hygiene, mapping, edge cases
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
}));

import {
    flattenObject,
    applySchemaMapping,
    flattenForDataset,
    extractFields,
    getAvailableFields,
    getFieldsWithTypes,
    inferType,
    coerceValue,
    applyTransform,
    applyHygiene,
} from "@domain/knowledge/core/flattening-service.js";

// ─── inferType ────────────────────────────────────────────────────────────────

describe("inferType", () => {
    it("returns 'text' for null", () => expect(inferType(null)).toBe("text"));
    it("returns 'text' for undefined", () => expect(inferType(undefined)).toBe("text"));
    it("returns 'boolean'", () => expect(inferType(true)).toBe("boolean"));
    it("returns 'number' for numeric", () => expect(inferType(42)).toBe("number"));
    it("returns 'date' for Date instance", () => expect(inferType(new Date())).toBe("date"));
    it("returns 'date' for ISO string", () => expect(inferType("2024-01-15T10:00:00Z")).toBe("date"));
    it("returns 'number' for numeric string", () => expect(inferType("3.14")).toBe("number"));
    it("returns 'text' for empty string", () => expect(inferType("")).toBe("text"));
    it("returns 'text' for whitespace string", () => expect(inferType("   ")).toBe("text"));
    it("returns 'text' for plain string", () => expect(inferType("hello")).toBe("text"));
    it("returns 'json' for plain object", () => expect(inferType({ a: 1 })).toBe("json"));
});

// ─── coerceValue ──────────────────────────────────────────────────────────────

describe("coerceValue", () => {
    it("returns null for null input", () => expect(coerceValue(null, "text")).toBeNull());
    it("returns null for undefined input", () => expect(coerceValue(undefined, "text")).toBeNull());

    describe("text", () => {
        it("stringifies objects", () => expect(coerceValue({ a: 1 }, "text")).toBe('{"a":1}'));
        it("converts number to string", () => expect(coerceValue(42, "text")).toBe("42"));
    });

    describe("number", () => {
        it("passes through numbers", () => expect(coerceValue(7, "number")).toBe(7));
        it("converts '3.14' to 3.14", () => expect(coerceValue("3.14", "number")).toBeCloseTo(3.14));
        it("returns null for non-numeric string", () => expect(coerceValue("abc", "number")).toBeNull());
    });

    describe("boolean", () => {
        it("passes through booleans", () => expect(coerceValue(false, "boolean")).toBe(false));
        it("'true' string → true", () => expect(coerceValue("true", "boolean")).toBe(true));
        it("'1' string → true", () => expect(coerceValue("1", "boolean")).toBe(true));
        it("'yes' string → true", () => expect(coerceValue("yes", "boolean")).toBe(true));
        it("'false' string → false", () => expect(coerceValue("false", "boolean")).toBe(false));
    });

    describe("date", () => {
        it("converts Date instance to ISO string", () => {
            const d = new Date("2024-01-01");
            expect(coerceValue(d, "date")).toBe(d.toISOString());
        });
        it("converts date string to ISO string", () => {
            const result = coerceValue("2024-06-15", "date");
            expect(typeof result).toBe("string");
            expect(result).toContain("2024");
        });
        it("returns null for invalid date", () => expect(coerceValue("not-a-date", "date")).toBeNull());
    });

    describe("json", () => {
        it("returns value as-is", () => {
            const obj = { x: 1 };
            expect(coerceValue(obj, "json")).toBe(obj);
        });
    });

    it("returns value unchanged for unknown type", () => {
        expect(coerceValue("hello", "unknown_type")).toBe("hello");
    });
});

// ─── applyTransform ───────────────────────────────────────────────────────────

describe("applyTransform", () => {
    it("returns value unchanged when no transform", () => expect(applyTransform("Hello", undefined)).toBe("Hello"));
    it("returns value unchanged when transform='none'", () => expect(applyTransform("Hello", "none")).toBe("Hello"));
    it("returns value unchanged for null", () => expect(applyTransform(null, "uppercase")).toBeNull());
    it("uppercase transform", () => expect(applyTransform("hello", "uppercase")).toBe("HELLO"));
    it("lowercase transform", () => expect(applyTransform("HELLO", "lowercase")).toBe("hello"));
    it("trim transform", () => expect(applyTransform("  hi  ", "trim")).toBe("hi"));
    it("unknown transform returns original", () => expect(applyTransform("val", "regex")).toBe("val"));
});

// ─── flattenObject ────────────────────────────────────────────────────────────

describe("flattenObject", () => {
    it("returns empty for null input", () => expect(flattenObject(null)).toEqual({}));
    it("returns empty for undefined input", () => expect(flattenObject(undefined)).toEqual({}));

    it("returns primitive at root as { value: x }", () => {
        expect(flattenObject(42)).toEqual({ value: 42 });
    });

    it("flattens nested object", () => {
        const result = flattenObject({ a: { b: 1 } });
        expect(result["a.b"]).toBe(1);
    });

    it("stores null values", () => {
        expect(flattenObject({ x: null })["x"]).toBeNull();
    });

    it("handles empty array with count", () => {
        const result = flattenObject({ items: [] });
        expect(result["items"]).toBe("[]");
        expect(result["items_count"]).toBe(0);
    });

    it("stores primitive array as JSON", () => {
        const result = flattenObject({ tags: [1, 2, 3] });
        expect(result["tags"]).toBe(JSON.stringify([1, 2, 3]));
        expect(result["tags_count"]).toBe(3);
    });

    it("flattens first item of object array as sample", () => {
        const result = flattenObject({ items: [{ id: 1 }, { id: 2 }] });
        expect(result["items[]_count"]).toBeUndefined(); // _count only on parent key
        expect(result["items_json"]).toBeDefined();
    });

    it("serializes array as JSON when max depth reached", () => {
        const result = flattenObject({ deep: [{ x: 1 }] }, { maxDepth: 0, currentDepth: 0 });
        expect(result["deep"]).toBe(JSON.stringify([{ x: 1 }]));
    });

    it("serializes nested object as JSON at max depth", () => {
        const result = flattenObject({ nested: { x: 1 } }, { maxDepth: 0, currentDepth: 0 });
        expect(result["nested"]).toBe('{"x":1}');
    });

    it("skips DEFAULT_SKIP_FIELDS like _links", () => {
        const result = flattenObject({ name: "test", _links: { self: "/" } });
        expect(result["name"]).toBe("test");
        expect(result["_links"]).toBeUndefined();
    });

    it("skips custom skip fields", () => {
        const result = flattenObject({ keep: 1, skip: 2 }, { skipFields: ["skip"] });
        expect(result["keep"]).toBe(1);
        expect(result["skip"]).toBeUndefined();
    });

    it("storeArrayCounts=false omits count", () => {
        const result = flattenObject({ tags: [1, 2] }, { storeArrayCounts: false });
        expect(result["tags_count"]).toBeUndefined();
    });

    it("uses prefix for root array", () => {
        const result = flattenObject([1, 2, 3]);
        expect(result["items"]).toBeDefined();
    });
});

// ─── applySchemaMapping ───────────────────────────────────────────────────────

describe("applySchemaMapping", () => {
    it("returns flattened unchanged when no mapping", () => {
        const flat = { a: 1, b: 2 };
        expect(applySchemaMapping(flat, null)).toBe(flat);
        expect(applySchemaMapping(flat, undefined)).toBe(flat);
    });

    it("filters to includedFields only", () => {
        const result = applySchemaMapping({ a: 1, b: 2 }, { includedFields: ["a"] });
        expect(result).toEqual({ a: 1 });
    });

    it("excludes excludedFields", () => {
        const result = applySchemaMapping({ a: 1, b: 2, c: 3 }, { excludedFields: ["b"] });
        expect(result["b"]).toBeUndefined();
        expect(result["a"]).toBe(1);
    });

    it("renames columns", () => {
        const result = applySchemaMapping({ old_name: "Alice" }, { columnRenames: { old_name: "name" } });
        expect(result["name"]).toBe("Alice");
        expect(result["old_name"]).toBeUndefined();
    });

    it("uses column definitions with type+transform", () => {
        const result = applySchemaMapping(
            { raw_status: "active" },
            {
                columns: [
                    { jsonPath: "raw_status", datasetKey: "status", type: "text", transform: "uppercase" }
                ]
            }
        );
        expect(result["status"]).toBe("ACTIVE");
    });

    it("skips column if jsonPath not in flattened", () => {
        const result = applySchemaMapping({ a: 1 }, { columns: [{ jsonPath: "missing", datasetKey: "x", type: "text" }] });
        expect(result["x"]).toBeUndefined();
    });
});

// ─── extractFields ────────────────────────────────────────────────────────────

describe("extractFields", () => {
    it("extracts nested paths using dot notation", () => {
        const data = { user: { name: "Alice" } };
        const result = extractFields(data, [{ jsonPath: "user.name", datasetKey: "userName", type: "text" }]);
        expect(result["userName"]).toBe("Alice");
    });

    it("returns null for missing paths", () => {
        const result = extractFields({}, [{ jsonPath: "nonexistent", datasetKey: "x", type: "text" }]);
        expect(result["x"]).toBeNull();
    });
});

// ─── flattenForDataset ────────────────────────────────────────────────────────

describe("flattenForDataset", () => {
    it("flattens with no schema mapping", () => {
        const { raw, flattened } = flattenForDataset({ name: "Alice" });
        expect(raw).toEqual({ name: "Alice" });
        expect(flattened["name"]).toBe("Alice");
    });

    it("uses identity mapping when schemaMapping=null", () => {
        const data = { a: 1 };
        const { flattened } = flattenForDataset(data, null);
        expect(flattened).toBe(data);
    });

    it("uses column-based extraction when columns defined", () => {
        const { flattened } = flattenForDataset(
            { id: 42 },
            { columns: [{ jsonPath: "id", datasetKey: "identifier", type: "number" }] }
        );
        expect(flattened["identifier"]).toBe(42);
    });
});

// ─── getAvailableFields / getFieldsWithTypes ──────────────────────────────────

describe("getAvailableFields", () => {
    it("returns sorted field names", () => {
        const fields = getAvailableFields({ c: 3, a: 1, b: 2 });
        expect(fields).toEqual(["a", "b", "c"]);
    });
});

describe("getFieldsWithTypes", () => {
    it("infers type for each field", () => {
        const types = getFieldsWithTypes({ name: "Alice", age: 30, active: true });
        expect(types["name"]).toBe("text");
        expect(types["age"]).toBe("number");
        expect(types["active"]).toBe("boolean");
    });
});

// ─── applyHygiene ─────────────────────────────────────────────────────────────

describe("applyHygiene", () => {
    it("passes through rows when no hygiene", () => {
        const rows = [{ a: 1 }];
        const result = applyHygiene(rows);
        expect(result.rows).toBe(rows);
        expect(result.stats.outputCount).toBe(1);
    });

    it("drop strategy removes rows with any null", () => {
        const rows = [{ a: 1, b: null }, { a: 2, b: "ok" }];
        const result = applyHygiene(rows, { nullHandling: { strategy: "drop" } });
        expect(result.rows).toHaveLength(1);
        expect(result.stats.nullDroppedCount).toBe(1);
    });

    it("fill strategy replaces nulls with fillValue", () => {
        const rows = [{ a: 1, b: null }];
        const result = applyHygiene(rows, { nullHandling: { strategy: "fill", fillValue: "N/A" } });
        expect(result.rows[0]["b"]).toBe("N/A");
    });

    it("fill strategy uses empty string when no fillValue", () => {
        const rows = [{ a: null }];
        const result = applyHygiene(rows, { nullHandling: { strategy: "fill" } });
        expect(result.rows[0]["a"]).toBe("");
    });

    it("keep strategy leaves nulls unchanged", () => {
        const rows = [{ a: null }];
        const result = applyHygiene(rows, { nullHandling: { strategy: "keep" } });
        expect(result.rows[0]["a"]).toBeNull();
    });

    it("deduplication with keepFirst removes later duplicates", () => {
        const rows = [{ id: 1, val: "a" }, { id: 1, val: "a" }, { id: 2, val: "b" }];
        const result = applyHygiene(rows, {
            deduplication: { enabled: true, strategy: "keepFirst", keyColumns: ["id"] }
        });
        expect(result.rows).toHaveLength(2);
        expect(result.stats.deduplicatedCount).toBe(1);
    });

    it("deduplication with keepLast keeps later duplicate", () => {
        const rows = [
            { id: 1, val: "first" },
            { id: 1, val: "last" }
        ];
        const result = applyHygiene(rows, {
            deduplication: { enabled: true, strategy: "keepLast", keyColumns: ["id"] }
        });
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]["val"]).toBe("last");
    });

    it("deduplication with no keyColumns uses all columns", () => {
        const rows = [{ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 3, b: 4 }];
        const result = applyHygiene(rows, {
            deduplication: { enabled: true, strategy: "keepFirst" }
        });
        expect(result.rows).toHaveLength(2);
    });

    it("deduplication disabled does not remove rows", () => {
        const rows = [{ id: 1 }, { id: 1 }];
        const result = applyHygiene(rows, {
            deduplication: { enabled: false, strategy: "keepFirst" }
        });
        expect(result.rows).toHaveLength(2);
    });
});
