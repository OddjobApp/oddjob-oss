import { z } from "zod";
import { stableContentHash, type EvaluatedIndividual } from "@shared/evo-devo/index.js";
import type { LifecycleStage } from "../../agents/core/agent-lifecycle-state-machine.js";

const optionSchema = z.object({ id: z.string().min(1), label: z.string().min(1) });
export const goodQuestionStrategySchema = z.object({
  id: z.string().min(1),
  generation: z.number().int().nonnegative(),
  parentIds: z.array(z.string()).max(2),
  minimumDiscriminativeValueBits: z.number().min(0),
  highRiskThreshold: z.number().min(0).max(1),
  decisionOptions: z.array(optionSchema).min(2).max(5),
  baseApproverRoles: z.array(z.string().min(1)).min(1),
  highRiskApproverRoles: z.array(z.string().min(1)).min(1),
  protectedRules: z.array(z.enum(["attestation_required", "high_risk_approval", "shadow_fallback"])),
});
export type GoodQuestionStrategy = z.infer<typeof goodQuestionStrategySchema>;

export const DEFAULT_GOOD_QUESTION_STRATEGY: GoodQuestionStrategy = {
  id: "gqe-governed-v1", generation: 0, parentIds: [], minimumDiscriminativeValueBits: 0.5,
  highRiskThreshold: 0.7,
  decisionOptions: [
    { id: "approve", label: "Approve Proposed Patch & Assign Ownership" },
    { id: "rollback", label: "Rollback to Baseline Deployment" },
    { id: "shadow", label: "Run Shadow Pipeline First" },
  ],
  baseApproverRoles: ["operations-supervisor", "application-owner"],
  highRiskApproverRoles: ["operations-supervisor", "application-owner"],
  protectedRules: ["attestation_required", "high_risk_approval", "shadow_fallback"],
};

export interface QuestionStrategyPhenotype {
  strategyId: string;
  strategyGeneration: number;
  phenotypeHash: string;
  stage: LifecycleStage;
  options: GoodQuestionStrategy["decisionOptions"];
  requiredApproverRoles: string[];
  attestationRequired: true;
}

export function developQuestionStrategy(
  strategyInput: GoodQuestionStrategy,
  context: { stage: LifecycleStage; riskScore: number },
): QuestionStrategyPhenotype {
  const strategy = goodQuestionStrategySchema.parse(strategyInput);
  for (const rule of ["attestation_required", "high_risk_approval", "shadow_fallback"] as const) {
    if (!strategy.protectedRules.includes(rule)) throw new Error(`GQE strategy is missing protected rule: ${rule}`);
  }
  const highRisk = context.riskScore >= strategy.highRiskThreshold;
  const phenotype = {
    strategyId: strategy.id,
    strategyGeneration: strategy.generation,
    stage: context.stage,
    options: strategy.decisionOptions,
    requiredApproverRoles: highRisk ? strategy.highRiskApproverRoles : strategy.baseApproverRoles,
    attestationRequired: true as const,
  };
  return { ...phenotype, phenotypeHash: stableContentHash(phenotype) };
}

export interface QuestionOutcome {
  answered: boolean;
  downstreamSucceeded: boolean;
  policyViolation: boolean;
  clarificationRounds: number;
  responseLatencyMs: number;
  estimatedCostUsd: number;
  sampleSize: number;
}

export function evaluateQuestionStrategy(
  strategy: GoodQuestionStrategy,
  phenotypeHash: string,
  outcome: QuestionOutcome,
): EvaluatedIndividual {
  const friction = Math.min(1, outcome.clarificationRounds / 4);
  return {
    genomeId: strategy.id,
    phenotypeHash,
    eligible: !outcome.policyViolation,
    ineligibilityReasons: outcome.policyViolation ? ["policy_violation"] : [],
    fitness: {
      outcome: outcome.downstreamSucceeded ? 1 : 0,
      reliability: outcome.answered ? 1 : 0,
      safety: outcome.policyViolation ? 0 : 1,
      humanExperience: Math.max(0, (outcome.answered ? 1 : 0.25) - friction),
      costUsd: outcome.estimatedCostUsd,
      latencyMs: outcome.responseLatencyMs,
      sampleSize: outcome.sampleSize,
    },
  };
}

