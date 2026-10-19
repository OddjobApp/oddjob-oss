/**
 * Smoke check: the spatial event stream, against a real broker.
 *
 * Unit tests cover the envelope's rules; this covers the things only a live
 * broker can answer — that the topics exist, that publishing to them succeeds
 * with auto-creation disabled, and that an entity's events land on one
 * partition. Those are exactly the failures that look fine in jsdom-style
 * isolation and break on deploy.
 *
 *   npm run smoke:spatial-stream
 *
 * Requires KAFKA_ENABLED=true and a reachable broker; exits 0 as a no-op when
 * Kafka is disabled, so it is safe to run anywhere.
 *
 * Publishes a handful of probe events to the real streams. They are inert —
 * nothing consumes `producer: 'spatial-smoke'` — but this is not a read-only
 * check, so point it at dev rather than production.
 */

import {
  ALL_SPATIAL_TOPICS,
  SPATIAL_EVENT_TOPICS,
  parseSpatialEventDetailed,
} from '../../shared/contracts/spatial-events.js';
import { kafkaEventBus } from '../../server/domain/core/infrastructure/kafka-event-bus.service.js';
import { hasExpired } from '../../server/domain/core/infrastructure/kafka-consumer.service.js';

const PRODUCER = 'spatial-smoke';
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown = true): void {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(`${label} (expected ${expected}, got ${actual})`);
}

const base = {
  schemaVersion: 1,
  organizationId: 7,
  producer: PRODUCER,
  correlationId: `smoke-${Date.now()}`,
};

const envelope = (over: Record<string, unknown>) => ({
  ...base,
  eventId: crypto.randomUUID(),
  occurredAt: new Date().toISOString(),
  ...over,
}) as any;

async function main(): Promise<void> {
  const health = await kafkaEventBus.health();
  if (!health.enabled) {
    console.log('SKIP  Kafka disabled (KAFKA_ENABLED is not true) — nothing to verify');
    return;
  }
  check('broker reachable', health.connected);
  if (!health.connected) return;

  // Auto-creation is disabled on the producer, so a missing topic is a hard
  // publish failure rather than a silently misconfigured one.
  await kafkaEventBus.ensureTopics(ALL_SPATIAL_TOPICS);
  check('ensureTopics is idempotent', (await kafkaEventBus.ensureTopics(ALL_SPATIAL_TOPICS)).length, 0);

  // A stream-agnostic primitive needs no per-stream registration: the same
  // payload shape has to validate on any stream that carries it.
  const pulse = envelope({
    eventType: SPATIAL_EVENT_TOPICS.signal, type: 'pulse',
    subject: 'signal:smoke', payload: { healthy: true },
  });
  check('pulse validates on the signal stream', parseSpatialEventDetailed(pulse).payloadValidated);
  await kafkaEventBus.publish(pulse);

  const tombstone = envelope({
    eventType: SPATIAL_EVENT_TOPICS.action, type: 'tombstone',
    subject: 'action:smoke', payload: { entityType: 'action', entityId: 'smoke' },
  });
  check('the same primitive validates on another stream', parseSpatialEventDetailed(tombstone).payloadValidated);
  await kafkaEventBus.publish(tombstone);

  const surprise = envelope({
    eventType: SPATIAL_EVENT_TOPICS.assessment, type: 'surprise', subject: 'signal:smoke', confidenceScore: 1,
    payload: {
      predictionEventId: 'p', observationEventId: 'o', dimension: 'outcome',
      predicted: 'succeeded', observed: 'failed', error: 1, threshold: 0.25,
    },
  });
  check('surprise validates on the assessment stream', parseSpatialEventDetailed(surprise).payloadValidated);
  await kafkaEventBus.publish(surprise);

  check('an expired event is dropped',
    hasExpired(envelope({ eventType: SPATIAL_EVENT_TOPICS.signal, type: 'pulse', payload: {}, occurredAt: new Date(Date.now() - 60_000).toISOString(), ttlMs: 1_000 })));
  check('a live event is kept',
    hasExpired(envelope({ eventType: SPATIAL_EVENT_TOPICS.signal, type: 'pulse', payload: {}, ttlMs: 60_000 })), false);

  // The cutover's actual payoff: an intent and its outcome share a subject, so
  // they must share a partition and therefore an order.
  const subject = `action:smoke-${Date.now()}`;
  for (const type of ['intent', 'observation'] as const) {
    await kafkaEventBus.publish(envelope({
      eventType: SPATIAL_EVENT_TOPICS.action, type, subject,
      payload: type === 'intent'
        ? { actionId: subject, signalId: 's', actionType: 'smoke', entityRefs: [], requiresApproval: false }
        : { actionId: subject, outcome: 'succeeded' },
    }));
  }
  console.log(`INFO  published an intent and an outcome to ${SPATIAL_EVENT_TOPICS.action} under ${subject}`);
}

try {
  await main();
} catch (error) {
  failures.push(`threw: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await kafkaEventBus.disconnect().catch(() => {});
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nAll spatial stream checks passed.');
// Explicit: importing the consumer pulls in the database pool, whose open
// handles keep the event loop alive, so the process would otherwise hang here
// long after the work is done.
process.exit(0);
