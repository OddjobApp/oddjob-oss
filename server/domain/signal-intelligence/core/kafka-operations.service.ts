/**
 * Kafka Operations Service
 *
 * Domain service providing monitoring, DLQ inspection, and replay mechanisms
 * for tenant-scoped Kafka outbox and inbox events.
 */

import { db } from '@server/database_service.js';
import { and, desc, eq, sql } from 'drizzle-orm';
import { kafkaConsumedEvents, kafkaOutboxEvents } from '@shared/schema/index.js';
import { SPATIAL_EVENT_TOPICS, normalizeSpatialTopic, parseSpatialEvent } from '@shared/contracts/spatial-events.js';
import { kafkaEventBus, type KafkaEnvelope } from '@domain/core/infrastructure/kafka-event-bus.service.js';
import { NotFoundError } from '@server/utils/errors.js';

export class KafkaOperationsService {
  async getStatus(orgId: number) {
    const topics = [SPATIAL_EVENT_TOPICS.signal, SPATIAL_EVENT_TOPICS.assessment, SPATIAL_EVENT_TOPICS.action];
    const [outbox, inbox, recentFailures, broker, pendingAge, lag] = await Promise.all([
      db
        .select({ status: kafkaOutboxEvents.status, count: sql<number>`count(*)::int` })
        .from(kafkaOutboxEvents)
        .where(eq(kafkaOutboxEvents.organizationId, orgId))
        .groupBy(kafkaOutboxEvents.status),
      db
        .select({ status: kafkaConsumedEvents.status, count: sql<number>`count(*)::int` })
        .from(kafkaConsumedEvents)
        .where(eq(kafkaConsumedEvents.organizationId, orgId))
        .groupBy(kafkaConsumedEvents.status),
      db
        .select({
          id: kafkaOutboxEvents.id,
          eventId: kafkaOutboxEvents.eventId,
          topic: kafkaOutboxEvents.topic,
          attempts: kafkaOutboxEvents.attempts,
          lastError: kafkaOutboxEvents.lastError,
          updatedAt: kafkaOutboxEvents.updatedAt,
        })
        .from(kafkaOutboxEvents)
        .where(and(eq(kafkaOutboxEvents.organizationId, orgId), eq(kafkaOutboxEvents.status, 'dead_letter')))
        .orderBy(desc(kafkaOutboxEvents.updatedAt))
        .limit(50),
      kafkaEventBus.health(),
      db
        .select({
          seconds: sql<number>`coalesce(extract(epoch from (now() - min(${kafkaOutboxEvents.createdAt}))), 0)::int`,
        })
        .from(kafkaOutboxEvents)
        .where(and(eq(kafkaOutboxEvents.organizationId, orgId), eq(kafkaOutboxEvents.status, 'pending'))),
      kafkaEventBus
        .consumerLag(process.env.KAFKA_SPATIAL_GROUP_ID || 'oddjob-spatial-v1', topics)
        .catch(() => ({ total: -1, topics: {} })),
    ]);

    return {
      organizationId: orgId,
      broker,
      outbox,
      inbox,
      recentFailures,
      lag,
      oldestPendingSeconds: pendingAge[0]?.seconds ?? 0,
    };
  }

  async replayOutboxEvent(id: string, orgId: number) {
    const [event] = await db
      .update(kafkaOutboxEvents)
      .set({
        status: 'pending',
        attempts: 0,
        availableAt: new Date(),
        lockedAt: null,
        publishedAt: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(kafkaOutboxEvents.id, id),
          eq(kafkaOutboxEvents.organizationId, orgId),
          eq(kafkaOutboxEvents.status, 'dead_letter')
        )
      )
      .returning();

    if (!event) {
      throw new NotFoundError('Tenant-scoped dead-letter outbox event not found');
    }
    return event;
  }

  async replayInboxEvent(id: string, orgId: number) {
    const [entry] = await db
      .select()
      .from(kafkaConsumedEvents)
      .where(
        and(
          eq(kafkaConsumedEvents.id, id),
          eq(kafkaConsumedEvents.organizationId, orgId),
          eq(kafkaConsumedEvents.status, 'dead_letter')
        )
      )
      .limit(1);

    if (!entry) {
      throw new NotFoundError('Tenant-scoped dead-letter consumer event not found');
    }

    parseSpatialEvent(entry.payload);
    const stored = entry.payload as unknown as KafkaEnvelope;
    const event = { ...stored, eventType: normalizeSpatialTopic(stored.eventType) };

    await db
      .update(kafkaConsumedEvents)
      .set({ status: 'failed', attempts: 0, lastError: null, updatedAt: new Date() })
      .where(eq(kafkaConsumedEvents.id, entry.id));

    try {
      await kafkaEventBus.publish(event, String(orgId));
    } catch (error) {
      await db
        .update(kafkaConsumedEvents)
        .set({
          status: 'dead_letter',
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        })
        .where(eq(kafkaConsumedEvents.id, entry.id));
      throw error;
    }

    return entry;
  }
}

export const kafkaOperationsService = new KafkaOperationsService();
