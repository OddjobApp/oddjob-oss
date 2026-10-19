/**
 * diff-service.ts Tests — pure function coverage
 * All functions are side-effect free (uses fast-json-patch internally)
 */

import { describe, it, expect } from "vitest";
import {
    computeDiff,
    hasChange,
    getNewValue,
    getOldValue,
    percentageChange,
    formatDiffSummary,
} from "@domain/core/infrastructure/diff-service.js";

describe("computeDiff", () => {
    it("should return no changes for identical objects", () => {
        const result = computeDiff({ a: 1 }, { a: 1 });
        expect(result.hasChanges).toBe(false);
        expect(result.changeCount).toBe(0);
        expect(result.changes).toHaveLength(0);
    });

    it("should detect a field addition", () => {
        const result = computeDiff({ a: 1 }, { a: 1, b: 2 });
        expect(result.hasChanges).toBe(true);
        expect(result.summary.added).toBe(1);
        expect(result.changes.some(c => c.op === "add" && c.path === "/b")).toBe(true);
    });

    it("should detect a field removal", () => {
        const result = computeDiff({ a: 1, b: 2 }, { a: 1 });
        expect(result.summary.removed).toBe(1);
        expect(result.changes.some(c => c.op === "remove")).toBe(true);
    });

    it("should detect a field modification and capture oldValue", () => {
        const result = computeDiff({ a: 1 }, { a: 2 });
        expect(result.summary.modified).toBe(1);
        const change = result.changes.find(c => c.op === "replace");
        expect(change?.oldValue).toBe(1);
        expect(change?.value).toBe(2);
    });

    it("should ignore specified paths", () => {
        const result = computeDiff({ a: 1, ts: "old" }, { a: 1, ts: "new" }, { ignorePaths: ["ts"] });
        expect(result.hasChanges).toBe(false);
    });

    it("should only include specified paths when includePaths given", () => {
        const result = computeDiff({ a: 1, b: 1 }, { a: 2, b: 2 }, { includePaths: ["a"] });
        // Only /a should be in changes
        expect(result.changes.every(c => c.path.startsWith("/a"))).toBe(true);
    });

    it("should ignore array order when ignoreArrayOrder is true", () => {
        const base = { items: [3, 1, 2] };
        const curr = { items: [1, 2, 3] };
        const result = computeDiff(base, curr, { ignoreArrayOrder: true });
        expect(result.hasChanges).toBe(false);
    });

    it("should detect array order change when ignoreArrayOrder is false", () => {
        const base = { items: [1, 2, 3] };
        const curr = { items: [3, 2, 1] };
        const result = computeDiff(base, curr);
        expect(result.hasChanges).toBe(true);
    });

    it("should detect a field addition from empty baseline", () => {
        const result = computeDiff({}, { a: 1 });
        expect(result.hasChanges).toBe(true);
        expect(result.summary.added).toBe(1);
    });

    it("should handle nested array paths", () => {
        const base = { arr: [{ id: 1 }, { id: 2 }] };
        const curr = { arr: [{ id: 1 }, { id: 99 }] };
        const result = computeDiff(base, curr);
        expect(result.hasChanges).toBe(true);
        expect(result.changes.some(c => c.path.includes("/arr/"))).toBe(true);
    });
});

describe("hasChange", () => {
    it("should return true if exact path changed", () => {
        const diff = computeDiff({ x: 1 }, { x: 2 });
        expect(hasChange(diff, "x")).toBe(true);
        expect(hasChange(diff, "/x")).toBe(true);
    });

    it("should return false if path not changed", () => {
        const diff = computeDiff({ x: 1, y: 1 }, { x: 1, y: 2 });
        expect(hasChange(diff, "x")).toBe(false);
    });

    it("should return true for parent path matching child change", () => {
        const diff = computeDiff({ parent: { child: 1 } }, { parent: { child: 2 } });
        expect(hasChange(diff, "parent")).toBe(true);
    });
});

describe("getNewValue", () => {
    it("should return the new value at path", () => {
        const diff = computeDiff({ a: 1 }, { a: 99 });
        expect(getNewValue(diff, "a")).toBe(99);
    });

    it("should return undefined for unchanged path", () => {
        const diff = computeDiff({ a: 1, b: 2 }, { a: 1, b: 3 });
        expect(getNewValue(diff, "a")).toBeUndefined();
    });
});

describe("getOldValue", () => {
    it("should return the old value for a modified field", () => {
        const diff = computeDiff({ a: "old" }, { a: "new" });
        expect(getOldValue(diff, "a")).toBe("old");
    });

    it("should return the old value for a removed field", () => {
        const diff = computeDiff({ a: 1, b: 42 }, { a: 1 });
        expect(getOldValue(diff, "b")).toBe(42);
    });
});

describe("percentageChange", () => {
    it("should compute percentage increase correctly", () => {
        const diff = computeDiff({ val: 100 }, { val: 150 });
        expect(percentageChange(diff, "val")).toBeCloseTo(50, 5);
    });

    it("should compute percentage decrease correctly", () => {
        const diff = computeDiff({ val: 200 }, { val: 100 });
        expect(percentageChange(diff, "val")).toBeCloseTo(-50, 5);
    });

    it("should return null when old value is 0 (avoid division by zero)", () => {
        const diff = computeDiff({ val: 0 }, { val: 5 });
        expect(percentageChange(diff, "val")).toBeNull();
    });

    it("should return null when values are non-numeric", () => {
        const diff = computeDiff({ val: "a" }, { val: "b" });
        expect(percentageChange(diff, "val")).toBeNull();
    });

    it("should return null when path has no change", () => {
        const diff = computeDiff({ a: 1, b: 100 }, { a: 2, b: 100 });
        expect(percentageChange(diff, "b")).toBeNull();
    });
});

describe("formatDiffSummary", () => {
    it("should return 'No changes detected.' when no changes", () => {
        const diff = computeDiff({ a: 1 }, { a: 1 });
        expect(formatDiffSummary(diff)).toBe("No changes detected.");
    });

    it("should describe additions", () => {
        const diff = computeDiff({ a: 1 }, { a: 1, b: 2 });
        expect(formatDiffSummary(diff)).toMatch("1 added");
    });

    it("should describe removals", () => {
        const diff = computeDiff({ a: 1, b: 2 }, { a: 1 });
        expect(formatDiffSummary(diff)).toMatch("1 removed");
    });

    it("should describe modifications", () => {
        const diff = computeDiff({ a: 1 }, { a: 2 });
        expect(formatDiffSummary(diff)).toMatch("1 modified");
    });

    it("should include total change count in summary", () => {
        const diff = computeDiff({ a: 1, b: 2 }, { a: 9, c: 3 });
        // a modified (1), b removed (2), c added (3) = 3 changes total
        expect(formatDiffSummary(diff)).toMatch(/\d+ changes:/);
    });
});
