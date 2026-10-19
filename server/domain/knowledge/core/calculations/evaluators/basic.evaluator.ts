import { expressionReferences, tryEvaluateExpression } from "@shared/form-expression.js";

export interface FormulaContext {
    [variable: string]: number;
}

/**
 * Calculation formulas and conditions, on the strict Form Studio expression engine.
 *
 * Calculations had two evaluators of their own. FORMULA nodes used a
 * shunting-yard parser that skipped any character it did not know and read any
 * name without a value as nothing at all, so a typo dropped out of the formula
 * and the rest computed a confident wrong number. Gate conditions, rules and
 * compliance checks substituted values into the text and ran it with
 * `new Function`. Both now use the engine Form Studio's formulas, rules and tests
 * use: a fixed grammar with no eval, the whitelisted formula functions,
 * comparisons and ternaries, `^` for powers, and errors instead of guesses. An
 * input with no value, an unknown name or function, a formula that ends early and
 * a division by zero are each reported, never turned into 0.
 */

/** A formula's number. A condition's true or false scores 1 or 0, as the gate, rule and compliance callers count it. */
export function evaluateNumber(expression: string, context: FormulaContext): number {
    if (!expression?.trim()) throw new Error("A formula is required.");
    for (const name of expressionReferences(expression)) {
        if (!Object.prototype.hasOwnProperty.call(context, name)) continue;
        const value = context[name];
        // The engine reads a non-number as 0, which would hide a bad input.
        if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Input ${name} is not a number.`);
    }
    const outcome = tryEvaluateExpression(expression, context);
    if (!outcome.ok) {
        if ("missing" in outcome) throw new Error(`Missing input: ${outcome.missing.join(", ")}`);
        throw new Error(outcome.error);
    }
    if (typeof outcome.value === "boolean") return outcome.value ? 1 : 0;
    if (typeof outcome.value === "number" && Number.isFinite(outcome.value)) return outcome.value;
    throw new Error(`Formula did not produce a number: ${expression}`);
}

export const basicEvaluator = {
    evaluateFormula(formula: string, context: FormulaContext): number {
        return evaluateNumber(formula, context);
    },

    calculateSum(context: FormulaContext): number {
        return Object.values(context).reduce((sum, val) => sum + (val || 0), 0);
    },

    calculateAverage(context: FormulaContext): number {
        const values = Object.values(context);
        if (values.length === 0) return 0;
        return this.calculateSum(context) / values.length;
    },

    calculateMin(context: FormulaContext): number {
        const values = Object.values(context);
        if (values.length === 0) return 0;
        return Math.min(...values);
    },

    calculateMax(context: FormulaContext): number {
        const values = Object.values(context);
        if (values.length === 0) return 0;
        return Math.max(...values);
    },
};
