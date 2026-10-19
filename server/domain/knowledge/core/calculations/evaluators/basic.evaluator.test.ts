/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { evaluateNumber } from "./basic.evaluator.js";

describe("calculation formulas on the strict engine", () => {
    it("keeps precedence, parentheses and powers", () => {
        expect(evaluateNumber("((revenue - cogs) / revenue) * 100", { revenue: 200, cogs: 50 })).toBe(75);
        expect(evaluateNumber("(endVal / startVal) ^ (1 / periods) - 1", { endVal: 144, startVal: 100, periods: 2 })).toBeCloseTo(0.2, 10);
        expect(evaluateNumber("(a * 1.15) - b", { a: 100, b: 15 })).toBeCloseTo(100, 10);
    });

    it("offers the formula functions and scores a condition as 1 or 0", () => {
        expect(evaluateNumber("round(max(a, b) / 3, 2)", { a: 10, b: 12.5 })).toBe(4.17);
        expect(evaluateNumber("value1 > 50000 && value2 <= 120000", { value1: 100000, value2: 120000 })).toBe(1);
        expect(evaluateNumber("value1 > value2 ? 10 : 20", { value1: 1, value2: 2 })).toBe(20);
        expect(evaluateNumber("safetyScore >= 0.85", { safetyScore: 0.8 })).toBe(0);
    });

    it("reports what it cannot compute instead of guessing", () => {
        expect(() => evaluateNumber("revenue - expenses", { revenue: 10 })).toThrow("Missing input: expenses");
        expect(() => evaluateNumber("a / b", { a: 1, b: 0 })).toThrow("Division by zero");
        expect(() => evaluateNumber("a +", { a: 1 })).toThrow("The formula ends before it is complete.");
        expect(() => evaluateNumber("a # b", { a: 1, b: 2 })).toThrow("Unsupported character in formula: #");
        expect(() => evaluateNumber("'high'", {})).toThrow("Formula did not produce a number: 'high'");
        expect(() => evaluateNumber("a * 2", { a: Number.NaN })).toThrow("Input a is not a number.");
        expect(() => evaluateNumber("  ", {})).toThrow("A formula is required.");
    });

    it("cannot reach code", () => {
        expect(() => evaluateNumber("process.exit(1)", {})).toThrow("Unknown function: process.exit");
        expect(() => evaluateNumber("constructor(1)", {})).toThrow("Unknown function: constructor");
        expect(() => evaluateNumber("__proto__ + 1", {})).toThrow("Missing input: __proto__");
    });
});
