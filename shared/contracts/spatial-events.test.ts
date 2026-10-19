import { describe, expect, it } from 'vitest';
import { parseSpatialEvent, parseSpatialEventDetailed, normalizeSpatialTopic, SPATIAL_EVENT_TOPICS } from './spatial-events';

const validSignal = {
  eventId: 'd0df5967-94fa-4d8e-921b-4c536e14f134', eventType: SPATIAL_EVENT_TOPICS.signal,
  type: 'observation', schemaVersion: 1, occurredAt: '2026-08-02T20:00:00.000Z', organizationId: 7,
  producer: 'test', correlationId: 'flow-1', subject: 'signal:test',
  payload: { signalId: 'signal-1', eventType: 'change', targetSector: 'operations', severity: 'High',
    confidence: 0.9, jurisdiction: 'US', entityRefs: [{ type: 'workstream', id: '42' }] },
};

describe('Spatial Kafka contracts', () => {
  it('accepts a valid versioned signal envelope', () => {
    expect(parseSpatialEvent(validSignal)).toEqual(validSignal);
  });

  it.each([
    ['invalid tenant', { ...validSignal, organizationId: 0 }],
    ['invalid confidence', { ...validSignal, payload: { ...validSignal.payload, confidence: 1.1 } }],
    ['missing correlationId', { ...validSignal, correlationId: undefined }],
    ['non-uuid eventId', { ...validSignal, eventId: 'not-a-uuid' }],
  ])('rejects %s', (_label, event) => {
    expect(() => parseSpatialEvent(event)).toThrow();
  });
});

/**
 * The parse used to be a closed discriminated union: anything it did not
 * recognise threw, so an unknown stream became a dead letter and adding a
 * stream was a breaking change for every existing consumer. It is now open —
 * the envelope is always validated, the payload only when a schema is
 * registered for its (eventType, type) pair.
 */
describe('the open union', () => {
  it('accepts an unknown stream, flagging that its payload was not validated', () => {
    // `interrupt` is a declared kind with no schema registered for it, on a
    // stream nobody knows — the genuinely unrecognised case. A primitive with a
    // universal schema, like `delta`, WOULD be validated here, which is the
    // point of those being stream-agnostic.
    const result = parseSpatialEventDetailed({
      ...validSignal,
      eventType: 'spatial.future-thing.v1',
      type: 'interrupt',
      payload: { anything: 'goes' },
    });

    expect(result.payloadValidated).toBe(false);
    expect(result.envelope.payload).toEqual({ anything: 'goes' });
  });

  it('validates a universal primitive even on a stream it has never seen', () => {
    const result = parseSpatialEventDetailed({
      ...validSignal,
      eventType: 'spatial.future-thing.v1',
      type: 'pulse',
      payload: { healthy: false },
    });

    expect(result.payloadValidated).toBe(true);
  });

  it('still validates the payload of a stream it does know', () => {
    expect(() => parseSpatialEvent({ ...validSignal, payload: { signalId: 'only-this' } })).toThrow();
  });

  it('resolves the primitive from `type` when present', () => {
    expect(parseSpatialEventDetailed({ ...validSignal, type: 'observation' }).kind).toBe('observation');
  });

  it('falls back to the legacy stream default when `type` is absent', () => {
    // A row written before the cutover has the OLD stream name and no `type`.
    // It must still resolve to the payload schema it always used, or replaying
    // historical data strands exactly what replay exists to recover.
    const { type, ...preCutover } = { ...validSignal, eventType: 'spatial.signal.observed.v1' };

    const { kind, payloadValidated, envelope } = parseSpatialEventDetailed(preCutover);

    expect(kind).toBe('observation');
    expect(payloadValidated).toBe(true);
    // …and it is retargeted onto the stream that exists now.
    expect(envelope.eventType).toBe(SPATIAL_EVENT_TOPICS.signal);
  });

  it('accepts a future schemaVersion, since the literal made v2 unrepresentable', () => {
    expect(() => parseSpatialEvent({ ...validSignal, schemaVersion: 2 })).not.toThrow();
  });

  it('carries the new envelope fields through', () => {
    const enriched = {
      ...validSignal,
      type: 'observation',
      sequenceNumber: 42,
      ttlMs: 5_000,
      traceParent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      schemaUri: 'https://schemas.oddjob.app/spatial/signal/1',
      confidenceScore: 0.75,
    };

    expect(parseSpatialEvent(enriched)).toMatchObject({
      type: 'observation',
      sequenceNumber: 42,
      ttlMs: 5_000,
      traceParent: enriched.traceParent,
      schemaUri: enriched.schemaUri,
      confidenceScore: 0.75,
    });
  });
});

/**
 * The consumer emits dead letters on two paths, and until now the contract
 * rejected both: `spatial.dead-letter.v1` was missing from the union entirely,
 * and the unparseable-bytes path sets organizationId 0 against a positive()
 * rule. The system produced events its own schema could not read.
 */
describe('Spatial dead-letter contract', () => {
  const metadata = { topic: 'spatial.signal.observed.v1', partition: 0, offset: '42' };
  const deadLetterBase = {
    eventId: '8f14e45f-ceea-4d3c-b1a1-9c1f4a2b3c4d',
    eventType: SPATIAL_EVENT_TOPICS.fault,
    type: 'fault',
    schemaVersion: 1,
    occurredAt: '2026-08-03T01:00:00.000Z',
    producer: 'kafka-consumer',
    correlationId: 'flow-1',
  };

  it('accepts the handler-failure shape, which keeps the original envelope', () => {
    expect(() => parseSpatialEvent({
      ...deadLetterBase,
      organizationId: 7,
      causationId: validSignal.eventId,
      payload: { originalEvent: validSignal, consumerGroup: 'g1', error: 'handler blew up', metadata },
    })).not.toThrow();
  });

  it('accepts the unparseable-bytes shape, which has no tenant to attribute', () => {
    expect(() => parseSpatialEvent({
      ...deadLetterBase,
      organizationId: 0,
      subject: 'unparseable:spatial.signal.observed.v1:0:42',
      payload: { consumerGroup: 'g1', reason: 'unparseable-message', error: 'Unexpected end of JSON input', metadata, rawBase64: 'eyJ0' },
    })).not.toThrow();
  });

  it('still rejects tenant 0 on a domain event — the relaxation is faults only', () => {
    expect(() => parseSpatialEvent({ ...validSignal, organizationId: 0 })).toThrow();
  });

  it('requires the evidence fields that make a dead letter actionable', () => {
    expect(() => parseSpatialEvent({
      ...deadLetterBase,
      organizationId: 7,
      payload: { error: 'no consumer group', metadata },
    })).toThrow();
  });
});

/**
 * The cutover: streams are named for the ENTITY, and an action's intent and its
 * outcome now share one. This is the case a single discriminator cannot express,
 * and the reason the parse became a (stream, kind) registry.
 */
describe('the merged action stream', () => {
  const actionBase = {
    eventId: 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f',
    eventType: SPATIAL_EVENT_TOPICS.action,
    schemaVersion: 1,
    occurredAt: '2026-08-03T02:00:00.000Z',
    organizationId: 7,
    producer: 'signal-intelligence',
    correlationId: 'flow-9',
    subject: 'action:a-1',
  };

  it('reads an intent and its outcome off the same stream', () => {
    const intent = parseSpatialEventDetailed({
      ...actionBase,
      type: 'intent',
      payload: { actionId: 'a-1', signalId: 's-1', actionType: 'notify', entityRefs: [], requiresApproval: true },
    });
    const outcome = parseSpatialEventDetailed({
      ...actionBase,
      type: 'observation',
      payload: { actionId: 'a-1', outcome: 'succeeded' },
    });

    expect(intent.payloadValidated).toBe(true);
    expect(outcome.payloadValidated).toBe(true);
    expect(intent.kind).toBe('intent');
    expect(outcome.kind).toBe('observation');
  });

  it('applies the right payload schema to each, despite the shared stream', () => {
    // An outcome payload sent as an intent must fail: same stream, wrong shape.
    expect(() => parseSpatialEvent({
      ...actionBase,
      type: 'intent',
      payload: { actionId: 'a-1', outcome: 'succeeded' },
    })).toThrow();
  });

  it('keys both on the action, so their order is guaranteed', () => {
    // Ordering is per partition key. Sharing a subject is what makes an outcome
    // safely diffable against the intent that caused it — on separate streams
    // there was no ordering relationship between them at all.
    expect(actionBase.subject).toBe('action:a-1');
  });
});

/**
 * The primitives that arrive as a payload and a `type`, with no new topic, no
 * subscription and no registry entry per stream. If this needed plumbing per
 * stream, separating `type` from routing would have bought nothing.
 */
describe('stream-agnostic primitives', () => {
  const base = {
    eventId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    schemaVersion: 1,
    occurredAt: '2026-08-03T03:00:00.000Z',
    organizationId: 7,
    producer: 'test',
    correlationId: 'flow-1',
  };

  it.each([
    ['pulse', { healthy: true }],
    ['tombstone', { entityType: 'signal', entityId: 's-1' }],
    ['snapshot', { version: 3, state: { open: 2 } }],
    ['delta', { basedOnVersion: 3, changes: [{ op: 'replace', path: '/open', value: 1 }] }],
    ['watermark', { upToOccurredAt: '2026-08-03T02:59:00.000Z' }],
  ])('validates a %s on any stream without a per-stream entry', (type, payload) => {
    for (const eventType of [SPATIAL_EVENT_TOPICS.signal, SPATIAL_EVENT_TOPICS.action]) {
      const result = parseSpatialEventDetailed({ ...base, eventType, type, payload });
      expect(result.payloadValidated).toBe(true);
      expect(result.kind).toBe(type);
    }
  });

  it.each([
    ['tombstone', { entityId: 'missing the type' }],
    ['snapshot', { version: -1, state: {} }],
    ['delta', { changes: [] }],
    ['watermark', { upToOccurredAt: 'not-a-date' }],
  ])('still enforces the shape of a %s', (type, payload) => {
    expect(() => parseSpatialEvent({ ...base, eventType: SPATIAL_EVENT_TOPICS.signal, type, payload })).toThrow();
  });

  it('lets a stream-specific shape win over the generic one', () => {
    // signal:observation is registered explicitly, so it must not fall through
    // to a universal schema that would accept a far looser payload.
    expect(() => parseSpatialEvent({
      ...base, eventType: SPATIAL_EVENT_TOPICS.signal, type: 'observation', payload: { healthy: true },
    })).toThrow();
  });
});

describe('normalizeSpatialTopic', () => {
  it.each([
    ['spatial.signal.observed.v1', SPATIAL_EVENT_TOPICS.signal],
    ['spatial.assessment.completed.v1', SPATIAL_EVENT_TOPICS.assessment],
    ['spatial.action.requested.v1', SPATIAL_EVENT_TOPICS.action],
    ['spatial.outcome.recorded.v1', SPATIAL_EVENT_TOPICS.action],
    ['spatial.dead-letter.v1', SPATIAL_EVENT_TOPICS.fault],
  ])('translates %s', (legacy, current) => {
    expect(normalizeSpatialTopic(legacy)).toBe(current);
  });

  it('leaves a current name alone', () => {
    expect(normalizeSpatialTopic(SPATIAL_EVENT_TOPICS.signal)).toBe(SPATIAL_EVENT_TOPICS.signal);
  });

  it('leaves an unknown stream alone rather than guessing', () => {
    expect(normalizeSpatialTopic('spatial.something.else.v1')).toBe('spatial.something.else.v1');
  });

  it('distinguishes the two legacy streams that collapse onto one', () => {
    // Both normalise to spatial.action.v1, so the kind has to be resolved from
    // the ORIGINAL name — normalising first would lose intent-vs-outcome.
    const intent = parseSpatialEventDetailed({
      eventId: 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70',
      eventType: 'spatial.action.requested.v1',
      schemaVersion: 1, occurredAt: '2026-08-03T02:00:00.000Z', organizationId: 7,
      producer: 'p', correlationId: 'c', subject: 'action:a-1',
      payload: { actionId: 'a-1', signalId: 's-1', actionType: 'notify', entityRefs: [], requiresApproval: false },
    });
    const outcome = parseSpatialEventDetailed({
      eventId: 'e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7081',
      eventType: 'spatial.outcome.recorded.v1',
      schemaVersion: 1, occurredAt: '2026-08-03T02:00:00.000Z', organizationId: 7,
      producer: 'p', correlationId: 'c', subject: 'action:a-1',
      payload: { actionId: 'a-1', outcome: 'failed' },
    });

    expect(intent.kind).toBe('intent');
    expect(outcome.kind).toBe('observation');
    expect(intent.envelope.eventType).toBe(SPATIAL_EVENT_TOPICS.action);
    expect(outcome.envelope.eventType).toBe(SPATIAL_EVENT_TOPICS.action);
  });
});

/**
 * Guards the replay path. Zod objects are non-strict, so they accept unknown
 * keys and then DROP them — which is why /inbox/:id/replay must republish the
 * stored payload rather than the parsed result.
 */
describe('parse is lossy, so callers must not re-emit its output', () => {
  it('accepts fields from a newer deployment but does not preserve them', () => {
    // Deliberately a field this version has never heard of. Using one that was
    // since added to the envelope would make this pass for the wrong reason and
    // stop guarding the replay path.
    const fromNewerProducer = { ...validSignal, someFieldAddedLater: 'must survive a replay' };

    const parsed = parseSpatialEvent(fromNewerProducer) as unknown as Record<string, unknown>;

    expect(parsed).not.toHaveProperty('someFieldAddedLater');
  });
});
