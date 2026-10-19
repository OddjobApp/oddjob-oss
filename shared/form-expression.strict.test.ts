/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { evalFormula, evaluateExpression, expressionReferences, tryEvaluateExpression } from "./form-expression";

describe("division by zero", () => {
    it("is refused by the strict Studio evaluator, for both / and %", () => {
        expect(() => evaluateExpression("a / b", { a: 4, b: 0 })).toThrow(/Division by zero/);
        expect(() => evaluateExpression("a % b", { a: 4, b: 0 })).toThrow(/Division by zero/);
    });

    it("still divides normally when the divisor is not zero", () => {
        expect(evaluateExpression("a / b", { a: 4, b: 2 })).toBe(2);
        expect(evaluateExpression("a % b", { a: 5, b: 2 })).toBe(1);
    });

    it("keeps the forgiving chat evaluator's historical 0 until chat moves to strict", () => {
        expect(evalFormula("a / b", { a: 4, b: 0 })).toBe(0);
    });
});

describe("powers", () => {
    it("raises to a power, right-associative and tighter than unary minus", () => {
        const cagr = tryEvaluateExpression("(endVal / startVal) ^ (1 / periods) - 1", { endVal: 144, startVal: 100, periods: 2 });
        expect(cagr.ok && cagr.value).toBeCloseTo(0.2, 10);
        expect(tryEvaluateExpression("-2 ^ 2", {})).toEqual({ ok: true, value: -4 });
        expect(tryEvaluateExpression("2 ^ 3 ^ 2", {})).toEqual({ ok: true, value: 512 });
        expect(tryEvaluateExpression("2 ^ -1", {})).toEqual({ ok: true, value: 0.5 });
        expect(tryEvaluateExpression("x ^ 2", {})).toEqual({ ok: false, missing: ["x"] });
    });
});

describe("incomplete formulas", () => {
    it("are refused instead of reading the gap as 0", () => {
        expect(tryEvaluateExpression("a +", { a: 1 })).toEqual({ ok: false, error: "The formula ends before it is complete." });
        expect(tryEvaluateExpression("* 2", {})).toEqual({ ok: false, error: 'Unexpected "*" in formula' });
    });
});

describe("functions", () => {
    it("are only the formula functions, never what every object inherits", () => {
        expect(tryEvaluateExpression("constructor(1)", {})).toEqual({ ok: false, error: "Unknown function: constructor" });
        expect(tryEvaluateExpression("toString()", {})).toEqual({ ok: false, error: "Unknown function: toString" });
        expect(() => expressionReferences("constructor(1)")).toThrow("Unknown function: constructor");
        expect(evalFormula("valueOf()", {})).toBe("");
    });
});
