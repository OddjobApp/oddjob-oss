/**
 * Behavioral Intelligence Engine — Scoring Engine
 *
 * The main consumer loop that:
 * 1. Reads events from Redis Streams
 * 2. Evaluates them against the compiled rule index
 * 3. Applies score updates atomically
 * 4. Executes logic chains
 * 5. Updates event windows (for path matching)
 * 6. Triggers threshold evaluation
 * 7. Emits score_changed events
 *
 * Target: < 200ms from event consumption to score update.
 */
import { createLogger } from "@server/utils/logger.js";
import { biRedisStreams, type BIScoringEvent } from "../infrastructure/redis-streams.js";
import { biScoreState, type ScoreUpdate } from "../infrastructure/score-state.js";
import { getOrCreateIndex, type RuleMatch, type CompiledRule } from "../infrastructure/rule-index.js";
import { evaluate, type EvalContext } from "./expression-engine.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("BIScoringEngine");

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_CHAIN_DEPTH = 5;
const CONSUMER_ID = `scoring-${process.pid}`;
const BATCH_SIZE = 100;
const BLOCK_MS = 1000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScoringResult {
  entityType: string;
  entityId: string;
  updatedVectors: Record<string, number>;
  rulesMatched: number;
  chainsExecuted: number;
  signalLogs: Array<{
    event_id: string;
    rule_id: string;
    vector: string;
    weight_applied: number;
    resulting_score: number;
    signal_category: string;
    chain_depth: number;
  }>;
}

// ─── Scoring Engine ──────────────────────────────────────────────────────────

/**
 * Process a single event through the scoring pipeline.
 */
async function processEvent(event: BIScoringEvent): Promise<ScoringResult | null> {
  const { org_id, entity_type, entity_id, event_type, payload, environmental } = event;

  // Get compiled rule index for this org
  const index = getOrCreateIndex(org_id);
  if (index.size === 0) return null; // No rules compiled yet

  // Build evaluation context
  const context: EvalContext = {
    vectors: {}, // Will be populated if needed by parametric rules
    entity: { type: entity_type, id: entity_id },
    event: { type: event_type, ...payload, source: event.source, signal_category: event.signal_category },
    environmental: environmental || {},
    temporal: {}, // Populated from cached temporal metrics if available
  };

  // Find matching rules
  const eventForMatching = {
    event_type,
    entity_type,
    page: payload?.page,
    pageState: payload?.pageState || payload?.page_state,
    card: payload?.card,
    elementType: payload?.elementType || payload?.element_type,
    elementId: payload?.elementId || payload?.element_id,
    activity: payload?.activity || event_type,
    source: event.source,
  };

  const matches = index.findMatches(eventForMatching, context);
  if (matches.length === 0) return null;

  // Collect all score updates (including from chains)
  const allUpdates: ScoreUpdate[] = [];
  const signalLogs: ScoringResult["signalLogs"] = [];
  let chainsExecuted = 0;

  // Process matches and chains
  for (const match of matches) {
    const updates = processMatch(match, event, context, index, 0);
    allUpdates.push(...updates.scoreUpdates);
    signalLogs.push(...updates.signals.map(s => ({ ...s, event_id: event.event_id })));
    chainsExecuted += updates.chainsExecuted;
  }

  if (allUpdates.length === 0) return null;

  // Apply all score updates atomically
  const updatedVectors = await biScoreState.applyScoreUpdates(org_id, entity_type, entity_id, allUpdates);

  // Update event window (for path matching)
  await biScoreState.pushToWindow(org_id, entity_type, entity_id, {
    event_type,
    timestamp: event.timestamp,
    metadata: { source: event.source, signal_category: event.signal_category },
  });

  // Emit score_changed event for real-time subscribers
  eventStream.publish("bi.score_changed", {
    orgId: org_id,
    entityType: entity_type,
    entityId: entity_id,
    updatedVectors,
    eventType: event_type,
  }, { organizationId: org_id, subject: `bi:${entity_type}:${entity_id}` }, "behavioral-intelligence").catch(() => {});

  return {
    entityType: entity_type,
    entityId: entity_id,
    updatedVectors,
    rulesMatched: matches.length,
    chainsExecuted,
    signalLogs,
  };
}

/**
 * Process a single rule match, including chain execution.
 */
function processMatch(
  match: RuleMatch,
  event: BIScoringEvent,
  context: EvalContext,
  index: ReturnType<typeof getOrCreateIndex>,
  depth: number
): { scoreUpdates: ScoreUpdate[]; signals: Array<Omit<ScoringResult["signalLogs"][0], "event_id">>; chainsExecuted: number } {
  const scoreUpdates: ScoreUpdate[] = [];
  const signals: Array<Omit<ScoringResult["signalLogs"][0], "event_id">> = [];
  let chainsExecuted = 0;

  // Apply weights from this rule
  for (const w of match.weights) {
    if (w.weight === 0) continue; // Skip zero-weight updates

    scoreUpdates.push({
      vector: w.vector,
      weight: w.weight,
      operation: w.operation,
      source: match.rule.definition.signal_category,
    });

    signals.push({
      rule_id: match.rule.definition.id,
      vector: w.vector,
      weight_applied: w.weight,
      resulting_score: 0, // Will be filled after atomic update
      signal_category: match.rule.definition.signal_category,
      chain_depth: depth,
    });
  }

  // Execute chains (if any and within depth limit)
  if (match.chainTargets && match.chainTargets.length > 0 && depth < MAX_CHAIN_DEPTH) {
    for (const chainTarget of match.chainTargets) {
      // Check chain condition
      if (chainTarget.condition_expression) {
        try {
          const condResult = evaluate(chainTarget.condition_expression, { ...context, upstream: match.weights });
          if (!condResult) continue; // Condition not met — skip this chain target
        } catch { continue; }
      }

      // Resolve the chained rule
      const chainedRule = index.getRuleById(chainTarget.rule_id);
      if (!chainedRule) continue;

      // Build a synthetic match for the chained rule
      const chainContext: EvalContext = {
        ...context,
        upstream: { weights: match.weights, rule_id: match.rule.definition.id },
      };

      // Evaluate the chained rule's weights
      const chainWeights = chainedRule.definition.vectors.map(v => {
        let weight: number;
        try {
          weight = Number(evaluate(v.weight_expression, chainContext)) || 0;
        } catch { weight = parseFloat(v.weight_expression) || 0; }
        return { vector: v.vector_name, weight, operation: v.operation };
      });

      const chainMatch: RuleMatch = { rule: chainedRule, weights: chainWeights, chainTargets: chainedRule.definition.chain };
      const chainResult = processMatch(chainMatch, event, chainContext, index, depth + 1);

      scoreUpdates.push(...chainResult.scoreUpdates);
      signals.push(...chainResult.signals);
      chainsExecuted += 1 + chainResult.chainsExecuted;
    }
  }

  return { scoreUpdates, signals, chainsExecuted };
}

// ─── Consumer Loop ───────────────────────────────────────────────────────────

let isRunning = false;
const activeOrgs = new Set<number>();

/**
 * Start the scoring engine consumer for a specific org.
 * Reads from the org's event stream and processes events.
 */
async function startConsumer(orgId: number): Promise<void> {
  if (activeOrgs.has(orgId)) return;
  activeOrgs.add(orgId);

  // Ensure consumer groups exist
  await biRedisStreams.ensureConsumerGroups(orgId);

  logger.info(`[ScoringEngine] Started consumer for org ${orgId}`);

  // Consumer loop
  while (activeOrgs.has(orgId)) {
    try {
      const entries = await biRedisStreams.readEvents(orgId, CONSUMER_ID, BATCH_SIZE, BLOCK_MS);
      if (entries.length === 0) continue;

      const processedIds: string[] = [];

      for (const { id, event } of entries) {
        try {
          await processEvent(event);
          processedIds.push(id);
        } catch (err: any) {
          logger.error(`[ScoringEngine] Failed to process event ${id} for org ${orgId}: ${err.message}`);
          // TODO: Move to dead letter queue
          processedIds.push(id); // Acknowledge to prevent reprocessing loop
        }
      }

      // Acknowledge processed events
      if (processedIds.length > 0) {
        await biRedisStreams.acknowledgeEvents(orgId, processedIds);
      }
    } catch (err: any) {
      logger.error(`[ScoringEngine] Consumer error for org ${orgId}: ${err.message}`);
      await new Promise(r => setTimeout(r, 5000)); // Back off on error
    }
  }

  logger.info(`[ScoringEngine] Stopped consumer for org ${orgId}`);
}

/**
 * Stop the consumer for a specific org.
 */
function stopConsumer(orgId: number): void {
  activeOrgs.delete(orgId);
}

/**
 * Stop all consumers.
 */
function stopAll(): void {
  activeOrgs.clear();
}

/**
 * Get list of orgs with active consumers.
 */
function getActiveOrgs(): number[] {
  return [...activeOrgs];
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biScoringEngine = {
  processEvent,
  startConsumer,
  stopConsumer,
  stopAll,
  getActiveOrgs,
};
