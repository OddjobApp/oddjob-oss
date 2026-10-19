import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subscriptionRuleEngine, type CrispCondition } from "./subscription-rule-engine.service.js";

/**
 * Covers crisp-condition evaluation, which is the part of the rule engine that
 * non-spatial signals (prospecting intent, S.C.O.R.E. vectors) would run
 * through if they were moved onto the signal spine.
 *
 * `evaluateCrispCondition` is private; it is exercised directly because it is a
 * pure predicate and the surrounding public path needs a full rule spec,
 * causal-graph links, and persistence to reach it.
 */
const evaluate = (cond: CrispCondition, event: Record<string, unknown>): boolean =>
  (subscriptionRuleEngine as any).evaluateCrispCondition(cond, event, []);

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("crisp conditions on fields the event carries", () => {
  it("evaluates a numeric threshold", () => {
    expect(evaluate({ field: "score", operator: "greater_than_or_equal", value: 0.7 }, { score: 0.8 })).toBe(true);
    expect(evaluate({ field: "score", operator: "greater_than_or_equal", value: 0.7 }, { score: 0.6 })).toBe(false);
  });

  it("accepts the Rule Builder's display symbols as well as canonical names", () => {
    // A UI-authored ">=" once fell through to `default: return false`, so every
    // condition authored in the builder silently never matched.
    expect(evaluate({ field: "score", operator: ">=", value: 0.7 }, { score: 0.8 })).toBe(true);
  });

  it("supports equality, membership, containment and ranges", () => {
    expect(evaluate({ field: "stage", operator: "equals", value: "qualified" }, { stage: "qualified" })).toBe(true);
    expect(evaluate({ field: "stage", operator: "in", value: ["new", "qualified"] }, { stage: "new" })).toBe(true);
    expect(evaluate({ field: "note", operator: "contains", value: "demo" }, { note: "booked a demo" })).toBe(true);
    expect(evaluate({ field: "score", operator: "between", value: [0.2, 0.8] }, { score: 0.5 })).toBe(true);
  });

  it("treats a present-but-undefined field as evaluable", () => {
    // Explicitly set to undefined is a real value the event carries; only an
    // absent key is unevaluable.
    expect(evaluate({ field: "score", operator: "equals", value: undefined }, { score: undefined })).toBe(true);
  });
});

describe("crisp conditions referencing a field the event does not carry", () => {
  it("does not match, and warns", () => {
    expect(evaluate({ field: "typo", operator: "greater_than_or_equal", value: 1 }, { score: 5 })).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("does not carry"));
  });

  it("does NOT fire a negated operator on an absent field", () => {
    // The dangerous case: `undefined !== "x"` is true, so an exclusion rule
    // built on a misspelled field used to match every event.
    expect(evaluate({ field: "typo", operator: "not_equals", value: "x" }, { stage: "new" })).toBe(false);
  });

  it("does NOT fire not_in on an absent field", () => {
    expect(evaluate({ field: "typo", operator: "not_in", value: ["a", "b"] }, { stage: "new" })).toBe(false);
  });

  it("rejects nested paths and says so", () => {
    // Field lookup is flat, so S.C.O.R.E. vectors must be projected onto
    // top-level properties rather than addressed as "score.symptom".
    expect(evaluate({ field: "score.symptom", operator: "greater_than", value: 0.5 }, { score: { symptom: 0.9 } })).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nested paths are not supported"));
  });
});

describe("unrecognised operators", () => {
  it("does not match, and warns", () => {
    expect(evaluate({ field: "score", operator: "approximately", value: 1 }, { score: 1 })).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unrecognised operator"));
  });
});
