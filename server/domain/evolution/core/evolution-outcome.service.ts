import { z } from "zod";
import { evaluatedIndividualSchema, type EvaluatedIndividual } from "@shared/evo-devo/index.js";
import { evaluateQuestionStrategy, goodQuestionStrategySchema } from "@domain/ai/core/good-question-strategy.js";
import { evaluatePredictionStrategy, predictionStrategySchema } from "@domain/ai/core/prediction-strategy.js";
import { evolutionPopulationService } from "./evolution-population.service.js";

const commonOutcome = {
  phenotypeHash: z.string().min(1), sampleSize: z.number().int().positive(),
  latencyMs: z.number().nonnegative(), costUsd: z.number().nonnegative(),
};
const questionOutcomeSchema = z.object({
  ...commonOutcome, strategy: goodQuestionStrategySchema, answered: z.boolean(),
  downstreamSucceeded: z.boolean(), policyViolation: z.boolean(), clarificationRounds: z.number().int().nonnegative(),
});
const predictionOutcomeSchema = z.object({
  ...commonOutcome, strategy: predictionStrategySchema, transitionSucceeded: z.boolean(),
  policyViolation: z.boolean(), rollbackRequired: z.boolean(),
});

export interface OutcomeRecorder {
  record(orgId: number, phenotypeId: string, evaluatorKey: string, evaluatorVersion: string, evaluated: EvaluatedIndividual, evidence: Record<string, unknown>): Promise<void>;
}

class PopulationOutcomeRecorder implements OutcomeRecorder {
  async record(orgId: number, phenotypeId: string, evaluatorKey: string, evaluatorVersion: string, evaluated: EvaluatedIndividual, evidence: Record<string, unknown>) {
    await evolutionPopulationService.recordEvaluation(orgId, phenotypeId, {
      evaluatorKey, evaluatorVersion, fitness: evaluated.fitness, eligible: evaluated.eligible,
      ineligibilityReasons: evaluated.ineligibilityReasons, evidence,
    });
  }
}

export class EvolutionOutcomeService {
  constructor(private readonly recorder: OutcomeRecorder = new PopulationOutcomeRecorder()) {}
  async recordGoodQuestion(orgId: number, phenotypeId: string, input: unknown) {
    const parsed = questionOutcomeSchema.parse(input);
    const evaluated = evaluatedIndividualSchema.parse(evaluateQuestionStrategy(parsed.strategy, parsed.phenotypeHash, {
      answered: parsed.answered, downstreamSucceeded: parsed.downstreamSucceeded, policyViolation: parsed.policyViolation,
      clarificationRounds: parsed.clarificationRounds, responseLatencyMs: parsed.latencyMs,
      estimatedCostUsd: parsed.costUsd, sampleSize: parsed.sampleSize,
    }));
    await this.recorder.record(orgId, phenotypeId, "good-question", `strategy:${parsed.strategy.id}`, evaluated, { strategyGeneration: parsed.strategy.generation });
    return evaluated;
  }
  async recordPrediction(orgId: number, phenotypeId: string, input: unknown) {
    const parsed = predictionOutcomeSchema.parse(input);
    const evaluated = evaluatedIndividualSchema.parse(evaluatePredictionStrategy(parsed.strategy, parsed.phenotypeHash, {
      transitionSucceeded: parsed.transitionSucceeded, policyViolation: parsed.policyViolation,
      rollbackRequired: parsed.rollbackRequired, latencyMs: parsed.latencyMs, costUsd: parsed.costUsd, sampleSize: parsed.sampleSize,
    }));
    await this.recorder.record(orgId, phenotypeId, "prediction", `strategy:${parsed.strategy.id}`, evaluated, { strategyGeneration: parsed.strategy.generation });
    return evaluated;
  }
}
export const evolutionOutcomeService = new EvolutionOutcomeService();

