import { and, asc, eq, lt, lte } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { kafkaOutboxEvents } from '@shared/schema/index.js';
import type { KafkaEnvelope } from './kafka-event-bus.service.js';
import { kafkaEventBus } from './kafka-event-bus.service.js';
import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('KafkaOutbox');
const MAX_ATTEMPTS = 12;

type DatabaseWriter = { insert: (...args: any[]) => any };

export async function enqueueKafkaEvent(
  writer: DatabaseWriter,
  event: KafkaEnvelope,
  // Entity-scoped, matching kafkaEventBus.publish. Ordering is only meaningful
  // per key, and the entity is the thing whose event order has to hold.
  partitionKey = event.subject ?? String(event.organizationId),
): Promise<void> {
  await writer.insert(kafkaOutboxEvents).values({
    organizationId: event.organizationId,
    eventId: event.eventId,
    topic: event.eventType,
    partitionKey,
    payload: event,
  }).onConflictDoNothing({ target: kafkaOutboxEvents.eventId });
}

export class KafkaOutboxRelay {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(intervalMs = Number(process.env.KAFKA_OUTBOX_POLL_MS || 500)): void {
    if (!kafkaEventBus.isEnabled() || this.timer) return;
    this.timer = setInterval(() => void this.flush().catch(error =>
      logger.error('Outbox relay flush failed', error)
    ), intervalMs);
    this.timer.unref();
    void this.flush();
    logger.info(`Kafka outbox relay started (${intervalMs}ms)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async flush(batchSize = 100): Promise<number> {
    if (this.running || !kafkaEventBus.isEnabled()) return 0;
    this.running = true;
    let published = 0;
    try {
      // Recover rows claimed by a process that terminated before publish/ack.
      await db.update(kafkaOutboxEvents).set({
        status: 'pending', lockedAt: null, availableAt: new Date(), updatedAt: new Date(),
      }).where(and(
        eq(kafkaOutboxEvents.status, 'publishing'),
        lt(kafkaOutboxEvents.lockedAt, new Date(Date.now() - 60_000)),
      ));
      // Ordered by sequence, not by id: the primary key is a random uuid, so an
      // unordered read published same-key events to the topic in arbitrary
      // order and made Kafka's per-partition ordering guarantee meaningless.
      const candidates = await db.select().from(kafkaOutboxEvents)
        .where(and(eq(kafkaOutboxEvents.status, 'pending'), lte(kafkaOutboxEvents.availableAt, new Date())))
        .orderBy(asc(kafkaOutboxEvents.sequence))
        .limit(batchSize);

      // Sorting the batch is only half of ordering. If an event fails and is
      // rescheduled, publishing its successors anyway would put them on the
      // topic ahead of it — so once a key fails, the rest of that key's events
      // wait for the next flush. Other keys are unaffected.
      const blockedKeys = new Set<string>();

      for (const candidate of candidates) {
        if (blockedKeys.has(candidate.partitionKey)) continue;

        const [claimed] = await db.update(kafkaOutboxEvents).set({
          status: 'publishing',
          lockedAt: new Date(),
          attempts: candidate.attempts + 1,
          updatedAt: new Date(),
        }).where(and(eq(kafkaOutboxEvents.id, candidate.id), eq(kafkaOutboxEvents.status, 'pending'))).returning();
        if (!claimed) continue;

        try {
          // Stamped here, not by producers: a producer builds its envelope
          // before the outbox row exists, so it cannot know the sequence. This
          // is the only point where the relay's total order is known.
          const envelope = {
            ...(candidate.payload as unknown as KafkaEnvelope),
            sequenceNumber: candidate.sequence,
          };
          await kafkaEventBus.publish(envelope, candidate.partitionKey);
          await db.update(kafkaOutboxEvents).set({
            status: 'published',
            publishedAt: new Date(),
            lockedAt: null,
            lastError: null,
            updatedAt: new Date(),
          }).where(eq(kafkaOutboxEvents.id, candidate.id));
          published++;
        } catch (error) {
          blockedKeys.add(candidate.partitionKey);
          const attempts = candidate.attempts + 1;
          const terminal = attempts >= MAX_ATTEMPTS;
          const delayMs = Math.min(60_000, 500 * 2 ** Math.min(attempts, 7));
          await db.update(kafkaOutboxEvents).set({
            status: terminal ? 'dead_letter' : 'pending',
            availableAt: new Date(Date.now() + delayMs),
            lockedAt: null,
            lastError: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
            updatedAt: new Date(),
          }).where(eq(kafkaOutboxEvents.id, candidate.id));
        }
      }
      return published;
    } finally {
      this.running = false;
    }
  }
}

export const kafkaOutboxRelay = new KafkaOutboxRelay();
