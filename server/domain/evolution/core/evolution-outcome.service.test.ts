import { describe, expect, it } from "vitest";
import { EvolutionOutcomeService, type OutcomeRecorder } from "./evolution-outcome.service.js";
import { DEFAULT_GOOD_QUESTION_STRATEGY } from "@domain/ai/core/good-question-strategy.js";
import { DEFAULT_PREDICTION_STRATEGY } from "@domain/ai/core/prediction-strategy.js";

class MemoryRecorder implements OutcomeRecorder {
  rows: any[] = [];
  async record(...args: any[]) { this.rows.push(args); }
}

describe("EvolutionOutcomeService", () => {
  it("records GQE business outcomes as durable fitness", async () => {
    const recorder = new MemoryRecorder(); const service = new EvolutionOutcomeService(recorder);
    const result = await service.recordGoodQuestion(1, "phenotype", {
      strategy: DEFAULT_GOOD_QUESTION_STRATEGY, phenotypeHash: "hash", answered: true,
      downstreamSucceeded: true, policyViolation: false, clarificationRounds: 1,
      latencyMs: 100, costUsd: 0.01, sampleSize: 20,
    });
    expect(result).toMatchObject({ eligible: true, fitness: { outcome: 1, humanExperience: 0.75 } });
    expect(recorder.rows[0].slice(0, 4)).toEqual([1, "phenotype", "good-question", "strategy:gqe-governed-v1"]);
  });
  it("makes policy-violating predictions ineligible", async () => {
    const recorder = new MemoryRecorder(); const service = new EvolutionOutcomeService(recorder);
    const result = await service.recordPrediction(1, "phenotype", {
      strategy: DEFAULT_PREDICTION_STRATEGY, phenotypeHash: "hash", transitionSucceeded: true,
      policyViolation: true, rollbackRequired: false, latencyMs: 100, costUsd: 0.01, sampleSize: 20,
    });
    expect(result).toMatchObject({ eligible: false, ineligibilityReasons: ["policy_violation"], fitness: { safety: 0 } });
  });
});

