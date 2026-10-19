import { and, eq, lt, or, sql } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { kafkaConsumedEvents } from '@shared/schema/index.js';
import { createLogger } from '@server/utils/logger.js';
import { randomUUID } from 'crypto';
import { SPATIAL_EVENT_TOPICS } from '@shared/contracts/spatial-events.js';
import {
  kafkaEventBus,
  type KafkaEnvelope,
  type KafkaEventHandler,
} from './kafka-event-bus.service.js';
import { enqueueKafkaEvent } from './kafka-outbox.service.js';

const logger = createLogger('KafkaConsumer');

/**
 * How long a row may sit in `processing` before another delivery may take it
 * over. Only reached when the previous owner died mid-retry, so it wants to be
 * comfortably longer than a normal handler run plus its retry backoff.
 */
const STALE_PROCESSING_MS = 60_000;

/**
 * Whether an event's own TTL has run out.
 *
 * Absent `ttlMs` means the event never expires, which is the default for
 * everything today. An unparseable `occurredAt` is treated as NOT expired: a bad
 * timestamp should surface through normal handling rather than make the event
 * silently disappear.
 */
export function hasExpired(event: KafkaEnvelope, now: number = Date.now()): boolean {
  if (!event.ttlMs) return false;
  const occurredAt = Date.parse(event.occurredAt);
  if (Number.isNaN(occurredAt)) return false;
  return now > occurredAt + event.ttlMs;
}

export class IdempotentKafkaConsumer {
  async subscribe(topics: string[], groupId: string, handler: KafkaEventHandler): Promise<void> {
    await kafkaEventBus.subscribe(topics, async (event, metadata) => {
      // Expiry is checked BEFORE claiming, so an event nobody can act on any
      // more costs one comparison instead of a row write plus a handler run.
      // Dropping is the correct outcome, not an error: a stale event is not a
      // failure, so it must not retry and must not dead-letter.
      if (hasExpired(event)) {
        logger.debug(
          `Dropping expired event ${event.eventId} (ttlMs=${event.ttlMs}, occurredAt=${event.occurredAt})`,
        );
        return;
      }

      const claim = await this.claim(event, groupId, metadata);
      if (!claim.process) return;
      const maxAttempts = Number(process.env.KAFKA_CONSUMER_MAX_ATTEMPTS || 5);

      for (let attempt = claim.attempts; attempt <= maxAttempts; attempt++) {
        try {
          await handler(event, metadata);
          await db.update(kafkaConsumedEvents).set({
            status: 'processed', processedAt: new Date(), lastError: null, attempts: attempt, updatedAt: new Date(),
          }).where(and(eq(kafkaConsumedEvents.consumerGroup, groupId), eq(kafkaConsumedEvents.eventId, event.eventId)));
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000);
          if (attempt < maxAttempts) {
            await db.update(kafkaConsumedEvents).set({ status: 'processing', attempts: attempt + 1, lastError: message, updatedAt: new Date() })
              .where(and(eq(kafkaConsumedEvents.consumerGroup, groupId), eq(kafkaConsumedEvents.eventId, event.eventId)));
            await new Promise(resolve => setTimeout(resolve, Math.min(2_000, 100 * 2 ** attempt)));
            continue;
          }
          // Dead letters go through the outbox rather than straight to the
          // broker, so they are durable and retried like any other event instead
          // of fire-and-forget, and so they get a sequenceNumber from the relay.
          //
          // The trade: dead-lettering now needs the database, so a Postgres
          // failure cannot dead-letter. The kafka_consumed_events row below still
          // holds the full payload in that case and /inbox/:id/replay recovers
          // it, so nothing is lost — only the DLQ topic misses it.
          //
          // Still swallowed rather than rethrown: escaping eachMessage would
          // leave the offset uncommitted and jam the partition on an event we
          // have already given up on.
          await enqueueKafkaEvent(db, {
            eventId: randomUUID(),
            eventType: SPATIAL_EVENT_TOPICS.fault,
            type: 'fault',
            schemaVersion: 1,
            occurredAt: new Date().toISOString(),
            organizationId: event.organizationId,
            producer: 'kafka-consumer',
            correlationId: event.correlationId,
            causationId: event.eventId,
            subject: event.subject,
            payload: { originalEvent: event, consumerGroup: groupId, error: message, metadata },
          }).catch(dlqError => logger.error(
            `Dead-letter publish failed for ${event.eventId}; row retained for replay`,
            dlqError,
          ));
          await db.update(kafkaConsumedEvents).set({ status: 'dead_letter', attempts: attempt, lastError: message, updatedAt: new Date() })
            .where(and(eq(kafkaConsumedEvents.consumerGroup, groupId), eq(kafkaConsumedEvents.eventId, event.eventId)));
          logger.error(`Event ${event.eventId} moved to Kafka dead letter after ${attempt} attempts`, { error: message });
          return;
        }
      }
    }, groupId, async (raw, metadata, parseError) => {
      // Bytes we could not parse still have to go somewhere before the offset
      // moves past them. There is no envelope to key on, so this never reaches
      // kafka_consumed_events — the outbox row is the only durable record of it.
      await enqueueKafkaEvent(db, {
        eventId: randomUUID(),
        eventType: SPATIAL_EVENT_TOPICS.fault,
        type: 'fault',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        organizationId: 0,
        producer: 'kafka-consumer',
        correlationId: randomUUID(),
        subject: `unparseable:${metadata.topic}:${metadata.partition}:${metadata.offset}`,
        payload: {
          consumerGroup: groupId,
          reason: 'unparseable-message',
          error: parseError instanceof Error ? parseError.message : String(parseError),
          metadata,
          rawBase64: raw.toString('base64').slice(0, 100_000),
        },
      });
    });
    logger.info(`Consumer ${groupId} subscribed to ${topics.join(', ')}`);
  }

  private async claim(
    event: KafkaEnvelope,
    groupId: string,
    metadata: { topic: string; partition: number; offset: string },
  ): Promise<{ process: boolean; attempts: number }> {
    const [created] = await db.insert(kafkaConsumedEvents).values({
      organizationId: event.organizationId,
      eventId: event.eventId,
      consumerGroup: groupId,
      topic: metadata.topic,
      partition: metadata.partition,
      offset: metadata.offset,
      payload: event as unknown as Record<string, unknown>,
    }).onConflictDoNothing().returning();
    if (created) return { process: true, attempts: 1 };

    const [existing] = await db.select().from(kafkaConsumedEvents).where(and(
      eq(kafkaConsumedEvents.consumerGroup, groupId),
      eq(kafkaConsumedEvents.eventId, event.eventId),
    )).limit(1);
    if (!existing || existing.status === 'processed' || existing.status === 'dead_letter') return { process: false, attempts: existing?.attempts ?? 0 };

    // Two reclaimable cases:
    //   'failed'     — an operator replayed it via /inbox/:id/replay.
    //   'processing' — but only once stale. The retry loop parks a row here
    //                  between attempts, so if its process dies (or the group
    //                  rebalances) mid-retry the row would otherwise stay
    //                  'processing' forever: redelivery found no 'failed' row,
    //                  returned process:false, and the event was silently
    //                  dropped without ever reaching the dead-letter table.
    // A fresh 'processing' row still means "someone else is on it", which is
    // what makes this safe to run on every consumer at once — the status and
    // staleness predicates live in the UPDATE, so exactly one claimant wins.
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
    const [reclaimed] = await db.update(kafkaConsumedEvents).set({
      status: 'processing',
      attempts: sql`${kafkaConsumedEvents.attempts} + 1`,
      partition: metadata.partition,
      offset: metadata.offset,
      updatedAt: new Date(),
    }).where(and(
      eq(kafkaConsumedEvents.id, existing.id),
      or(
        eq(kafkaConsumedEvents.status, 'failed'),
        and(
          eq(kafkaConsumedEvents.status, 'processing'),
          lt(kafkaConsumedEvents.updatedAt, staleBefore),
        ),
      ),
    )).returning();

    if (reclaimed && existing.status === 'processing') {
      logger.warn(
        `Reclaimed event ${event.eventId} (${groupId}) stuck in processing since ${existing.updatedAt.toISOString()}`,
      );
    }
    return { process: Boolean(reclaimed), attempts: reclaimed?.attempts ?? existing.attempts };
  }
}

export const idempotentKafkaConsumer = new IdempotentKafkaConsumer();
