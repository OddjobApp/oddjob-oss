import { z } from "zod";
import { stableContentHash, type EvaluatedIndividual } from "@shared/evo-devo/index.js";

export const trajectoryRiskClassSchema = z.enum(["routine", "elevated", "critical"]);
export type TrajectoryRiskClass = z.infer<typeof trajectoryRiskClassSchema>;

export const predictionStrategySchema = z.object({
  id: z.string().min(1), generation: z.number().int().nonnegative(), parentIds: z.array(z.string()).max(2),
  defaultProbability: z.number().min(0).max(1),
  minimumSafeScore: z.object({ routine: z.number().min(0).max(1), elevated: z.number().min(0).max(1) }),
  blastRadius: z.object({ routine: z.number().min(0).max(1), elevated: z.number().min(0).max(1), critical: z.number().min(0).max(1) }),
  protectedRules: z.array(z.enum(["critical_requires_approval", "loop_halts", "bounded_confidence"])),
});
export type PredictionStrategy = z.infer<typeof predictionStrategySchema>;

export const DEFAULT_PREDICTION_STRATEGY: PredictionStrategy = {
  id: "trajectory-governed-v1", generation: 0, parentIds: [], defaultProbability: 0.95,
  minimumSafeScore: { routine: 0.85, elevated: 0.75 },
  blastRadius: { routine: 0.1, elevated: 0.2, critical: 0.35 },
  protectedRules: ["critical_requires_approval", "loop_halts", "bounded_confidence"],
};

export function validatePredictionStrategy(input: PredictionStrategy): PredictionStrategy {
  const strategy = predictionStrategySchema.parse(input);
  for (const rule of ["critical_requires_approval", "loop_halts", "bounded_confidence"] as const) {
    if (!strategy.protectedRules.includes(rule)) throw new Error(`Prediction strategy is missing protected rule: ${rule}`);
  }
  return strategy;
}

export function predictionStrategyTrace(strategy: PredictionStrategy, riskClass: TrajectoryRiskClass) {
  const expressed = { strategyId: strategy.id, generation: strategy.generation, riskClass };
  return { ...expressed, phenotypeHash: stableContentHash(expressed) };
}

export interface PredictionOutcome {
  transitionSucceeded: boolean; policyViolation: boolean; rollbackRequired: boolean;
  latencyMs: number; costUsd: number; sampleSize: number;
}

export function evaluatePredictionStrategy(strategy: PredictionStrategy, phenotypeHash: string, outcome: PredictionOutcome): EvaluatedIndividual {
  return {
    genomeId: strategy.id, phenotypeHash,
    eligible: !outcome.policyViolation,
    ineligibilityReasons: outcome.policyViolation ? ["policy_violation"] : [],
    fitness: {
      outcome: outcome.transitionSucceeded ? 1 : 0,
      reliability: outcome.rollbackRequired ? 0 : 1,
      safety: outcome.policyViolation ? 0 : 1,
      humanExperience: outcome.rollbackRequired ? 0.25 : 1,
      costUsd: outcome.costUsd, latencyMs: outcome.latencyMs, sampleSize: outcome.sampleSize,
    },
  };
}

