import { describe, expect, it } from "vitest";
import { GoodQuestionEngine } from "./good-question-engine.js";
import {
  DEFAULT_GOOD_QUESTION_STRATEGY,
  developQuestionStrategy,
  evaluateQuestionStrategy,
  type GoodQuestionStrategy,
} from "./good-question-strategy.js";

const evaluationResult = {
  safeTransitionScore: 0.8, blastRadius: 0.2, probabilitySuccess: 0.7, reason: "approval required",
} as any;

describe("evolvable Good Question strategy", () => {
  it("replays a strategy deterministically and exposes its lineage trace", () => {
    const context = { stage: "Approve" as const, targetNodeOrFile: "billing", evaluationResult, replayKey: "case-42" };
    const first = GoodQuestionEngine.generateStructuredQuestion(context);
    const replay = GoodQuestionEngine.generateStructuredQuestion(context);
    expect(replay).toEqual(first);
    expect(first.strategyTrace).toMatchObject({ strategyId: "gqe-governed-v1", generation: 0 });
  });

  it("expresses a safe contextual phenotype from a descendant strategy", () => {
    const descendant: GoodQuestionStrategy = {
      ...DEFAULT_GOOD_QUESTION_STRATEGY, id: "gqe-concise-v2", generation: 1,
      parentIds: [DEFAULT_GOOD_QUESTION_STRATEGY.id], highRiskThreshold: 0.6,
      decisionOptions: [{ id: "shadow", label: "Run a shadow test" }, { id: "reject", label: "Reject" }],
    };
    const phenotype = developQuestionStrategy(descendant, { stage: "Approve", riskScore: 0.9 });
    expect(phenotype).toMatchObject({ strategyId: "gqe-concise-v2", strategyGeneration: 1, attestationRequired: true });
  });

  it("rejects descendants that remove protected governance", () => {
    expect(() => developQuestionStrategy({ ...DEFAULT_GOOD_QUESTION_STRATEGY, protectedRules: [] }, {
      stage: "Approve", riskScore: 0.9,
    })).toThrow(/protected rule/);
  });

  it("turns observed H2A outcomes into selection-ready fitness", () => {
    const phenotype = developQuestionStrategy(DEFAULT_GOOD_QUESTION_STRATEGY, { stage: "Approve", riskScore: 0.8 });
    const result = evaluateQuestionStrategy(DEFAULT_GOOD_QUESTION_STRATEGY, phenotype.phenotypeHash, {
      answered: true, downstreamSucceeded: true, policyViolation: false, clarificationRounds: 1,
      responseLatencyMs: 2000, estimatedCostUsd: 0.01, sampleSize: 50,
    });
    expect(result).toMatchObject({ eligible: true, fitness: { outcome: 1, reliability: 1, safety: 1, humanExperience: 0.75 } });
  });
});

