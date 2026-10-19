/**
 * World Model Bridge Service
 * Formats state-transition events from causal graph mapping and emits them
 * to the prediction intelligence domain via Redis Streams.
 *
 * Responsibilities:
 * - Emit state-transition events as canonical events compatible with prediction intelligence
 * - Format events for L2/L3 world model environment variable updates
 * - Push to Redis Streams ingestion queue for prediction intelligence domain
 * - Handle dead-letter events when schema validation or queue timeout (>10s) occurs
 * - Maintain rolling window of recent 1000 state-transition events per org
 * - Run counterfactual simulations with synthetic events (read-only, no production writes)
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */

import { db } from "@server/database_service.js";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import {
  stateTransitionEvents,
  type EventPrimitive,
  type CausalGraphLink,
  type StateTransitionEvent,
} from "@shared/schema/index.js";
import { graphNodes } from "@shared/schema/prediction/graph.js";
import { v4 as uuidv4 } from "uuid";
import { causalGraphService } from "./causal-graph.service.js";
import { enqueueKafkaEvent } from "@domain/core/infrastructure/kafka-outbox.service.js";
import { SPATIAL_EVENT_TOPICS } from "@shared/contracts/spatial-events.js";

const logger = createLogger("WorldModelBridgeService");

// ============================================================================
// CONSTANTS
// ============================================================================

/** Redis Stream key for prediction intelligence ingestion */
const PREDICTION_INGESTION_STREAM = "prediction:ingestion:state-transitions";

/** Maximum time allowed for pushing to Redis stream before dead-letter */
const QUEUE_TIMEOUT_MS = 10_000;

/** Maximum time allowed for counterfactual simulation (30 seconds) */
const COUNTERFACTUAL_TIMEOUT_MS = 30_000;

/** Maximum recent transitions returned per org */
const MAX_RECENT_TRANSITIONS = 1000;

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Counterfactual simulation result returned by runCounterfactual().
 * Contains predicted state changes, affected entity count, and adjusted
 * probability distributions from processing a synthetic event through
 * the full pipeline without production persistence.
 */
export interface CounterfactualResult {
  syntheticEventId: string;
  predictedStateChanges: Record<string, any>;
  affectedEntityCount: number;
  adjustedDistributions: Record<string, number>;
  simulationDurationMs: number;
}

/**
 * Internal representation of a formatted state-transition event
 * before database persistence.
 */
interface FormattedStateTransition {
  id: string;
  eventPrimitiveId: string;
  affectedEntities: CausalGraphLink[];
  impactHorizons: Record<string, { min: number; max: number; confidence: number }>;
  environmentVariables: Record<string, any>;
  timestamp: string;
  organizationId: number;
}

// ============================================================================
// SERVICE
// ============================================================================

export class WorldModelBridgeService {
  /**
   * Emit a state-transition event to the world model ingestion queue.
   * Formats the event, persists it to the database, and pushes to Redis Streams.
   * If the Redis push fails (timeout >10s or schema error), routes to dead-letter.
   *
   * Requirements: 16.1, 16.2
   */
  async emitStateTransition(
    event: EventPrimitive,
    links: CausalGraphLink[]
  ): Promise<StateTransitionEvent> {
    const formatted = await this.formatForWorldModel(event, links);

    // The transition and its Kafka outbox record commit atomically. Kafka is
    // the durable integration path; Redis is retained as a best-effort bridge.
    const inserted = await db.transaction(async tx => {
      const [transition] = await tx.insert(stateTransitionEvents).values({
        organizationId: event.organizationId,
        eventPrimitiveId: event.id,
        affectedEntities: links as any,
        impactHorizons: formatted.impactHorizons as any,
        environmentVariables: formatted.environmentVariables as any,
        status: "accepted",
      }).returning();
      await enqueueKafkaEvent(tx, {
          eventId: transition.id,
          eventType: SPATIAL_EVENT_TOPICS.assessment,
          // A world-model projection, not a measured fact -- which is what makes
          // it diffable against a later outcome to produce a 'surprise'.
          type: 'prediction',
          schemaVersion: 1,
          occurredAt: new Date().toISOString(),
          organizationId: event.organizationId,
          producer: "signal-intelligence",
          correlationId: event.id,
          causationId: event.id,
          subject: `signal:${event.id}`,
          payload: {
            signalId: event.id,
            assessmentId: transition.id,
            blastRadius: links.reduce((total, link) => total + link.blastRadius, 0),
            entityRefs: links.map(link => ({ type: link.targetEntityType, id: link.targetEntityId })),
            recommendedActionTypes: [],
          },
        }, String(event.organizationId));
      return transition;
    });

    logger.info(`State transition accepted: eventPrimitive=${event.id}, transition=${inserted.id}`);

    try {
      await this.pushToRedisStream(formatted, inserted.id);
    } catch (redisError) {
      logger.warn(`Redis bridge failed for transition ${inserted.id}; Kafka outbox remains authoritative`, {
        error: redisError instanceof Error ? redisError.message : String(redisError),
      });
    }

    try {
      const { cycleSignalSubscriptionService } = await import("./cycle-signal-subscription.service.js");
      await cycleSignalSubscriptionService.deliver(event, inserted, links);
    } catch (deliveryError) {
      logger.error(`Cycle signal delivery failed for transition ${inserted.id}`, deliveryError);
    }

    // Same signal, second target: workflow signal subscriptions start a run of
    // the bound workflow's active deployment. Contained the same way — a
    // failing subscription must not roll back the committed transition.
    try {
      const { workflowSignalSubscriptionService } = await import("./workflow-signal-subscription.service.js");
      await workflowSignalSubscriptionService.deliver(event, inserted, links);
    } catch (workflowDeliveryError) {
      logger.error(`Workflow signal delivery failed for transition ${inserted.id}`, workflowDeliveryError);
    }

    // Autonomy policies are evaluated from here for the same reason cycle
    // delivery is: this is the one place every ingest path converges on, whether
    // the signal arrived from a feed poll, the Kafka consumer or an operator
    // injection.
    //
    // Until now nothing called `evaluateEvent`, so policies could be authored
    // through the API but were never matched against a signal — and because
    // `logExecution` is what produces the outcome observation, the entire
    // prediction-error loop had no in-process producer either. The Kafka
    // consumer also reaches `evaluateOutcome`, but KAFKA_ENABLED defaults to
    // false, so on default configuration the loop was dark end to end.
    //
    // Failure is contained exactly as delivery failure is: the transition is
    // already committed and is a valid world-model update on its own. An
    // autonomy policy that throws must not roll back the state change that
    // justified it.
    try {
      const { autonomousActionService } = await import("./autonomous-action.service.js");
      await autonomousActionService.evaluateEvent(event, links);
    } catch (autonomyError) {
      logger.error(`Autonomous action evaluation failed for event ${event.id}`, autonomyError);
    }

    return inserted;
  }

  /**
   * Format an EventPrimitive and its CausalGraphLinks into a StateTransitionEvent
   * compatible with L2/L3 world model environment variable updates.
   *
   * The environment variables are structured as:
   * - `signal.event_type`: The event type identifier
   * - `signal.severity`: Severity level for weighting
   * - `signal.confidence`: Original confidence score
   * - `signal.jurisdiction`: Affected jurisdiction
   * - `signal.target_sector`: Affected sector
   * - `signal.blast_radius`: Total blast radius from all links
   * - `signal.affected_entity_count`: Number of directly affected entities
   * - `signal.impact_horizon_min_days`: Minimum impact horizon across all links
   * - `signal.impact_horizon_max_days`: Maximum impact horizon across all links
   * - `entities.<entityId>.impact_confidence`: Per-entity impact confidence
   * - `entities.<entityId>.horizon_min`: Per-entity min horizon
   * - `entities.<entityId>.horizon_max`: Per-entity max horizon
   *
   * Requirements: 16.2
   */
  async formatForWorldModel(
    event: EventPrimitive,
    links: CausalGraphLink[]
  ): Promise<FormattedStateTransition> {
    // Build impact horizons map: keyed by entity ID
    const impactHorizons: Record<
      string,
      { min: number; max: number; confidence: number }
    > = {};

    for (const link of links) {
      impactHorizons[link.targetEntityId] = {
        min: link.impactHorizonMinDays,
        max: link.impactHorizonMaxDays,
        confidence: link.impactConfidence,
      };
    }

    // Compute aggregate metrics for environment variables
    const totalBlastRadius = links.reduce(
      (sum, l) => sum + l.blastRadius,
      0
    );
    const minHorizon =
      links.length > 0
        ? Math.min(...links.map((l) => l.impactHorizonMinDays))
        : 0;
    const maxHorizon =
      links.length > 0
        ? Math.max(...links.map((l) => l.impactHorizonMaxDays))
        : 0;

    // Build L2/L3 world model environment variables
    const environmentVariables: Record<string, any> = {
      "signal.event_type": event.eventType,
      "signal.severity": event.severity,
      "signal.confidence": event.confidenceScore,
      "signal.jurisdiction": event.jurisdiction,
      "signal.target_sector": event.targetSector,
      "signal.blast_radius": totalBlastRadius,
      "signal.affected_entity_count": links.length,
      "signal.impact_horizon_min_days": minHorizon,
      "signal.impact_horizon_max_days": maxHorizon,
    };

    // Per-entity environment variable entries
    for (const link of links) {
      const prefix = `entities.${link.targetEntityId}`;
      environmentVariables[`${prefix}.type`] = link.targetEntityType;
      environmentVariables[`${prefix}.impact_confidence`] =
        link.impactConfidence;
      environmentVariables[`${prefix}.horizon_min`] =
        link.impactHorizonMinDays;
      environmentVariables[`${prefix}.horizon_max`] =
        link.impactHorizonMaxDays;
      environmentVariables[`${prefix}.blast_radius`] = link.blastRadius;
      environmentVariables[`${prefix}.depth`] = link.depth;
    }

    return {
      id: uuidv4(),
      eventPrimitiveId: event.id,
      affectedEntities: links,
      impactHorizons,
      environmentVariables,
      timestamp: new Date().toISOString(),
      organizationId: event.organizationId,
    };
  }

  /**
   * Run a counterfactual simulation with a synthetic EventPrimitive.
   * Processes the event through the full Causal_Graph + World Model pipeline
   * WITHOUT persisting any changes to production tables (no db.insert).
   *
   * Steps:
   * 1. Compute impact horizon based on severity (read-only)
   * 2. Find matching business assets via graphNodes query (read-only)
   * 3. Compute blast radius for each matched asset (read-only BFS)
   * 4. Build simulated CausalGraphLinks in memory (no DB writes)
   * 5. Format for world model to get environment variables
   * 6. Return predicted state changes, affected entity count, and adjusted distributions
   *
   * Enforces a 30-second timeout.
   *
   * Requirements: 16.4, 16.5
   */
  async runCounterfactual(
    syntheticEvent: EventPrimitive
  ): Promise<CounterfactualResult> {
    const startTime = Date.now();

    const simulationPromise = this.executeCounterfactualSimulation(syntheticEvent, startTime);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Counterfactual simulation timeout: exceeded 30 seconds")),
        COUNTERFACTUAL_TIMEOUT_MS
      );
    });

    return Promise.race([simulationPromise, timeoutPromise]);
  }

  /**
   * Internal execution of counterfactual simulation (without timeout wrapper).
   * All operations are read-only — no production state is modified.
   */
  private async executeCounterfactualSimulation(
    syntheticEvent: EventPrimitive,
    startTime: number
  ): Promise<CounterfactualResult> {
    // Step 1: Compute impact horizon (read-only — uses severity lookup)
    const horizon = await causalGraphService.computeImpactHorizon(syntheticEvent);

    // Step 2: Find matching assets (read-only query against graphNodes)
    const matchingAssets = await this.findMatchingAssetsReadOnly(syntheticEvent);

    // Step 3: For each matched asset, compute blast radius (read-only BFS)
    // and build simulated CausalGraphLinks in memory (NO db.insert)
    const simulatedLinks: CausalGraphLink[] = [];

    for (const asset of matchingAssets) {
      const blastRadius = await causalGraphService.computeBlastRadius(asset.entityId);

      // Build an in-memory CausalGraphLink (not persisted)
      const simulatedLink: CausalGraphLink = {
        id: uuidv4(),
        organizationId: syntheticEvent.organizationId,
        eventPrimitiveId: syntheticEvent.id,
        targetEntityType: asset.entityType,
        targetEntityId: asset.entityId,
        impactHorizonMinDays: horizon.min,
        impactHorizonMaxDays: horizon.max,
        impactConfidence: Math.round(syntheticEvent.confidenceScore * 100),
        blastRadius,
        depth: 1,
        createdAt: new Date(),
      };

      simulatedLinks.push(simulatedLink);
    }

    // Step 4: Format for world model (produces environment variable updates)
    const formatted = await this.formatForWorldModel(syntheticEvent, simulatedLinks);

    // Step 5: Compute adjusted distributions based on severity and confidence
    const adjustedDistributions = this.computeAdjustedDistributions(
      syntheticEvent,
      simulatedLinks
    );

    // Step 6: Build predicted state changes
    const predictedStateChanges: Record<string, any> = {
      environmentVariables: formatted.environmentVariables,
      impactHorizons: formatted.impactHorizons,
      affectedEntities: simulatedLinks.map((link) => ({
        entityId: link.targetEntityId,
        entityType: link.targetEntityType,
        impactHorizonMinDays: link.impactHorizonMinDays,
        impactHorizonMaxDays: link.impactHorizonMaxDays,
        impactConfidence: link.impactConfidence,
        blastRadius: link.blastRadius,
      })),
    };

    const simulationDurationMs = Date.now() - startTime;

    logger.info(
      `Counterfactual simulation completed for synthetic event ${syntheticEvent.id}: ` +
        `${simulatedLinks.length} affected entities, duration=${simulationDurationMs}ms`
    );

    return {
      syntheticEventId: syntheticEvent.id,
      predictedStateChanges,
      affectedEntityCount: simulatedLinks.length,
      adjustedDistributions,
      simulationDurationMs,
    };
  }

  /**
   * Find matching business assets for a synthetic event (read-only).
   * Replicates the matching logic from CausalGraphService.findMatchingAssets
   * without any write operations.
   */
  private async findMatchingAssetsReadOnly(
    event: EventPrimitive
  ): Promise<Array<{ entityId: string; entityType: string }>> {
    const matchingNodes = await db
      .select({
        refId: graphNodes.refId,
        type: graphNodes.type,
      })
      .from(graphNodes)
      .where(
        and(
          inArray(graphNodes.type, [
            "cycle",
            "mission",
            "workstream",
            "supplier",
            "geo_region",
          ]),
          sql`(
            ${graphNodes.properties}::jsonb->'sectorTags' ? ${event.targetSector}
            OR
            ${graphNodes.properties}::jsonb->'operatingRegions' ? ${event.jurisdiction}
          )`
        )
      );

    return matchingNodes.map((node) => ({
      entityId: node.refId,
      entityType: node.type,
    }));
  }

  /**
   * Compute adjusted probability distributions based on the synthetic event's
   * severity and confidence, weighted by the number of affected entities.
   * Returns a map of distribution keys to adjusted weight values.
   */
  private computeAdjustedDistributions(
    event: EventPrimitive,
    links: CausalGraphLink[]
  ): Record<string, number> {
    // Severity weight factors for distribution adjustment
    const severityWeights: Record<string, number> = {
      Critical: 0.9,
      High: 0.7,
      Medium: 0.4,
      Low: 0.2,
    };

    const severityWeight = severityWeights[event.severity] ?? 0.2;
    const confidenceWeight = event.confidenceScore;
    const combinedWeight = severityWeight * confidenceWeight;

    const distributions: Record<string, number> = {
      "risk.overall_adjustment": combinedWeight,
      "risk.sector_exposure": links.length > 0 ? combinedWeight * 1.2 : 0,
      "risk.temporal_urgency": severityWeight,
      "confidence.signal_strength": confidenceWeight,
      "impact.entity_coverage": links.length > 0 ? links.length / Math.max(links.length, 10) : 0,
      "impact.blast_radius_normalized": links.length > 0
        ? Math.min(
            links.reduce((sum, l) => sum + l.blastRadius, 0) / 100,
            1.0
          )
        : 0,
    };

    return distributions;
  }

  /**
   * Get the most recent state-transition events for an organization.
   * Returns at most 1000 entries ordered by createdAt descending.
   *
   * Requirements: 16.6
   */
  async getRecentTransitions(
    orgId: number,
    limit: number = MAX_RECENT_TRANSITIONS
  ): Promise<StateTransitionEvent[]> {
    const effectiveLimit = Math.min(limit, MAX_RECENT_TRANSITIONS);

    const results = await db
      .select()
      .from(stateTransitionEvents)
      .where(eq(stateTransitionEvents.organizationId, orgId))
      .orderBy(desc(stateTransitionEvents.createdAt))
      .limit(effectiveLimit);

    return results;
  }

  /**
   * Handle a failed state-transition event by marking it as dead-letter.
   * Called when schema validation fails or queue push times out (>10s).
   *
   * Requirements: 16.7
   */
  async handleDeadLetter(
    failedEvent: StateTransitionEvent,
    reason: string
  ): Promise<void> {
    await db
      .update(stateTransitionEvents)
      .set({
        status: "dead_letter",
        failureReason: reason,
      })
      .where(eq(stateTransitionEvents.id, failedEvent.id));

    logger.warn(
      `State transition ${failedEvent.id} moved to dead-letter: ${reason}`
    );
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Push the formatted state-transition event to the prediction intelligence
   * Redis Streams ingestion queue via XADD.
   * Enforces a 10-second timeout — if exceeded, throws to trigger dead-letter.
   */
  private async pushToRedisStream(
    formatted: FormattedStateTransition,
    dbId: string
  ): Promise<void> {
    const { redis } = await import(
      "@domain/core/infrastructure/redis/redis-client.js"
    );

    const payload = JSON.stringify({
      id: dbId,
      eventPrimitiveId: formatted.eventPrimitiveId,
      affectedEntities: formatted.affectedEntities,
      impactHorizons: formatted.impactHorizons,
      environmentVariables: formatted.environmentVariables,
      timestamp: formatted.timestamp,
      organizationId: formatted.organizationId,
    });

    // Race between the XADD and a timeout
    const xaddPromise = redis.xadd(
      PREDICTION_INGESTION_STREAM,
      "MAXLEN",
      "~",
      "10000",
      "*",
      "payload",
      payload,
      "orgId",
      String(formatted.organizationId),
      "eventPrimitiveId",
      formatted.eventPrimitiveId
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Queue timeout exceeded 10 seconds")),
        QUEUE_TIMEOUT_MS
      );
    });

    await Promise.race([xaddPromise, timeoutPromise]);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const worldModelBridgeService = new WorldModelBridgeService();
