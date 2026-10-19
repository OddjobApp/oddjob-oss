/**
 * Behavioral Intelligence Engine — Prediction Bridge
 *
 * Bidirectional integration with the Prediction Intelligence Engine:
 *
 * BI → Prediction:
 * - Score feature vectors as prediction inputs
 * - Score velocity/acceleration as features
 * - Conversion events for correlation analysis
 * - Path data for categorical features
 *
 * Prediction → BI:
 * - Weight auto-tuning proposals
 * - Path pattern discovery
 * - Drift detection → re-scoring triggers
 * - Prediction results written back as derived metrics
 */
import { createLogger } from "@server/utils/logger.js";
import { biScoreState } from "../infrastructure/score-state.js";
import { computeDecay } from "../core/decay-engine.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("BIPredictionBridge");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScoreFeatureVector {
  entity_type: string;
  entity_id: string;
  vectors: Record<string, number>; // Decay-adjusted values
  velocity: Record<string, number>; // Rate of change per vector
  path_state?: { active_path_id: string; step_index: number };
  timestamp: string;
}

export interface WeightProposal {
  id: string;
  model_id: string;
  rule_id: string;
  current_weight: number;
  proposed_weight: number;
  confidence: number;
  correlation: number;
  sample_size: number;
  rationale: string;
  status: "pending" | "approved" | "rejected";
}

export interface ConversionEvent {
  entity_type: string;
  entity_id: string;
  org_id: number;
  outcome: string; // "converted", "churned", "upgraded", "completed_onboarding"
  score_at_conversion: Record<string, number>;
  path_at_conversion?: string;
  timestamp: string;
}

// ─── BI → Prediction (Export) ────────────────────────────────────────────────

/**
 * Export an entity's current score state as a feature vector for the prediction engine.
 */
async function exportScoreFeatures(
  orgId: number,
  entityType: string,
  entityId: string
): Promise<ScoreFeatureVector> {
  const scores = await biScoreState.getScores(orgId, entityType, entityId);
  const temporal = await biScoreState.getTemporalMetrics(orgId, entityType, entityId);
  const now = Math.floor(Date.now() / 1000);

  const vectors: Record<string, number> = {};
  const velocity: Record<string, number> = {};

  for (const score of scores) {
    vectors[score.vector] = computeDecay(score.rawScore, score.lastUpdate, now, { type: "exponential", halfLifeDays: 7 });
    velocity[score.vector] = parseFloat(temporal[`velocity:${score.vector}`] || "0");
  }

  return {
    entity_type: entityType,
    entity_id: entityId,
    vectors,
    velocity,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Record a conversion event for the prediction engine's correlation analysis.
 */
async function recordConversion(event: ConversionEvent): Promise<void> {
  // Emit to event stream for prediction engine consumption
  await eventStream.publish("bi.conversion", {
    ...event,
  }, { organizationId: event.org_id, subject: `bi:conversion:${event.entity_type}:${event.entity_id}` }, "behavioral-intelligence");

  logger.info(`[PredictionBridge] Conversion recorded: ${event.entity_type}:${event.entity_id} → ${event.outcome}`);
}

// ─── Prediction → BI (Import) ────────────────────────────────────────────────

/**
 * Handle a weight adjustment proposal from the prediction engine.
 * Stores it for operator review (not auto-applied).
 */
async function receiveWeightProposal(proposal: WeightProposal): Promise<void> {
  // Store in bi_weight_proposals dataset for management console review
  logger.info(`[PredictionBridge] Weight proposal received: rule ${proposal.rule_id}, ${proposal.current_weight} → ${proposal.proposed_weight} (confidence: ${proposal.confidence})`);

  await eventStream.publish("bi.weight_proposal", {
    ...proposal,
  }, {}, "prediction-engine");
}

/**
 * Handle a drift detection signal from the prediction engine.
 * Triggers re-evaluation of thresholds for the affected entity.
 */
async function handleDriftDetection(orgId: number, entityType: string, entityId: string, driftDetails: any): Promise<void> {
  logger.info(`[PredictionBridge] Drift detected for ${entityType}:${entityId} — triggering re-evaluation`);

  await eventStream.publish("bi.drift_detected", {
    orgId, entityType, entityId, ...driftDetails,
  }, { organizationId: orgId, subject: `bi:drift:${entityType}:${entityId}` }, "prediction-engine");
}

/**
 * Write a prediction result back as a derived metric on the entity's score profile.
 */
async function writePredictionResult(
  orgId: number,
  entityType: string,
  entityId: string,
  metricName: string,
  value: number
): Promise<void> {
  // Store as a special "prediction" source score
  await biScoreState.applyScoreUpdates(orgId, entityType, entityId, [{
    vector: `_pred_${metricName}`,
    weight: value,
    operation: "set",
    source: "qualification", // Predictions are treated as qualification signals (non-decaying)
  }]);
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

let isSubscribed = false;

/**
 * Subscribe to prediction engine events.
 */
function subscribe(): void {
  if (isSubscribed) return;
  isSubscribed = true;

  // Listen for weight proposals
  eventStream.onEvent((event) => {
    if (event.payload?.proposal) {
      receiveWeightProposal(event.payload.proposal).catch(() => {});
    }
  }, { type: "prediction.weight_proposal" });

  // Listen for drift detection
  eventStream.onEvent((event) => {
    const { orgId, entityType, entityId, ...details } = event.payload || {};
    if (orgId && entityType && entityId) {
      handleDriftDetection(orgId, entityType, entityId, details).catch(() => {});
    }
  }, { type: "prediction.drift_detected" });

  logger.info("[PredictionBridge] Subscribed to prediction engine events");
}

function unsubscribe(): void {
  isSubscribed = false;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biPredictionBridge = {
  // Export (BI → Prediction)
  exportScoreFeatures,
  recordConversion,

  // Import (Prediction → BI)
  receiveWeightProposal,
  handleDriftDetection,
  writePredictionResult,

  // Lifecycle
  subscribe,
  unsubscribe,
};
