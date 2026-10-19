/**
 * cel-extensions.ts Tests — full coverage of pure textFunctions, diffFunctions, listFunctions, evaluateExpression
 */

import { describe, it, expect } from "vitest";
import {
    textFunctions,
    diffFunctions,
    listFunctions,
    createCELContext,
    evaluateExpression,
} from "@domain/core/infrastructure/cel-extensions.js";
import type { DiffResult } from "@domain/core/infrastructure/diff-service.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

const makeDiff = (overrides: Partial<DiffResult> = {}): DiffResult => ({
    hasChanges: true,
    changeCount: 1,
    changes: [{ op: "replace", path: "/count", value: 5, oldValue: 3 }],
    summary: { added: 0, removed: 0, modified: 1 },
    ...overrides,
});

// ─── textFunctions ────────────────────────────────────────────────────────────

describe("textFunctions", () => {
    describe("contains", () => {
        it("returns true when str contains search", () => expect(textFunctions.contains("hello world", "world")).toBe(true));
        it("returns false when not found", () => expect(textFunctions.contains("hello", "xyz")).toBe(false));
        it("returns false for null", () => expect(textFunctions.contains(null, "x")).toBe(false));
        it("returns false for undefined", () => expect(textFunctions.contains(undefined, "x")).toBe(false));
    });

    describe("containsIgnoreCase", () => {
        it("matches case-insensitively", () => expect(textFunctions.containsIgnoreCase("Hello", "hello")).toBe(true));
        it("returns false for null", () => expect(textFunctions.containsIgnoreCase(null, "x")).toBe(false));
        it("returns false when not found", () => expect(textFunctions.containsIgnoreCase("foo", "bar")).toBe(false));
    });

    describe("matches", () => {
        it("matches regex pattern", () => expect(textFunctions.matches("abc123", "\\d+")).toBe(true));
        it("returns false when no match", () => expect(textFunctions.matches("abc", "^\\d+$")).toBe(false));
        it("returns false for null input", () => expect(textFunctions.matches(null, "\\d")).toBe(false));
        it("returns false for invalid regex", () => expect(textFunctions.matches("abc", "[invalid")).toBe(false));
    });

    describe("lower", () => {
        it("converts to lowercase", () => expect(textFunctions.lower("HELLO")).toBe("hello"));
        it("returns empty for null", () => expect(textFunctions.lower(null)).toBe(""));
    });

    describe("upper", () => {
        it("converts to uppercase", () => expect(textFunctions.upper("hello")).toBe("HELLO"));
        it("returns empty for null", () => expect(textFunctions.upper(null)).toBe(""));
    });

    describe("trim", () => {
        it("trims whitespace", () => expect(textFunctions.trim("  hi  ")).toBe("hi"));
        it("returns empty for null", () => expect(textFunctions.trim(null)).toBe(""));
    });

    describe("startsWith", () => {
        it("true when starts with prefix", () => expect(textFunctions.startsWith("hello world", "hello")).toBe(true));
        it("false for null", () => expect(textFunctions.startsWith(null, "any")).toBe(false));
        it("false when prefix not found", () => expect(textFunctions.startsWith("world", "hello")).toBe(false));
    });

    describe("endsWith", () => {
        it("true when ends with suffix", () => expect(textFunctions.endsWith("hello world", "world")).toBe(true));
        it("false for null", () => expect(textFunctions.endsWith(null, "any")).toBe(false));
    });

    describe("len", () => {
        it("returns string length", () => expect(textFunctions.len("hello")).toBe(5));
        it("returns 0 for null", () => expect(textFunctions.len(null)).toBe(0));
    });

    describe("split", () => {
        it("splits by delimiter", () => expect(textFunctions.split("a,b,c", ",")).toEqual(["a", "b", "c"]));
        it("returns empty for null", () => expect(textFunctions.split(null, ",")).toEqual([]));
    });

    describe("replace", () => {
        it("replaces all occurrences", () => expect(textFunctions.replace("aaa", "a", "b")).toBe("bbb"));
        it("returns empty for null", () => expect(textFunctions.replace(null, "a", "b")).toBe(""));
    });

    describe("substring", () => {
        it("extracts substring with start and end", () => expect(textFunctions.substring("hello", 1, 3)).toBe("el"));
        it("extracts from start to end", () => expect(textFunctions.substring("hello", 2)).toBe("llo"));
        it("returns empty for null", () => expect(textFunctions.substring(null, 0)).toBe(""));
    });

    describe("isEmpty", () => {
        it("returns true for null", () => expect(textFunctions.isEmpty(null)).toBe(true));
        it("returns true for whitespace", () => expect(textFunctions.isEmpty("   ")).toBe(true));
        it("returns false for non-empty", () => expect(textFunctions.isEmpty("x")).toBe(false));
    });

    describe("isNotEmpty", () => {
        it("returns false for null", () => expect(textFunctions.isNotEmpty(null)).toBe(false));
        it("returns true for non-empty", () => expect(textFunctions.isNotEmpty("x")).toBe(true));
    });
});

// ─── diffFunctions ────────────────────────────────────────────────────────────

describe("diffFunctions", () => {
    const diff = makeDiff();

    describe("hasChange", () => {
        it("true for changed path", () => expect(diffFunctions.hasChange(diff, "count")).toBe(true));
        it("true with slash prefix", () => expect(diffFunctions.hasChange(diff, "/count")).toBe(true));
        it("false for unchanged path", () => expect(diffFunctions.hasChange(diff, "name")).toBe(false));
        it("false for null diff", () => expect(diffFunctions.hasChange(null, "x")).toBe(false));
    });

    describe("hasChanges", () => {
        it("returns true when has changes", () => expect(diffFunctions.hasChanges(diff)).toBe(true));
        it("returns false for null", () => expect(diffFunctions.hasChanges(null)).toBe(false));
        it("returns false for no-change diff", () => {
            expect(diffFunctions.hasChanges({ ...diff, hasChanges: false })).toBe(false);
        });
    });

    describe("changeCount", () => {
        it("returns change count", () => expect(diffFunctions.changeCount(diff)).toBe(1));
        it("returns 0 for null", () => expect(diffFunctions.changeCount(null)).toBe(0));
    });

    describe("value", () => {
        it("returns new value at path", () => expect(diffFunctions.value(diff, "count")).toBe(5));
        it("returns undefined for null diff", () => expect(diffFunctions.value(null, "count")).toBeUndefined());
        it("returns undefined for unknown path", () => expect(diffFunctions.value(diff, "unknown")).toBeUndefined());
    });

    describe("oldValue", () => {
        it("returns old value at path", () => expect(diffFunctions.oldValue(diff, "count")).toBe(3));
        it("returns undefined for null diff", () => expect(diffFunctions.oldValue(null, "x")).toBeUndefined());
    });

    describe("percentageChange", () => {
        it("calculates percentage change", () => {
            // old=3, new=5 → (5-3)/3*100 = 66.67
            expect(diffFunctions.percentageChange(diff, "count")).toBeCloseTo(66.67, 1);
        });
        it("returns null for null diff", () => expect(diffFunctions.percentageChange(null, "x")).toBeNull());
        it("returns null when old value is 0", () => {
            const zeroDiff = makeDiff({
                changes: [{ op: "replace", path: "/val", value: 5, oldValue: 0 }]
            });
            expect(diffFunctions.percentageChange(zeroDiff, "val")).toBeNull();
        });
    });

    describe("addedCount / removedCount / modifiedCount", () => {
        it("returns added count", () => expect(diffFunctions.addedCount(makeDiff({ summary: { added: 2, removed: 0, modified: 0 } }))).toBe(2));
        it("returns removed count", () => expect(diffFunctions.removedCount(makeDiff({ summary: { added: 0, removed: 3, modified: 0 } }))).toBe(3));
        it("returns modified count", () => expect(diffFunctions.modifiedCount(diff)).toBe(1));
        it("returns 0 for null", () => {
            expect(diffFunctions.addedCount(null)).toBe(0);
            expect(diffFunctions.removedCount(null)).toBe(0);
            expect(diffFunctions.modifiedCount(null)).toBe(0);
        });
    });

    describe("changedPaths", () => {
        it("returns all changed paths", () => expect(diffFunctions.changedPaths(diff)).toEqual(["/count"]));
        it("returns empty for null", () => expect(diffFunctions.changedPaths(null)).toEqual([]));
    });
});

// ─── listFunctions ────────────────────────────────────────────────────────────

describe("listFunctions", () => {
    describe("contains", () => {
        it("true when item in array", () => expect(listFunctions.contains([1, 2, 3], 2)).toBe(true));
        it("false when not in array", () => expect(listFunctions.contains([1], 5)).toBe(false));
        it("false for null", () => expect(listFunctions.contains(null, 1)).toBe(false));
    });

    describe("size", () => {
        it("returns array length", () => expect(listFunctions.size([1, 2, 3])).toBe(3));
        it("returns 0 for null", () => expect(listFunctions.size(null)).toBe(0));
    });

    describe("isEmpty", () => {
        it("true for empty array", () => expect(listFunctions.isEmpty([])).toBe(true));
        it("false for non-empty", () => expect(listFunctions.isEmpty([1])).toBe(false));
        it("true for null", () => expect(listFunctions.isEmpty(null)).toBe(true));
    });

    describe("first", () => {
        it("returns first element", () => expect(listFunctions.first([10, 20])).toBe(10));
        it("undefined for empty", () => expect(listFunctions.first([])).toBeUndefined());
        it("undefined for null", () => expect(listFunctions.first(null)).toBeUndefined());
    });

    describe("last", () => {
        it("returns last element", () => expect(listFunctions.last([10, 20, 30])).toBe(30));
        it("undefined for empty", () => expect(listFunctions.last([])).toBeUndefined());
    });

    describe("any", () => {
        it("true when any item matches", () => {
            expect(listFunctions.any([{ status: "ok" }, { status: "fail" }], "status", "ok")).toBe(true);
        });
        it("false when none match", () => {
            expect(listFunctions.any([{ status: "ok" }], "status", "fail")).toBe(false);
        });
        it("false for null", () => expect(listFunctions.any(null, "x", "y")).toBe(false));
    });

    describe("all", () => {
        it("true when all match", () => {
            expect(listFunctions.all([{ active: true }, { active: true }], "active", true)).toBe(true);
        });
        it("false when some don't match", () => {
            expect(listFunctions.all([{ active: true }, { active: false }], "active", true)).toBe(false);
        });
        it("false for null", () => expect(listFunctions.all(null, "x", "y")).toBe(false));
    });

    describe("filter", () => {
        it("filters by property value", () => {
            const result = listFunctions.filter([{ x: 1 }, { x: 2 }], "x", 1);
            expect(result).toHaveLength(1);
        });
        it("returns empty for null", () => expect(listFunctions.filter(null, "a", "b")).toEqual([]));
    });

    describe("unique", () => {
        it("removes duplicates", () => expect(listFunctions.unique([1, 2, 2, 3])).toEqual([1, 2, 3]));
        it("returns empty for null", () => expect(listFunctions.unique(null)).toEqual([]));
    });

    describe("sum", () => {
        it("sums numeric values", () => expect(listFunctions.sum([1, 2, 3])).toBe(6));
        it("returns 0 for null", () => expect(listFunctions.sum(null)).toBe(0));
        it("skips non-numeric values", () => expect(listFunctions.sum([1, "x" as any, 2])).toBe(3));
    });

    describe("avg", () => {
        it("calculates average", () => expect(listFunctions.avg([10, 20, 30])).toBe(20));
        it("returns 0 for null", () => expect(listFunctions.avg(null)).toBe(0));
        it("returns 0 for empty array", () => expect(listFunctions.avg([])).toBe(0));
    });

    describe("min / max", () => {
        it("min returns minimum", () => expect(listFunctions.min([3, 1, 2])).toBe(1));
        it("max returns maximum", () => expect(listFunctions.max([3, 1, 2])).toBe(3));
        it("min returns undefined for null", () => expect(listFunctions.min(null)).toBeUndefined());
        it("max returns undefined for empty", () => expect(listFunctions.max([])).toBeUndefined());
    });
});

// ─── createCELContext ─────────────────────────────────────────────────────────

describe("createCELContext", () => {
    it("includes text, diff, list and additional context", () => {
        const ctx = createCELContext({ myVar: 42 });
        expect(ctx.text).toBe(textFunctions);
        expect(ctx.diff).toBe(diffFunctions);
        expect(ctx.list).toBe(listFunctions);
        expect(ctx.myVar).toBe(42);
    });
});

// ─── evaluateExpression ───────────────────────────────────────────────────────

describe("evaluateExpression", () => {
    it("evaluates a simple true expression", () => {
        expect(evaluateExpression("1 === 1", {})).toBe(true);
    });

    it("evaluates a false expression", () => {
        expect(evaluateExpression("1 === 2", {})).toBe(false);
    });

    it("evaluates expression with context variables", () => {
        expect(evaluateExpression("count > 5", { count: 10 })).toBe(true);
    });

    it("returns false for invalid expression", () => {
        expect(evaluateExpression("INVALID ~~~ SYNTAX !!!", {})).toBe(false);
    });

    it("evaluates with text functions in context", () => {
        expect(evaluateExpression("text.contains(name, 'alice')", { name: "alice" })).toBe(true);
    });
});
