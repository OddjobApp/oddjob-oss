/**
 * Surprise — prediction error as a first-class event.
 *
 * The world model emits a `prediction` when it assesses a signal, and an
 * `observation` when the resulting action reports back. Until now nothing
 * compared them, so the system could be wrong repeatedly and never notice: the
 * primitive that is supposed to drive replanning had no producer.
 *
 * This closes that loop. Prediction and outcome already share a `correlationId`
 * — the event-primitive id — so the pairing needs no new plumbing, and the
 * prediction itself is recoverable from `state_transition_events` rather than by
 * querying the event log.
 *
 * The comparison is a pure function, deliberately: what counts as surprising is
 * a judgement that will be tuned, and tuning it should not require a broker, a
 * database, or a replayed stream to test.
 */

import { createHash, randomUUID } from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { stateTransitionEvents } from '@shared/schema/index.js';
import {
  SPATIAL_EVENT_TOPICS,
  type SpatialEventEnvelope,
  type SpatialOutcomeRecorded,
} from '@shared/contracts/spatial-events.js';
import { enqueueKafkaEvent } from '@domain/core/infrastructure/kafka-outbox.service.js';
import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('SpatialSurprise');

/** Fractional error above which a numeric divergence is worth reporting. */
const DEFAULT_THRESHOLD = 0.25;

/**
 * A stable event id for the surprise raised by a given observation.
 *
 * Evaluation runs from two places — the Kafka consumer, and directly at the
 * point an outcome is produced so the loop still closes with the broker off.
 * Deriving the id from the observation makes the second enqueue a no-op against
 * the outbox's unique event_id, so the two callers cannot double-publish.
 */
export function surpriseEventId(observationEventId: string): string {
  const hash = createHash('sha256').update(`spatial.surprise:${observationEventId}`).digest('hex');
  // Shape the digest as a v5-style UUID; the envelope requires a uuid, and the
  // value only has to be stable and collision-free, not random.
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    ((parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

export interface PredictionSide {
  eventId: string;
  blastRadius: number;
  /** A prediction that drove an action implies that action was expected to work. */
  expectedOutcome?: 'succeeded';
}

export interface ObservationSide {
  eventId: string;
  outcome: 'succeeded' | 'failed' | 'cancelled';
  metrics?: Record<string, number>;
  actionId?: string;
  signalId?: string;
}

export interface SurpriseAssessment {
  dimension: 'outcome' | 'blastRadius';
  predicted: number | string;
  observed: number | string;
  error: number;
  threshold: number;
  summary: string;
}

/**
 * Compares an observation against the prediction that preceded it.
 *
 * Returns null when the outcome is unremarkable — the common case, and the
 * reason this is a filter rather than a transform: emitting an event per outcome
 * would drown the very signal it is meant to raise.
 *
 * Outcome polarity is checked first and dominates. A failed action is
 * categorically surprising regardless of how close the magnitude was; reporting
 * a 4% blast-radius error on an action that did not happen would be noise.
 */
export function computeSurprise(
  prediction: PredictionSide,
  observation: ObservationSide,
  threshold: number = DEFAULT_THRESHOLD,
): SurpriseAssessment | null {
  const expected = prediction.expectedOutcome ?? 'succeeded';

  if (observation.outcome !== expected) {
    return {
      dimension: 'outcome',
      predicted: expected,
      observed: observation.outcome,
      // Categorical: the prediction was not close, it was wrong.
      error: 1,
      threshold,
      summary: `Expected the action to have ${expected}; it ${observation.outcome}.`,
    };
  }

  const observedRadius = observation.metrics?.blastRadius;
  if (typeof observedRadius === 'number' && Number.isFinite(observedRadius)) {
    // Normalised against the larger side so an under- and over-prediction of the
    // same ratio score alike, and a predicted 0 cannot divide by zero.
    const scale = Math.max(prediction.blastRadius, observedRadius, 1);
    const error = Math.abs(prediction.blastRadius - observedRadius) / scale;

    if (error > threshold) {
      return {
        dimension: 'blastRadius',
        predicted: prediction.blastRadius,
        observed: observedRadius,
        error: Math.min(error, 1),
        threshold,
        summary: `Predicted blast radius ${prediction.blastRadius}, observed ${observedRadius}.`,
      };
    }
  }

  return null;
}

export class SpatialSurpriseService {
  private threshold(): number {
    const raw = Number(process.env.SPATIAL_SURPRISE_THRESHOLD);
    return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_THRESHOLD;
  }

  /**
   * Called for every outcome observation. Finds the prediction that shares its
   * correlation, compares them, and emits a `surprise` when they disagree.
   *
   * Never throws into the consumer: an outcome is still a valid outcome even if
   * the comparison cannot be made, and failing here would dead-letter a message
   * that was handled perfectly well.
   */
  async evaluateOutcome(event: SpatialOutcomeRecorded): Promise<SurpriseAssessment | null> {
    try {
      // The prediction lives in the transition row the assessment was built
      // from. correlationId is the event-primitive id both sides were derived
      // from, which is what makes them pairable without searching the log.
      const [transition] = await db
        .select()
        .from(stateTransitionEvents)
        .where(eq(stateTransitionEvents.eventPrimitiveId, event.correlationId))
        .orderBy(desc(stateTransitionEvents.createdAt))
        .limit(1);

      if (!transition) {
        logger.debug(`No prediction for correlation ${event.correlationId}; nothing to compare`);
        return null;
      }

      const links = Array.isArray(transition.affectedEntities) ? transition.affectedEntities : [];
      const blastRadius = links.reduce(
        (total: number, link: any) => total + (Number(link?.blastRadius) || 0),
        0,
      );

      const assessment = computeSurprise(
        { eventId: transition.id, blastRadius },
        {
          eventId: event.eventId,
          outcome: event.payload.outcome,
          metrics: event.payload.metrics,
          actionId: event.payload.actionId,
          signalId: event.payload.signalId,
        },
        this.threshold(),
      );

      if (!assessment) return null;

      await enqueueKafkaEvent(db, {
        eventId: surpriseEventId(event.eventId),
        eventType: SPATIAL_EVENT_TOPICS.assessment,
        type: 'surprise',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        organizationId: event.organizationId,
        producer: 'signal-intelligence',
        // Same correlation as both sides, so the prediction, the outcome and the
        // surprise read as one flow; caused by the observation that revealed it.
        correlationId: event.correlationId,
        causationId: event.eventId,
        subject: `signal:${transition.eventPrimitiveId}`,
        confidenceScore: assessment.error,
        payload: {
          predictionEventId: transition.id,
          observationEventId: event.eventId,
          signalId: event.payload.signalId,
          actionId: event.payload.actionId,
          dimension: assessment.dimension,
          predicted: assessment.predicted,
          observed: assessment.observed,
          error: assessment.error,
          threshold: assessment.threshold,
          summary: assessment.summary,
        },
      } as SpatialEventEnvelope<string, Record<string, unknown>>);

      // Emitting the event is not the point — something has to act on it. This
      // routes the prediction error back through cycle delivery, which is what
      // actually turns a surprise into replanning.
      const { cycleSignalSubscriptionService } = await import('./cycle-signal-subscription.service.js');
      const delivered = await cycleSignalSubscriptionService.deliverSurprise({
        organizationId: event.organizationId,
        correlationId: event.correlationId,
        surprise: {
          predictionEventId: transition.id,
          observationEventId: event.eventId,
          dimension: assessment.dimension,
          predicted: assessment.predicted,
          observed: assessment.observed,
          error: assessment.error,
          threshold: assessment.threshold,
          summary: assessment.summary,
        },
      });

      logger.info(
        `Surprise on ${assessment.dimension} for correlation ${event.correlationId}: ` +
        `predicted ${assessment.predicted}, observed ${assessment.observed} ` +
        `(error ${assessment.error.toFixed(2)}); delivered to ${delivered} subscription(s)`,
      );
      return assessment;
    } catch (error) {
      logger.warn(
        `Surprise evaluation failed for ${event.eventId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}

export const spatialSurpriseService = new SpatialSurpriseService();
