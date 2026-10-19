/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { evaluateExpression, tryEvaluateExpression } from "./form-expression";

/**
 * Unanswered inputs in the strict evaluator.
 *
 * It used to refuse any expression naming an unanswered input, so a rule such as
 * `line == 'lending' && apr > 36` waited forever on an APR that a non-lending line
 * never asks for. Only a result that depends on the gap is missing now.
 */

describe("unanswered inputs in the strict evaluator", () => {
    it("does not need an answer the result cannot depend on", () => {
        expect(evaluateExpression("line == 'lending' && apr > 36", { line: "insurance", apr: "" })).toBe(false);
        expect(evaluateExpression("gate || score > 90", { gate: true })).toBe(true);
        expect(evaluateExpression("urgent ? 'NOW' : later_date", { urgent: true })).toBe("NOW");
        expect(evaluateExpression("coalesce(override, 5)", { override: null })).toBe(5);
        expect(evaluateExpression("if(flag, 1, missing_value)", { flag: true })).toBe(1);
    });

    it("names every unanswered input the result does depend on", () => {
        expect(() => evaluateExpression("a + b", {})).toThrow("Missing input: a, b");
        expect(() => evaluateExpression("line == 'lending' && apr > 36", { line: "lending" })).toThrow("Missing input: apr");
        expect(tryEvaluateExpression("x > 1 || y > 1", { x: 0 })).toEqual({ ok: false, missing: ["y"] });
    });

    it("reports an unanswered divisor as missing, and a zero divisor as a division by zero", () => {
        expect(tryEvaluateExpression("total / count", { total: 10 })).toEqual({ ok: false, missing: ["count"] });
        expect(tryEvaluateExpression("total / count", { total: 10, count: 0 })).toEqual({ ok: false, error: "Division by zero" });
    });

    it("returns the value when everything needed is answered", () => {
        expect(tryEvaluateExpression("round(a / b, 2)", { a: 1, b: 3 })).toEqual({ ok: true, value: 0.33 });
    });
});
