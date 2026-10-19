/**
 * TTL expiry.
 *
 * Dropping an expired event is a correctness decision, not an optimisation: a
 * stale event is not a failure, so it must not retry, must not dead-letter, and
 * must not be counted as processed work. The defaults matter as much as the
 * comparison — most events carry no ttlMs at all and must live forever.
 */

import { describe, expect, it } from 'vitest';
import { hasExpired } from './kafka-consumer.service.js';
import type { KafkaEnvelope } from './kafka-event-bus.service.js';

const at = (iso: string, ttlMs?: number) => ({
  eventId: 'e1',
  eventType: 'spatial.signal.v1',
  type: 'observation',
  schemaVersion: 1,
  occurredAt: iso,
  ttlMs,
  organizationId: 7,
  producer: 'test',
  correlationId: 'c1',
  payload: {},
} as unknown as KafkaEnvelope);

const T0 = '2026-08-03T00:00:00.000Z';
const now = Date.parse('2026-08-03T00:01:00.000Z'); // one minute later

describe('hasExpired', () => {
  it('never expires an event without a ttl — the default for everything today', () => {
    expect(hasExpired(at(T0), now)).toBe(false);
  });

  it('expires once occurredAt + ttlMs has passed', () => {
    expect(hasExpired(at(T0, 30_000), now)).toBe(true);
  });

  it('does not expire while still inside the window', () => {
    expect(hasExpired(at(T0, 120_000), now)).toBe(false);
  });

  it('treats the exact boundary as still live', () => {
    // Strictly greater-than: an event is valid for its full ttl, not one tick less.
    expect(hasExpired(at(T0, 60_000), now)).toBe(false);
    expect(hasExpired(at(T0, 60_000), now + 1)).toBe(true);
  });

  it('does not expire on an unparseable timestamp', () => {
    // A bad occurredAt should surface through normal handling. Treating it as
    // expired would make the event silently vanish, which is the one outcome
    // that leaves no trace to debug.
    expect(hasExpired(at('not-a-date', 1), now)).toBe(false);
  });

  it('ignores a zero ttl rather than expiring everything instantly', () => {
    expect(hasExpired(at(T0, 0), now)).toBe(false);
  });
});
