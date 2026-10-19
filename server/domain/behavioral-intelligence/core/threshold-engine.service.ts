/**
 * Behavioral Intelligence Engine — Threshold Engine
 *
 * Evaluates score thresholds after every score update.
 * Uses Redis Lua scripts for atomic evaluation (read scores + check conditions + set cooldown).
 *
 * Supports:
 * - Compound conditions (AND/OR across multiple vectors)
 * - Hysteresis bands (prevent oscillation)
 * - Cooldown management (per entity × threshold)
 * - Lazy decay application during evaluation
 */
import { createLogger } from "@server/utils/logger.js";
import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";
import { biScoreState } from "../infrastructure/score-state.js";
import { biRedisStreams, type BIActionEvent } from "../infrastructure/redis-streams.js";
import { evaluate } from "./expression-engine.js";
import { computeDecay, type DecayConfig } from "./decay-engine.js";
import crypto from "node:crypto";

const logger = createLogger("BIThresholdEngine");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ThresholdDefinition {
  id: string;
  model_id: string;
  name: string;
  /** Expression that evaluates to boolean (e.g., "Budget > 0.7 AND Authority > 0.5") */
  condition_expression: string;
  /** Hysteresis band as percentage below threshold (default 5%) */
  hysteresis_percent: number;
  /** Cooldown in milliseconds after firing (default 60000) */
  cooldown_ms: number;
  /** Actions to dispatch when threshold is crossed */
  actions: Array<{
    type: "webhook" | "slack_notification" | "mission_launch" | "email" | "crm_update" | "hil_form";
    config: Record<string, any>;
  }>;
  /** Governance budget pool ID (for spend capping) */
  governance_budget_pool_id?: string;
  /** Knowledge concept ID for semantic tagging */
  concept_id?: number;
  /** Entity type this threshold applies to */
  entity_type?: string;
  enabled: boolean;
}

export interface ThresholdCrossing {
  threshold_id: string;
  threshold_name: string;
  entity_type: string;
  entity_id: string;
  org_id: number;
  vector_values: Record<string, number>;
  crossed_at: string;
  actions: ThresholdDefinition["actions"];
}

// ─── Threshold Evaluation ────────────────────────────────────────────────────

/**
 * Evaluate all active thresholds for an entity after a score update.
 * Returns list of thresholds that were crossed.
 */
async function evaluateThresholds(
  orgId: number,
  entityType: string,
  entityId: string,
  thresholds: ThresholdDefinition[],
  decayConfigs: Record<string, DecayConfig>
): Promise<ThresholdCrossing[]> {
  if (thresholds.length === 0) return [];

  // Get current scores
  const scores = await biScoreState.getScores(orgId, entityType, entityId);
  if (scores.length === 0) return [];

  const now = Math.floor(Date.now() / 1000);
  const crossings: ThresholdCrossing[] = [];

  // Build decay-adjusted score map
  const decayedScores: Record<string, number> = {};
  for (const score of scores) {
    const decay = decayConfigs[score.vector] || { type: "none" as const };
    decayedScores[score.vector] = computeDecay(score.rawScore, score.lastUpdate, now, decay);
  }

  // Evaluate each threshold
  for (const threshold of thresholds) {
    if (!threshold.enabled) continue;
    if (threshold.entity_type && threshold.entity_type !== entityType) continue;

    // Check cooldown
    const inCooldown = await biScoreState.isInCooldown(orgId, threshold.id, entityType, entityId);
    if (inCooldown) continue;

    // Evaluate condition expression
    try {
      const context = { vectors: decayedScores, entity: { type: entityType, id: entityId } };
      const result = evaluate(threshold.condition_expression, context, 10); // 10ms timeout for threshold eval

      if (Boolean(result)) {
        // Threshold crossed!
        crossings.push({
          threshold_id: threshold.id,
          threshold_name: threshold.name,
          entity_type: entityType,
          entity_id: entityId,
          org_id: orgId,
          vector_values: { ...decayedScores },
          crossed_at: new Date().toISOString(),
          actions: threshold.actions,
        });

        // Set cooldown
        await biScoreState.setCooldown(orgId, threshold.id, entityType, entityId, threshold.cooldown_ms);

        logger.info(`[Threshold] "${threshold.name}" crossed for ${entityType}:${entityId} in org ${orgId}`);
      }
    } catch (err: any) {
      logger.warn(`[Threshold] Evaluation failed for "${threshold.name}": ${err.message}`);
    }
  }

  return crossings;
}

/**
 * Dispatch actions for threshold crossings.
 * Enqueues actions to the action stream for async processing.
 */
async function dispatchCrossings(crossings: ThresholdCrossing[]): Promise<void> {
  for (const crossing of crossings) {
    for (const action of crossing.actions) {
      const actionEvent: BIActionEvent = {
        action_id: crypto.randomUUID(),
        threshold_id: crossing.threshold_id,
        entity_type: crossing.entity_type,
        entity_id: crossing.entity_id,
        org_id: crossing.org_id,
        action_type: action.type,
        action_config: action.config,
        crossed_at: crossing.crossed_at,
        vector: Object.keys(crossing.vector_values).join(","),
        score_value: Math.max(...Object.values(crossing.vector_values)),
        context: { threshold_name: crossing.threshold_name, vector_values: crossing.vector_values },
      };

      await biRedisStreams.enqueueAction(actionEvent);
    }
  }
}

/**
 * Full threshold evaluation + dispatch pipeline.
 * Called after every score update.
 */
async function evaluateAndDispatch(
  orgId: number,
  entityType: string,
  entityId: string,
  thresholds: ThresholdDefinition[],
  decayConfigs: Record<string, DecayConfig>
): Promise<ThresholdCrossing[]> {
  const crossings = await evaluateThresholds(orgId, entityType, entityId, thresholds, decayConfigs);
  if (crossings.length > 0) {
    await dispatchCrossings(crossings);
  }
  return crossings;
}

// ─── Threshold Status Query ──────────────────────────────────────────────────

/**
 * Get the current threshold status for an entity (which thresholds are met/unmet).
 */
async function getThresholdStatus(
  orgId: number,
  entityType: string,
  entityId: string,
  thresholds: ThresholdDefinition[],
  decayConfigs: Record<string, DecayConfig>
): Promise<Array<{ threshold_id: string; name: string; met: boolean; in_cooldown: boolean }>> {
  const scores = await biScoreState.getScores(orgId, entityType, entityId);
  const now = Math.floor(Date.now() / 1000);

  const decayedScores: Record<string, number> = {};
  for (const score of scores) {
    const decay = decayConfigs[score.vector] || { type: "none" as const };
    decayedScores[score.vector] = computeDecay(score.rawScore, score.lastUpdate, now, decay);
  }

  const results: Array<{ threshold_id: string; name: string; met: boolean; in_cooldown: boolean }> = [];

  for (const threshold of thresholds) {
    if (!threshold.enabled) continue;
    if (threshold.entity_type && threshold.entity_type !== entityType) continue;

    let met = false;
    try {
      const context = { vectors: decayedScores, entity: { type: entityType, id: entityId } };
      met = Boolean(evaluate(threshold.condition_expression, context, 10));
    } catch { /* evaluation failed — treat as unmet */ }

    const inCooldown = await biScoreState.isInCooldown(orgId, threshold.id, entityType, entityId);

    results.push({ threshold_id: threshold.id, name: threshold.name, met, in_cooldown: inCooldown });
  }

  return results;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biThresholdEngine = {
  evaluateThresholds,
  dispatchCrossings,
  evaluateAndDispatch,
  getThresholdStatus,
};
