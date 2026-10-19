import { describe, expect, it } from "vitest";
import { PredictionEngine } from "./prediction-engine.service.js";
import { DEFAULT_PREDICTION_STRATEGY, evaluatePredictionStrategy } from "./prediction-strategy.js";

const trajectory = (targetFileOrNode: string, confidenceScore?: number) => ({
  currentState: { stage: "Diagnose" as const, targetFileOrNode },
  candidateNextStep: { stage: "Improve" as const, targetFileOrNode, confidenceScore },
});

describe("evolvable prediction strategy", () => {
  it("allows a default routine trajectory to reach its calibrated threshold", () => {
    const result = PredictionEngine.evaluateTrajectory(trajectory("server/routes/product.ts"));
    expect(result).toMatchObject({ riskClass: "routine", recommendedAction: "auto_execute", requiredThreshold: 0.85 });
    expect(result.safeTransitionScore).toBe(0.855);
  });

  it("requires approval for explicitly critical transitions regardless of confidence", () => {
    const result = PredictionEngine.evaluateTrajectory({
      currentState: { stage: "Diagnose", targetFileOrNode: "release-target" },
      candidateNextStep: { stage: "Improve", targetFileOrNode: "release-target", confidenceScore: 1, riskClass: "critical" },
    });
    expect(result).toMatchObject({ riskClass: "critical", recommendedAction: "require_approval", requiredThreshold: null });
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid confidence %s", (confidenceScore) => {
    expect(() => PredictionEngine.evaluateTrajectory(trajectory("routine", confidenceScore))).toThrow(RangeError);
  });

  it("uses token-aware fallback classification", () => {
    expect(PredictionEngine.evaluateTrajectory(trajectory("PRODUCT/catalog.ts", 1)).riskClass).toBe("routine");
    expect(PredictionEngine.evaluateTrajectory(trajectory("PRODUCTION/catalog.ts", 1)).riskClass).toBe("critical");
  });

  it("rejects descendant strategies that remove protected governance", () => {
    expect(() => PredictionEngine.evaluateTrajectory({
      ...trajectory("routine"), strategy: { ...DEFAULT_PREDICTION_STRATEGY, protectedRules: [] },
    })).toThrow(/protected rule/);
  });

  it("turns observed outcomes into selection-ready fitness", () => {
    const result = PredictionEngine.evaluateTrajectory(trajectory("routine"));
    const fitness = evaluatePredictionStrategy(DEFAULT_PREDICTION_STRATEGY, result.strategyTrace!.phenotypeHash, {
      transitionSucceeded: true, policyViolation: false, rollbackRequired: false,
      latencyMs: 500, costUsd: 0.02, sampleSize: 40,
    });
    expect(fitness).toMatchObject({ eligible: true, fitness: { outcome: 1, reliability: 1, safety: 1 } });
  });
});
