import { createHash, randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { eventPrimitives } from '@shared/schema/index.js';
import {
  SPATIAL_EVENT_TOPICS,
  parseSpatialEventDetailed,
  type SpatialEventEnvelope,
  type SpatialActionRequested,
  type SpatialOutcomeRecorded,
  type SpatialSignalObserved,
} from '@shared/contracts/spatial-events.js';
import { enqueueKafkaEvent } from '@domain/core/infrastructure/kafka-outbox.service.js';
import { idempotentKafkaConsumer } from '@domain/core/infrastructure/kafka-consumer.service.js';
import { eventStream } from '@domain/core/infrastructure/event-stream.service.js';
import { causalGraphService } from './causal-graph.service.js';
import { worldModelBridgeService } from './world-model-bridge.service.js';
import { spatialSurpriseService } from './spatial-surprise.service.js';
import { cycleSignalSubscriptionService } from './cycle-signal-subscription.service.js';
import { spatialTelemetryResolver } from './spatial-telemetry-resolver.service.js';
import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('SpatialKafka');

type SignalInput = SpatialSignalObserved['payload'];
type DatabaseWriter = { insert: (...args: any[]) => any };

export async function enqueueSpatialSignal(
  organizationId: number,
  input: SignalInput,
  options: { correlationId?: string; causationId?: string; producer?: string } = {},
): Promise<string> {
  const eventId = randomUUID();
  const event: SpatialSignalObserved = {
    eventId,
    eventType: SPATIAL_EVENT_TOPICS.signal,
    type: 'observation',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    organizationId,
    producer: options.producer || 'oddjob-api',
    correlationId: options.correlationId || eventId,
    causationId: options.causationId,
    subject: `signal:${input.signalId}`,
    payload: input,
  };
  await enqueueKafkaEvent(db, event as SpatialEventEnvelope<string, Record<string, unknown>>);
  return eventId;
}

export async function enqueueSpatialAction(
  writer: DatabaseWriter,
  organizationId: number,
  payload: SpatialActionRequested['payload'],
  correlationId: string,
  producer = 'signal-intelligence',
): Promise<string> {
  const eventId = randomUUID();
  await enqueueKafkaEvent(writer, {
    eventId,
    eventType: SPATIAL_EVENT_TOPICS.action,
    type: 'intent',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    organizationId,
    producer,
    correlationId,
    subject: `action:${payload.actionId}`,
    payload,
  });
  return eventId;
}

export async function enqueueSpatialOutcome(
  writer: DatabaseWriter,
  organizationId: number,
  payload: SpatialOutcomeRecorded['payload'],
  correlationId: string,
  causationId?: string,
  producer = 'signal-intelligence',
): Promise<string> {
  const eventId = randomUUID();
  await enqueueKafkaEvent(writer, {
    eventId,
    eventType: SPATIAL_EVENT_TOPICS.action,
    type: 'observation',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    organizationId,
    producer,
    correlationId,
    causationId,
    subject: `action:${payload.actionId}`,
    payload,
  });
  return eventId;
}

export class SpatialKafkaConsumers {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const groupId = process.env.KAFKA_SPATIAL_GROUP_ID || 'oddjob-spatial-v1';
    const topics = [
      SPATIAL_EVENT_TOPICS.signal,
      SPATIAL_EVENT_TOPICS.assessment,
      SPATIAL_EVENT_TOPICS.action,
    ];
    await idempotentKafkaConsumer.subscribe(topics, groupId, async rawEvent => {
      const { envelope, kind, payloadValidated } = parseSpatialEventDetailed(rawEvent);

      // An unregistered (eventType, type) pair means a stream this deployment
      // does not know yet. Skip it rather than let it fail: the parse is open by
      // design, so an unknown primitive must not become a dead letter simply
      // because this consumer is older than the producer.
      if (!payloadValidated) {
        logger.warn(
          `Skipping unrecognised event ${envelope.eventId} (${envelope.eventType}/${envelope.type ?? 'no type'})`,
        );
        return;
      }

      // Routing is on the (stream, kind) pair, not the stream alone: since the
      // cutover, spatial.action.v1 carries an intent and an outcome, and only
      // `kind` tells them apart. A stream name is no longer enough to know what
      // arrived.
      const route = `${envelope.eventType}:${kind}`;

      switch (route) {
        case `${SPATIAL_EVENT_TOPICS.signal}:observation`:
          await this.consumeSignal(envelope as SpatialSignalObserved);
          break;
        case `${SPATIAL_EVENT_TOPICS.action}:observation`:
          // An outcome is the second half of a prediction. Compare them before
          // bridging, so a divergence becomes a `surprise` event rather than
          // being noticed by nobody.
          await spatialSurpriseService.evaluateOutcome(envelope as SpatialOutcomeRecorded);
          await eventStream.publish(route, envelope.payload as Record<string, unknown>, {
            organizationId: envelope.organizationId,
            subject: envelope.subject,
            kafkaEventId: envelope.eventId,
            correlationId: envelope.correlationId,
          }, envelope.producer);
          break;
        case `${SPATIAL_EVENT_TOPICS.assessment}:prediction`:
          // Cycle delivery, reached from the durable stream rather than only the
          // in-process call world-model-bridge makes. That call is bound to the
          // instance that did the assessment; this one survives it. Running both
          // is safe — delivery is gated on an insert unique per (subscription,
          // event primitive), so the later arrival is a no-op.
          await cycleSignalSubscriptionService.deliverByCorrelation(
            envelope.organizationId,
            envelope.correlationId,
          );
          // Same idempotent pattern for workflow subscriptions: whichever path
          // arrives first wins the unique delivery row; failure is contained so
          // the Kafka handler still completes.
          try {
            const { workflowSignalSubscriptionService } = await import('./workflow-signal-subscription.service.js');
            await workflowSignalSubscriptionService.deliverByCorrelation(
              envelope.organizationId,
              envelope.correlationId,
            );
          } catch (workflowDeliveryError) {
            logger.error(
              `Workflow signal delivery failed for correlation ${envelope.correlationId}`,
              workflowDeliveryError,
            );
          }
          await eventStream.publish(route, envelope.payload as Record<string, unknown>, {
            organizationId: envelope.organizationId,
            subject: envelope.subject,
            kafkaEventId: envelope.eventId,
            correlationId: envelope.correlationId,
          }, envelope.producer);
          break;
        case `${SPATIAL_EVENT_TOPICS.assessment}:surprise`:
        case `${SPATIAL_EVENT_TOPICS.action}:intent`:
          // Bridged to the in-process event stream. The Redis event name keeps
          // the kind so subscribers there can still distinguish an intent from
          // an outcome now that both share a Kafka stream.
          await eventStream.publish(route, envelope.payload as Record<string, unknown>, {
            organizationId: envelope.organizationId,
            subject: envelope.subject,
            kafkaEventId: envelope.eventId,
            correlationId: envelope.correlationId,
          }, envelope.producer);
          break;
        default:
          // Previously fell through silently, so a subscribed topic with no case
          // was indistinguishable from one handled successfully.
          logger.warn(`No handler for ${route}; event ${envelope.eventId} ignored`);
      }
    });
  }

  private async consumeSignal(event: SpatialSignalObserved): Promise<void> {
    // Signals produced by this service have already traversed the local
    // assessment pipeline; consuming them again would create a feedback loop.
    if (event.producer === 'signal-intelligence') return;
    const payload = event.payload;
    const [existing] = await db.select().from(eventPrimitives)
      .where(eq(eventPrimitives.sourceEntryId, `kafka:${event.eventId}`)).limit(1);
    if (existing) return;

    const contentHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    // Kafka is the path most likely to carry real telemetry (AIS, GPS, sensor
    // feeds), so producer coordinates take precedence over any text match.
    const spatial = await spatialTelemetryResolver.resolve({
      organizationId: event.organizationId,
      text: payload.summary,
      jurisdiction: payload.jurisdiction,
      telemetry: {
        ...payload.telemetry,
        // Fall back to the signal id so successive observations of one entity
        // still chain into ENTER/EXIT transitions when no subject is declared.
        subjectId: payload.telemetry?.subjectId ?? payload.signalId ?? null,
      },
    });

    const [primitive] = await db.insert(eventPrimitives).values({
      organizationId: event.organizationId,
      sourceEntryId: `kafka:${event.eventId}`,
      eventType: payload.eventType,
      targetSector: payload.targetSector,
      jurisdiction: payload.jurisdiction,
      severity: payload.severity,
      sourceUrl: payload.sourceUrl || 'kafka://spatial.signal.observed.v1',
      extractionTimestamp: new Date(event.occurredAt),
      confidenceScore: payload.confidence,
      rawText: payload.summary || null,
      flags: ['kafka'],
      contentHash,
      ...spatial,
    }).returning();

    const links = await causalGraphService.mapEventToGraph(primitive);
    await worldModelBridgeService.emitStateTransition(primitive, links);
    logger.info(`Consumed Kafka signal ${event.eventId} as primitive ${primitive.id}`);
  }
}

export const spatialKafkaConsumers = new SpatialKafkaConsumers();
