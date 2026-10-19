import { z } from 'zod';

/**
 * Broker-neutral envelope for Spatial integration events.
 *
 * Kafka implementations should use organizationId as the default partition
 * key and eventId as the consumer idempotency key. correlationId connects an
 * end-to-end decision flow; causationId points to the event that produced this
 * event.
 */
/**
 * Structural kind of a message, orthogonal to which stream carries it.
 *
 * `eventType` says which stream an event belongs to and is the Kafka topic;
 * `type` says what shape of thing it is. Keeping them separate is what stops
 * every new primitive minting a topic and forcing consumers to re-subscribe.
 */
export type PrimitiveKind =
  // structural payload
  | 'snapshot' | 'delta' | 'pulse' | 'tombstone'
  // cognitive
  | 'observation' | 'prediction' | 'surprise' | 'intent'
  // temporal & flow control
  | 'watermark' | 'boundary'
  // control & meta-execution
  | 'interrupt' | 'barrier' | 'checkpoint' | 'fault';

export interface SpatialEventEnvelope<TType extends string, TPayload> {
  eventId: string;
  eventType: TType;
  /**
   * Required of producers as of the cutover — the compiler is what guarantees
   * every new event carries one. The zod rule stays optional on purpose, so
   * pre-cutover rows already sitting in the outbox and inbox tables still parse
   * via LEGACY_KIND; making the reader strict would strand exactly the
   * historical data replay exists to recover.
   */
  type: PrimitiveKind;
  /**
   * Widened from a literal 1. The literal made v2 unrepresentable, so a payload
   * shape could never change. Producers still emit 1 until something needs 2.
   */
  schemaVersion: number;
  /** ISO 8601. Deliberately not epoch ms — see docs/UNIVERSAL_EVENT_ENVELOPE.md §2.1. */
  occurredAt: string;
  /**
   * Total order within a relay. Stamped by the outbox relay at publish time, not
   * by producers, which cannot know it before their row exists. Insertion order,
   * not commit order — not a linearisable clock.
   */
  sequenceNumber?: number;
  /** Consumers drop the event once occurredAt + ttlMs has passed. */
  ttlMs?: number;
  organizationId: number;
  producer: string;
  correlationId: string;
  causationId?: string;
  /** W3C traceparent, carried opaquely. No OpenTelemetry dependency implied. */
  traceParent?: string;
  traceState?: string;
  /** Canonical URI for the payload schema, when one is published. */
  schemaUri?: string;
  subject?: string;
  /** Envelope-level 0..1. Distinct from any confidence inside a payload. */
  confidenceScore?: number;
  payload: TPayload;
}

/**
 * Streams, not message shapes.
 *
 * These name the ENTITY a message is about; `type` says what kind of message it
 * is. They were previously verb-shaped — `spatial.signal.observed.v1` — which
 * only worked while each stream carried exactly one shape. A signal stream also
 * carrying deltas, snapshots and tombstones made those names actively wrong.
 *
 * Merging request and outcome onto `spatial.action.v1` is the substantive
 * change, not the renaming: an action's intent and its outcome used to sit on
 * separate topics with no ordering guarantee between them. Keyed by the action,
 * on one stream, they are ordered by construction — which is what an
 * outcome-versus-prediction diff needs.
 */
export const SPATIAL_EVENT_TOPICS = {
  signal: 'spatial.signal.v1',
  assessment: 'spatial.assessment.v1',
  action: 'spatial.action.v1',
  fault: 'spatial.fault.v1',
} as const;

/**
 * Pre-cutover stream names, mapped onto their replacements.
 *
 * Kept because stored rows outlive topics: `kafka_outbox_events` and
 * `kafka_consumed_events` hold payloads written before the rename, and replaying
 * one must reach the stream that exists now rather than the one it was written
 * for. Two old streams collapse onto `spatial.action.v1`.
 */
const LEGACY_TOPIC_ALIASES: Record<string, string> = {
  'spatial.signal.observed.v1': SPATIAL_EVENT_TOPICS.signal,
  'spatial.assessment.completed.v1': SPATIAL_EVENT_TOPICS.assessment,
  'spatial.action.requested.v1': SPATIAL_EVENT_TOPICS.action,
  'spatial.outcome.recorded.v1': SPATIAL_EVENT_TOPICS.action,
  'spatial.dead-letter.v1': SPATIAL_EVENT_TOPICS.fault,
};

/** Current name for a stream, translating a pre-cutover one if needed. */
export function normalizeSpatialTopic(eventType: string): string {
  return LEGACY_TOPIC_ALIASES[eventType] ?? eventType;
}

/** Every stream this deployment subscribes to or publishes on. */
export const ALL_SPATIAL_TOPICS: readonly string[] = Object.values(SPATIAL_EVENT_TOPICS);

export type SpatialEntityReference = {
  type: string;
  id: string;
};

export type SpatialSignalObserved = SpatialEventEnvelope<
  typeof SPATIAL_EVENT_TOPICS.signal,
  {
    signalId: string;
    eventType: string;
    targetSector: string;
    severity: string;
    confidence: number;
    jurisdiction: string;
    summary?: string;
    sourceUrl?: string;
    entityRefs: SpatialEntityReference[];
    provenance?: Record<string, unknown>;
    /**
     * Positional telemetry, when the producer has it (AIS, GPS, sensor feed).
     * Optional so existing producers stay valid — a signal without it is placed
     * by the ingestion resolver from its text or jurisdiction instead.
     */
    telemetry?: {
      latitude?: number;
      longitude?: number;
      /** Producer-declared accuracy radius in metres. */
      precisionM?: number;
      velocityKnots?: number;
      headingDegrees?: number;
      /** Approved trajectory position, for spatial_drift. */
      projectedLatitude?: number;
      projectedLongitude?: number;
      /** Isotropic flux density Φ in the occupied cell, 0-1. */
      fluxDensityPhi?: number;
      /** Per-tile metrics keyed by H3 index, for grouped tile-set rules. */
      cellMetrics?: Record<string, unknown>;
      /** Tracked entity id; required for ENTER/EXIT transitions and dwell. */
      subjectId?: string;
    };
  }
>;

export type SpatialActionRequested = SpatialEventEnvelope<
  typeof SPATIAL_EVENT_TOPICS.action,
  {
    actionId: string;
    signalId: string;
    actionType: string;
    entityRefs: SpatialEntityReference[];
    requiresApproval: boolean;
    rationale?: string;
  }
>;

export type SpatialOutcomeRecorded = SpatialEventEnvelope<
  typeof SPATIAL_EVENT_TOPICS.action,
  {
    actionId: string;
    signalId?: string;
    outcome: 'succeeded' | 'failed' | 'cancelled';
    metrics?: Record<string, number>;
    summary?: string;
  }
>;

const entityRefSchema = z.object({ type: z.string().min(1), id: z.string().min(1) });
const primitiveKindSchema = z.enum([
  'snapshot', 'delta', 'pulse', 'tombstone',
  'observation', 'prediction', 'surprise', 'intent',
  'watermark', 'boundary',
  'interrupt', 'barrier', 'checkpoint', 'fault',
]);

const envelopeFields = {
  eventId: z.string().uuid(),
  type: primitiveKindSchema.optional(),
  // Widened from z.literal(1): the literal is a one-way door that makes every
  // future payload change unrepresentable. Readers accept any positive version
  // now so producers can move to 2 later without a flag day.
  schemaVersion: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  sequenceNumber: z.number().int().nonnegative().optional(),
  ttlMs: z.number().int().positive().optional(),
  // Positivity is enforced per-event in parseSpatialEventDetailed, because a
  // fault legitimately has no tenant. Kept permissive here so the envelope rule
  // stays uniform across streams.
  organizationId: z.number().int(),
  producer: z.string().min(1),
  correlationId: z.string().min(1),
  causationId: z.string().min(1).optional(),
  traceParent: z.string().min(1).optional(),
  traceState: z.string().min(1).optional(),
  schemaUri: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
};

/**
 * Prediction error: an observation violated what a prediction implied.
 *
 * Carries both sides and the threshold, so a consumer can re-derive the
 * judgement instead of trusting a bare boolean — the point of the primitive is
 * that a downstream agent decides whether to replan, and it needs the magnitude
 * to decide.
 */
const surprisePayload = z.object({
  predictionEventId: z.string().min(1),
  observationEventId: z.string().min(1),
  signalId: z.string().min(1).optional(),
  actionId: z.string().min(1).optional(),
  /** What was compared. */
  dimension: z.enum(['outcome', 'blastRadius']),
  predicted: z.union([z.number(), z.string()]),
  observed: z.union([z.number(), z.string()]),
  /** Normalised 0..1. 1 means categorically wrong. */
  error: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  summary: z.string().optional(),
});

/**
 * Dead letters come from two places and carry slightly different evidence: a
 * handler that gave up after its retries keeps `originalEvent`, while bytes that
 * never parsed have no envelope at all and keep `rawBase64` plus a `reason`.
 * One permissive shape covers both rather than splitting the topic.
 */
const deadLetterPayload = z.object({
  consumerGroup: z.string().min(1),
  error: z.string(),
  metadata: z.object({
    topic: z.string(),
    partition: z.number().int().nonnegative(),
    offset: z.string(),
  }),
  reason: z.string().optional(),
  /** Present when the failure was a handler error, so the envelope survived. */
  originalEvent: z.unknown().optional(),
  /** Present when the bytes never parsed, so there was no envelope to keep. */
  rawBase64: z.string().optional(),
});

const signalObservedPayload = z.object({
    signalId: z.string().min(1), eventType: z.string().min(1), targetSector: z.string().min(1),
    severity: z.string().min(1), confidence: z.number().min(0).max(1), jurisdiction: z.string().min(1),
  summary: z.string().optional(), sourceUrl: z.string().optional(), entityRefs: z.array(entityRefSchema),
  provenance: z.record(z.string(), z.unknown()).optional(),
});

const assessmentCompletedPayload = z.object({
  signalId: z.string().min(1), assessmentId: z.string().min(1), blastRadius: z.number().nonnegative(),
  entityRefs: z.array(entityRefSchema), recommendedActionTypes: z.array(z.string()),
});

const actionRequestedPayload = z.object({
  actionId: z.string().min(1), signalId: z.string().min(1), actionType: z.string().min(1),
  entityRefs: z.array(entityRefSchema), requiresApproval: z.boolean(), rationale: z.string().optional(),
});

const outcomeRecordedPayload = z.object({
  actionId: z.string().min(1), signalId: z.string().min(1).optional(),
  outcome: z.enum(['succeeded', 'failed', 'cancelled']), metrics: z.record(z.string(), z.number()).optional(), summary: z.string().optional(),
});

/**
 * Payload schemas keyed by `${eventType}:${type}`.
 *
 * This replaced a `z.discriminatedUnion('eventType', …)`, for two reasons.
 *
 * It has to be a PAIR. Once topics become entity-centric, `spatial.action.v1`
 * carries both an intent and its outcome, so `eventType` alone stops
 * identifying a payload — and `type` alone never could, since `observation`
 * means a signal payload on one stream and an outcome payload on another.
 * Zod's discriminatedUnion cannot express a composite discriminant.
 *
 * And it has to be OPEN. The closed union rejected anything it did not know,
 * so an unrecognised event was dead-lettered rather than ignored — which makes
 * adding a stream a breaking change for every existing consumer. An unregistered
 * key now leaves the payload unparsed and lets the consumer decide.
 */
/**
 * Primitives that mean the same thing on every stream, so they are keyed by
 * kind alone rather than by (stream, kind).
 *
 * This is what "a payload plus a type value, not new plumbing" actually buys: a
 * tombstone on the signal stream and a tombstone on the action stream are the
 * same message about different entities, and neither needs a topic, a consumer
 * subscription, or a registry entry per stream.
 */
const UNIVERSAL_PAYLOAD_SCHEMAS: Partial<Record<PrimitiveKind, z.ZodTypeAny>> = {
  /** Liveness only. The envelope's occurredAt IS the temporal payload. */
  pulse: z.object({
    healthy: z.boolean().optional(),
    detail: z.record(z.string(), z.unknown()).optional(),
  }),
  /** The entity is gone or no longer relevant; drop anything cached for it. */
  tombstone: z.object({
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    reason: z.string().optional(),
  }),
  /** Absolute baseline, for initialisation, recovery, or delta drift. */
  snapshot: z.object({
    version: z.number().int().nonnegative(),
    state: z.record(z.string(), z.unknown()),
  }),
  /** Incremental change, JSON-Patch shaped, against a known base version. */
  delta: z.object({
    basedOnVersion: z.number().int().nonnegative().optional(),
    changes: z.array(z.object({
      op: z.enum(['add', 'remove', 'replace']),
      path: z.string().min(1),
      value: z.unknown().optional(),
    })).min(1),
  }),
  /** Progress in logical time: everything at or before this point is accounted for. */
  watermark: z.object({
    upToOccurredAt: z.string().datetime(),
    partition: z.number().int().nonnegative().optional(),
  }),
};

const PAYLOAD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  [`${SPATIAL_EVENT_TOPICS.signal}:observation`]: signalObservedPayload,
  [`${SPATIAL_EVENT_TOPICS.assessment}:prediction`]: assessmentCompletedPayload,
  // The pair that a single discriminator cannot express: one stream, two shapes.
  [`${SPATIAL_EVENT_TOPICS.action}:intent`]: actionRequestedPayload,
  [`${SPATIAL_EVENT_TOPICS.action}:observation`]: outcomeRecordedPayload,
  [`${SPATIAL_EVENT_TOPICS.assessment}:surprise`]: surprisePayload,
  [`${SPATIAL_EVENT_TOPICS.fault}:fault`]: deadLetterPayload,
};

/**
 * The primitive each PRE-CUTOVER stream carried, for events written before
 * `type` existed. Keyed on the old names deliberately: a stored row still has
 * the eventType it was written with, and this is what lets it resolve to the
 * payload schema it always used instead of being skipped as unrecognised.
 *
 * Note `spatial.action.requested.v1` and `spatial.outcome.recorded.v1` map to
 * different kinds despite now sharing a stream — which is exactly why the kind
 * must be resolved from the ORIGINAL eventType, before normalisation.
 */
const LEGACY_KIND: Record<string, PrimitiveKind> = {
  'spatial.signal.observed.v1': 'observation',
  'spatial.assessment.completed.v1': 'prediction',
  'spatial.action.requested.v1': 'intent',
  'spatial.outcome.recorded.v1': 'observation',
  'spatial.dead-letter.v1': 'fault',
};

/** Envelope rules, applied to every event regardless of stream. */
const envelopeSchema = z.object({
  ...envelopeFields,
  eventType: z.string().min(1),
  payload: z.unknown(),
});

export interface ParsedSpatialEvent {
  envelope: SpatialEventEnvelope<string, unknown>;
  /** Resolved primitive: explicit `type`, else the legacy stream default. */
  kind: PrimitiveKind | undefined;
  /** False when no schema is registered, so `payload` was passed through unvalidated. */
  payloadValidated: boolean;
}

/**
 * Validates the envelope always, and the payload only when a schema is
 * registered for its `(eventType, kind)` pair.
 *
 * Throws on a malformed envelope or a payload that fails a registered schema.
 * Returns with `payloadValidated: false` for an unrecognised stream.
 */
export function parseSpatialEventDetailed(value: unknown): ParsedSpatialEvent {
  const envelope = envelopeSchema.parse(value);

  // Kind is resolved from the ORIGINAL eventType, then the stream is normalised.
  // Order matters: two pre-cutover streams collapse onto spatial.action.v1 with
  // different kinds, so normalising first would lose the distinction between an
  // intent and an outcome.
  const kind = envelope.type ?? LEGACY_KIND[envelope.eventType];
  const eventType = normalizeSpatialTopic(envelope.eventType);

  // Tenant 0 means "system, no tenant" and is only legitimate for a fault, whose
  // bytes may never have parsed and so carry no tenant to attribute them to.
  if (kind !== 'fault' && envelope.organizationId <= 0) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ['organizationId'],
      message: 'organizationId must be positive for non-fault events',
    }]);
  }

  // Stream-specific shape first, then the stream-agnostic primitive. A pulse or
  // a tombstone is the same message wherever it appears, so it needs no entry
  // per stream — which is the whole point of `type` being separate from routing.
  const schema = kind
    ? PAYLOAD_SCHEMAS[`${eventType}:${kind}`] ?? UNIVERSAL_PAYLOAD_SCHEMAS[kind]
    : undefined;
  const payload = schema ? schema.parse(envelope.payload) : envelope.payload;

  return {
    envelope: { ...envelope, eventType, payload } as SpatialEventEnvelope<string, unknown>,
    kind,
    payloadValidated: Boolean(schema),
  };
}

/** Envelope-only convenience wrapper. Throws on the same inputs as above. */
export function parseSpatialEvent(value: unknown): SpatialEventEnvelope<string, unknown> {
  return parseSpatialEventDetailed(value).envelope;
}

export type SpatialSurprise = SpatialEventEnvelope<
  typeof SPATIAL_EVENT_TOPICS.assessment,
  {
    predictionEventId: string;
    observationEventId: string;
    signalId?: string;
    actionId?: string;
    dimension: 'outcome' | 'blastRadius';
    predicted: number | string;
    observed: number | string;
    error: number;
    threshold: number;
    summary?: string;
  }
>;

export type SpatialDeadLetter = SpatialEventEnvelope<
  typeof SPATIAL_EVENT_TOPICS.fault,
  {
    consumerGroup: string;
    error: string;
    metadata: { topic: string; partition: number; offset: string };
    reason?: string;
    originalEvent?: unknown;
    rawBase64?: string;
  }
>;

export type SpatialAssessmentCompleted = SpatialEventEnvelope<
  typeof SPATIAL_EVENT_TOPICS.assessment,
  {
    signalId: string;
    assessmentId: string;
    blastRadius: number;
    entityRefs: SpatialEntityReference[];
    recommendedActionTypes: string[];
  }
>;
