import { evaluatedIndividualSchema, type EvaluatedIndividual, type FitnessVector } from "./contracts.js";

const MAXIMIZE: Array<keyof FitnessVector> = ["outcome", "reliability", "safety", "humanExperience", "sampleSize"];
const MINIMIZE: Array<keyof FitnessVector> = ["costUsd", "latencyMs"];

export interface SelectionConstraints {
  minimumSafety: number;
  minimumReliability: number;
  minimumSampleSize: number;
  maximumCostUsd?: number;
  maximumLatencyMs?: number;
}

export function applyFitnessConstraints(
  individualInput: EvaluatedIndividual,
  constraints: SelectionConstraints,
): EvaluatedIndividual {
  const individual = evaluatedIndividualSchema.parse(individualInput);
  const reasons = [...individual.ineligibilityReasons];
  if (individual.fitness.safety < constraints.minimumSafety) reasons.push("safety_below_minimum");
  if (individual.fitness.reliability < constraints.minimumReliability) reasons.push("reliability_below_minimum");
  if (individual.fitness.sampleSize < constraints.minimumSampleSize) reasons.push("insufficient_sample_size");
  if (constraints.maximumCostUsd !== undefined && individual.fitness.costUsd > constraints.maximumCostUsd) reasons.push("cost_above_maximum");
  if (constraints.maximumLatencyMs !== undefined && individual.fitness.latencyMs > constraints.maximumLatencyMs) reasons.push("latency_above_maximum");
  return { ...individual, eligible: individual.eligible && reasons.length === 0, ineligibilityReasons: [...new Set(reasons)] };
}

export function dominates(left: EvaluatedIndividual, right: EvaluatedIndividual): boolean {
  let strictlyBetter = false;
  for (const metric of MAXIMIZE) {
    if (left.fitness[metric] < right.fitness[metric]) return false;
    if (left.fitness[metric] > right.fitness[metric]) strictlyBetter = true;
  }
  for (const metric of MINIMIZE) {
    if (left.fitness[metric] > right.fitness[metric]) return false;
    if (left.fitness[metric] < right.fitness[metric]) strictlyBetter = true;
  }
  return strictlyBetter;
}

export function paretoFront(
  populationInput: EvaluatedIndividual[],
  constraints: SelectionConstraints,
): EvaluatedIndividual[] {
  const population = populationInput.map((individual) => applyFitnessConstraints(individual, constraints));
  const eligible = population.filter((individual) => individual.eligible);
  return eligible
    .filter((candidate) => !eligible.some((other) => other.genomeId !== candidate.genomeId && dominates(other, candidate)))
    .sort((left, right) => left.genomeId.localeCompare(right.genomeId));
}

