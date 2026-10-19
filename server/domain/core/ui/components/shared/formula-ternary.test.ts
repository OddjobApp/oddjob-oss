import { describe, it, expect } from "vitest";
import { evalFormula } from "@domain-ui/core/ui/components/shared/formula";

const MORTGAGE = "if(principal > 0 && annualRate >= 0 && loanTermYears > 0, (annualRate == 0 ? round(principal / (loanTermYears * 12), 2) : round(principal * (annualRate / 12 / 100) * pow(1 + (annualRate / 12 / 100), loanTermYears * 12) / (pow(1 + (annualRate / 12 / 100), loanTermYears * 12) - 1), 2)), 0)";

describe("formula", () => {
  it("the screenshot's mortgage formula", () => {
    const out = evalFormula(MORTGAGE, { principal: 1600000, annualRate: 5.6, loanTermYears: 15 });
    console.log("mortgage 1.6M @5.6%/15y =", out);
    expect(typeof out).toBe("number");
    expect(out).toBeGreaterThan(13000);
    expect(out).toBeLessThan(13200);
  });
  it("takes the zero-rate branch", () => {
    const out = evalFormula(MORTGAGE, { principal: 120000, annualRate: 0, loanTermYears: 10 });
    console.log("zero-rate branch =", out);
    expect(out).toBe(1000);
  });
  it("string inputs from form fields still work", () => {
    const out = evalFormula(MORTGAGE, { principal: "200000", annualRate: "4.5", loanTermYears: "30" });
    console.log("string inputs =", out);
    expect(out).toBeGreaterThan(1013);
    expect(out).toBeLessThan(1014);
  });
  it("nested ternary is right-associative", () => {
    expect(evalFormula("a > 10 ? 'big' : a > 5 ? 'mid' : 'small'", { a: 7 })).toBe("mid");
    expect(evalFormula("a > 10 ? 'big' : a > 5 ? 'mid' : 'small'", { a: 2 })).toBe("small");
    expect(evalFormula("a > 10 ? 'big' : a > 5 ? 'mid' : 'small'", { a: 99 })).toBe("big");
  });
  it("a malformed formula degrades to blank, never a wrong number", () => {
    expect(evalFormula("rate == 0 ? 5", {})).toBe("");
    expect(evalFormula("round(1 + ", {})).toBe("");
    expect(evalFormula("bogusFn(3)", {})).toBe("");
    expect(evalFormula("1 + 2 @ 3", {})).toBe("");
  });
  it("existing non-ternary formulas are unchanged", () => {
    expect(evalFormula("round(bill * tipPercent / 100, 2)", { bill: 80, tipPercent: 15 })).toBe(12);
    expect(evalFormula("if(qty > 10, 'bulk', 'single')", { qty: 20 })).toBe("bulk");
    expect(evalFormula("concat(first, ' ', last)", { first: "Ada", last: "L" })).toBe("Ada L");
  });
});
