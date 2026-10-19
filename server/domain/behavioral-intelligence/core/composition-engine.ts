/**
 * Behavioral Intelligence Engine — Composition Engine
 *
 * Aggregates child entity scores into parent entity scores.
 * Supports: weighted_average, min, max, percentage_above_threshold, sum, expression.
 *
 * Examples:
 * - Account health = weighted_average of contact scores
 * - Launch readiness = min(all workstream scores)
 * - Team certification = percentage of members with Training > 0.8
 * - Fleet health = min reliability across all vehicles
 */
import { createLogger } from "@server/utils/logger.js";
import { biScoreState } from "../infrastructure/score-state.js";
import { computeDecay } from "./decay-engine.js";
import { evaluate } from "./expression-engine.js";

const logger = createLogger("BIComposition");

// ─── Types ───────────────────────────────────────────────────────────────────

export type AggregationType = "weighted_average" | "min" | "max" | "percentage_above_threshold" | "sum" | "expression";

export interface CompositionRule {
  id: string;
  parent_entity_type: string;
  parent_entity_id: string;
  child_entity_type: string;
  vector: string;                    // Which vector to aggregate
  aggregation: AggregationType;
  // For weighted_average
  weights?: Record<string, number>;  // child_id → weight
  // For percentage_above_threshold
  threshold?: number;
  // For expression
  expression?: string;
  // Filter children
  filter?: { field: string; value: any };
}

export interface ComposedScore {
  parent_entity_type: string;
  parent_entity_id: string;
  vector: string;
  value: number;
  child_count: number;
  aggregation: AggregationType;
  computed_at: string;
}

// ─── Composition Logic ───────────────────────────────────────────────────────

/**
 * Compute a composed score from child entities.
 */
async function computeComposition(
  orgId: number,
  rule: CompositionRule,
  childEntityIds: string[]
): Promise<ComposedScore> {
  const now = Math.floor(Date.now() / 1000);
  const childScores: number[] = [];

  // Fetch scores for all children
  const scoreMap = await biScoreState.batchGetScores(orgId, rule.child_entity_type, childEntityIds);

  for (const [childId, vectors] of scoreMap) {
    const vectorScore = vectors.find(v => v.vector === rule.vector);
    if (vectorScore) {
      const decayed = computeDecay(vectorScore.rawScore, vectorScore.lastUpdate, now, { type: "exponential", halfLifeDays: 7 });
      childScores.push(decayed);
    }
  }

  let value = 0;

  switch (rule.aggregation) {
    case "weighted_average": {
      if (childScores.length === 0) break;
      if (rule.weights) {
        let totalWeight = 0;
        let weightedSum = 0;
        for (let i = 0; i < childEntityIds.length; i++) {
          const w = rule.weights[childEntityIds[i]] || 1;
          weightedSum += (childScores[i] || 0) * w;
          totalWeight += w;
        }
        value = totalWeight > 0 ? weightedSum / totalWeight : 0;
      } else {
        value = childScores.reduce((sum, s) => sum + s, 0) / childScores.length;
      }
      break;
    }
    case "min":
      value = childScores.length > 0 ? Math.min(...childScores) : 0;
      break;
    case "max":
      value = childScores.length > 0 ? Math.max(...childScores) : 0;
      break;
    case "sum":
      value = childScores.reduce((sum, s) => sum + s, 0);
      break;
    case "percentage_above_threshold": {
      const threshold = rule.threshold ?? 0.7;
      const above = childScores.filter(s => s > threshold).length;
      value = childScores.length > 0 ? above / childScores.length : 0;
      break;
    }
    case "expression": {
      if (rule.expression) {
        try {
          value = Number(evaluate(rule.expression, { children: childScores, count: childScores.length })) || 0;
        } catch { value = 0; }
      }
      break;
    }
  }

  return {
    parent_entity_type: rule.parent_entity_type,
    parent_entity_id: rule.parent_entity_id,
    vector: rule.vector,
    value: Math.round(value * 1000) / 1000,
    child_count: childScores.length,
    aggregation: rule.aggregation,
    computed_at: new Date().toISOString(),
  };
}

/**
 * Compute derived metrics from multiple vectors on the same entity.
 * e.g., "Overall BANT = (Budget × 0.3) + (Authority × 0.25) + (Need × 0.25) + (Timeline × 0.2)"
 */
async function computeDerivedMetric(
  orgId: number,
  entityType: string,
  entityId: string,
  metricExpression: string
): Promise<number> {
  const scores = await biScoreState.getScores(orgId, entityType, entityId);
  const now = Math.floor(Date.now() / 1000);

  const vectors: Record<string, number> = {};
  for (const score of scores) {
    vectors[score.vector] = computeDecay(score.rawScore, score.lastUpdate, now, { type: "exponential", halfLifeDays: 7 });
  }

  try {
    return Number(evaluate(metricExpression, { vectors })) || 0;
  } catch {
    return 0;
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biCompositionEngine = {
  computeComposition,
  computeDerivedMetric,
};
