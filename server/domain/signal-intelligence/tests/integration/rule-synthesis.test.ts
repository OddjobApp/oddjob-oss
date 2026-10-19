/**
 * Unit Tests for Rule Synthesis & Formal Proof Engine (Level 3)
 */

import { describe, expect, it } from "vitest";
import {
  RuleSynthesisService,
  type RuleVerificationReport,
} from "../../core/rule-synthesis.service.js";
import type { CrispCondition, RuleBranchSpec } from "../../core/subscription-rule-engine.service.js";

describe("Rule Synthesis & Formal Proof Engine (Level 3)", () => {
  const service = new RuleSynthesisService();

  it("compiles natural language rule into typed RuleBranchSpec", () => {
    const nl = "If severity is Critical and targetSector is Semiconductor and confidence >= 0.85";
    const branch = service.synthesizeRuleFromNaturalLanguage(nl, "Critical Semiconductor Rule");

    expect(branch.branchName).toBe("Critical Semiconductor Rule");
    expect(branch.matchStrategy).toBe("ALL");
    expect(branch.conditions.length).toBe(3);

    // Narrowed rather than cast to `any`: the compiler emits crisp conditions,
    // and only crisp ones carry `operator`/`value` — a fuzzy or spatial
    // condition has neither, so asserting on them through `any` would hide a
    // synthesizer that started emitting the wrong condition type.
    const crisp = branch.conditions.filter((c): c is CrispCondition => c.type === "crisp");
    expect(crisp.length).toBe(3);

    const severityCond = crisp.find((c) => c.field === "severity");
    expect(severityCond?.value).toBe("Critical");

    const sectorCond = crisp.find((c) => c.field === "targetSector");
    expect(sectorCond?.value).toBe("Semiconductor");

    const confCond = crisp.find((c) => c.field === "confidence");
    expect(confCond?.operator).toBe("greater_than_or_equal");
    expect(confCond?.value).toBe(0.85);
  });

  it("formally passes verification for consistent rules", () => {
    const branch: RuleBranchSpec = {
      branchId: "b-valid",
      branchName: "Valid Branch",
      matchStrategy: "ALL",
      conditions: [
        { type: "crisp", field: "severity", operator: "equals", value: "High" },
        { type: "crisp", field: "confidence", operator: "greater_than_or_equal", value: 0.7 },
      ],
      thenAction: { deliveryMode: "notify_agent" },
    };

    const report: RuleVerificationReport = service.verifyRuleFormalConsistency(branch);
    expect(report.isValid).toBe(true);
    expect(report.contradictions).toEqual([]);
    expect(report.invariantsPassed).toContain("Contradiction & Unsatisfiability checks passed");
  });

  it("detects direct equality contradictions (severity == Critical AND severity == Low)", () => {
    const branch: RuleBranchSpec = {
      branchId: "b-contradict",
      branchName: "Contradictory Branch",
      matchStrategy: "ALL",
      conditions: [
        { type: "crisp", field: "severity", operator: "equals", value: "Critical" },
        { type: "crisp", field: "severity", operator: "equals", value: "Low" },
      ],
      thenAction: { deliveryMode: "notify_agent" },
    };

    const report = service.verifyRuleFormalConsistency(branch);
    expect(report.isValid).toBe(false);
    expect(report.contradictions.length).toBeGreaterThan(0);
    expect(report.contradictions[0]).toContain("cannot simultaneously equal");
  });

  it("detects unsatisfiable numeric ranges (x > 100 AND x < 50)", () => {
    const branch: RuleBranchSpec = {
      branchId: "b-unsat-range",
      branchName: "Unsatisfiable Range Branch",
      matchStrategy: "ALL",
      conditions: [
        { type: "crisp", field: "price", operator: "greater_than", value: 100 },
        { type: "crisp", field: "price", operator: "less_than", value: 50 },
      ],
      thenAction: { deliveryMode: "notify_agent" },
    };

    const report = service.verifyRuleFormalConsistency(branch);
    expect(report.isValid).toBe(false);
    expect(report.contradictions[0]).toContain("Unsatisfiable range");
  });

  it("detects inverted 'between' bounds (min > max)", () => {
    const branch: RuleBranchSpec = {
      branchId: "b-inverted-between",
      branchName: "Inverted Between Branch",
      matchStrategy: "ALL",
      conditions: [
        { type: "crisp", field: "latency", operator: "between", value: [500, 100] },
      ],
      thenAction: { deliveryMode: "notify_agent" },
    };

    const report = service.verifyRuleFormalConsistency(branch);
    expect(report.isValid).toBe(false);
    expect(report.contradictions[0]).toContain("Inverted boundary");
  });
});
