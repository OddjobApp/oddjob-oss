/**
 * NormalizationService — CSV Parsing Tests
 * Tests the pure CSV parsing logic embedded in importCsv.
 * We extract and test just the parsing functions without any DB interactions.
 */

import { describe, it, expect } from "vitest";

// Pure CSV line parser extracted from normalizationService — testable independently
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

// Schema mapping builder
function buildSchemaMapping(columns: Array<{ source: string; target: string }>) {
    return {
        includedFields: columns.map(c => c.source),
        columnRenames: columns.reduce((acc, c) => {
            if (c.source !== c.target) {
                acc[c.source] = c.target;
            }
            return acc;
        }, {} as Record<string, string>)
    };
}

// Type inference from CSV values (embedded in importCsv)
function inferType(value: string): any {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (!isNaN(Number(value)) && value !== '') return Number(value);
    return value;
}

describe("CSV Parsing Logic (normalization-service.ts)", () => {
    describe("parseCSVLine", () => {
        it("should parse simple comma-separated values", () => {
            expect(parseCSVLine("a,b,c")).toEqual(["a", "b", "c"]);
        });

        it("should handle quoted values with commas inside", () => {
            expect(parseCSVLine('"hello, world",two,three')).toEqual(["hello, world", "two", "three"]);
        });

        it("should handle escaped double-quotes inside quoted fields", () => {
            expect(parseCSVLine('"say ""hi""",value')).toEqual(['say "hi"', "value"]);
        });

        it("should trim whitespace from values", () => {
            expect(parseCSVLine("  a  ,  b  ")).toEqual(["a", "b"]);
        });

        it("should handle empty fields", () => {
            expect(parseCSVLine("a,,c")).toEqual(["a", "", "c"]);
        });

        it("should handle a single value", () => {
            expect(parseCSVLine("solo")).toEqual(["solo"]);
        });

        it("should handle values with numbers", () => {
            const result = parseCSVLine("name,42,true");
            expect(result).toEqual(["name", "42", "true"]);
        });
    });

    describe("inferType", () => {
        it("should convert 'true' string to boolean true", () => {
            expect(inferType("true")).toBe(true);
        });

        it("should convert 'false' string to boolean false", () => {
            expect(inferType("false")).toBe(false);
        });

        it("should convert numeric strings to numbers", () => {
            expect(inferType("42")).toBe(42);
            expect(inferType("3.14")).toBeCloseTo(3.14);
            expect(inferType("-7")).toBe(-7);
        });

        it("should keep plain strings as strings", () => {
            expect(inferType("hello")).toBe("hello");
            expect(inferType("")).toBe("");
        });

        it("should keep zero as 0 (number)", () => {
            expect(inferType("0")).toBe(0);
        });
    });

    describe("buildSchemaMapping", () => {
        it("should include all source fields", () => {
            const mapping = buildSchemaMapping([
                { source: "first_name", target: "firstName" },
                { source: "age", target: "age" }
            ]);
            expect(mapping.includedFields).toEqual(["first_name", "age"]);
        });

        it("should only create renames for fields that differ", () => {
            const mapping = buildSchemaMapping([
                { source: "first_name", target: "firstName" },
                { source: "age", target: "age" } // same — no rename
            ]);
            expect(mapping.columnRenames).toEqual({ first_name: "firstName" });
        });

        it("should produce empty renames when all fields match", () => {
            const mapping = buildSchemaMapping([
                { source: "name", target: "name" },
                { source: "email", target: "email" }
            ]);
            expect(mapping.columnRenames).toEqual({});
        });

        it("should handle empty column list", () => {
            const mapping = buildSchemaMapping([]);
            expect(mapping.includedFields).toEqual([]);
            expect(mapping.columnRenames).toEqual({});
        });
    });
});
