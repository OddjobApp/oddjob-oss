# Universal Event Envelope — migration spec

Status: **Complete — phases 0-3 shipped** (`493329d9`, `03054ad2`, `a7c71818`, `f94594a5`).
The wire format HAS changed: streams are entity-centric, request and outcome share
`spatial.action.v1`, and the partition key is `subject`.

Open decision resolved during Phase 2: the partition key moved from `organizationId` to
`subject`, per the recommendation in §3.2.

Goal: make the spatial stream carry protocol- and domain-agnostic event primitives (Delta,
Snapshot, Pulse, Tombstone, Observation, Prediction, Surprise, Intent, Watermark, Interrupt,
Barrier, Checkpoint, Fault) without a rewrite, and without breaking the five producers and
three consumers that exist today.

This document specifies the envelope only. Payload shapes for the individual primitives, and
the question of what to do about the domain-specific `event_primitives` table, are out of
scope and called out at the end.

---

## 1. What exists today

`SpatialEventEnvelope<TType, TPayload>` in `shared/contracts/spatial-events.ts`:

```ts
{
  eventId: string;          // uuid
  eventType: TType;         // ALSO the Kafka topic name
  schemaVersion: 1;         // z.literal(1)
  occurredAt: string;       // ISO 8601
  organizationId: number;   // z.number().int().positive()
  producer: string;
  correlationId: string;
  causationId?: string;
  subject?: string;
  payload: TPayload;
}
```

**Producers (5)**

| Producer | Event | Path |
|---|---|---|
| `enqueueSpatialSignal` | `spatial.signal.observed.v1` | `spatial-kafka.service.ts:43` → outbox |
| `enqueueSpatialAction` | `spatial.action.requested.v1` | `spatial-kafka.service.ts:55` → outbox (in caller's tx) |
| `enqueueSpatialOutcome` | `spatial.outcome.recorded.v1` | `spatial-kafka.service.ts:78` → outbox |
| `world-model-bridge` | `spatial.assessment.completed.v1` | `world-model-bridge.service.ts:111` → outbox |
| `kafka-consumer` DLQ | `spatial.dead-letter.v1` | `kafka-consumer.service.ts:50,75` → **direct publish, bypasses outbox** |

**Consumers (3)**

| Consumer | Behaviour |
|---|---|
| `SpatialKafkaConsumers` | Subscribes to 4 topics; `parseSpatialEvent` then `switch (eventType)` with **no default branch** |
| `/inbox/:id/replay` | `parseSpatialEvent(entry.payload)` then republishes **the parsed object** |
| Outbox relay | Opaque passthrough; reads only the `topic` and `partition_key` columns |

### 1.1 Two latent defects to fix first

Verified empirically against the live schema:

1. **`spatial.dead-letter.v1` is not in `spatialEventSchema`'s discriminated union, and the DLQ
   producer sets `organizationId: 0`, which fails `z.number().int().positive()`.** The system
   emits an event its own contract rejects. Harmless only because nothing subscribes to that
   topic yet.
2. **`/inbox/:id/replay` republishes the *parsed* object, not the stored one.** Zod strips
   unknown keys, so replaying an event that carries fields the local schema does not know
   silently downgrades it. This turns a rolling deploy into data loss on the replay path.

Both must be fixed in Phase 0 or the migration inherits them.

---

## 2. Target envelope

```ts
/** Structural kind of the message. Orthogonal to eventType/topic. */
export type PrimitiveKind =
  // structural payload
  | 'snapshot' | 'delta' | 'pulse' | 'tombstone'
  // cognitive
  | 'observation' | 'prediction' | 'surprise' | 'intent'
  // temporal & flow control
  | 'watermark' | 'boundary'
  // control & meta-execution
  | 'interrupt' | 'barrier' | 'checkpoint' | 'fault';

export interface UniversalEventEnvelope<TType extends string, TPayload> {
  // ── identity ─────────────────────────────────────────────────────────
  eventId: string;
  /** Domain stream + routing key. Unchanged: still the Kafka topic name. */
  eventType: TType;
  /** NEW. Structural kind. What a generic handler switches on. */
  type: PrimitiveKind;

  // ── time & order ─────────────────────────────────────────────────────
  occurredAt: string;                 // ISO 8601, producer clock
  /** NEW, optional. Total order within a relay. Stamped by the outbox relay. */
  sequenceNumber?: number;
  /** NEW, optional. Consumers drop the event once occurredAt + ttlMs has passed. */
  ttlMs?: number;

  // ── causality & tracing ──────────────────────────────────────────────
  correlationId: string;
  causationId?: string;
  /** NEW, optional. W3C traceparent. Carried opaquely; no OTel dependency. */
  traceParent?: string;
  traceState?: string;

  // ── schema ───────────────────────────────────────────────────────────
  /** WIDENED from z.literal(1) to a positive int. The literal makes v2 unrepresentable. */
  schemaVersion: number;
  /** NEW, optional. Canonical URI for the payload schema. */
  schemaUri?: string;

  // ── context & quality ────────────────────────────────────────────────
  organizationId: number;
  producer: string;
  subject?: string;
  /** NEW, optional. Envelope-level 0..1. Distinct from any payload-level score. */
  confidenceScore?: number;

  payload: TPayload;
}
```

### 2.1 Mapping to your `UniversalEvent<T>`

| Your field | Here | Note |
|---|---|---|
| `id` | `eventId` | Existing name kept; renaming touches every producer for no gain |
| `type` | `type` | New, as specified |
| `timestamp` | `occurredAt` | **Decision 3:** ISO string, not epoch ms. Deliberate divergence from the written spec. Consumers doing TTL or watermark arithmetic parse once at the edge |
| `sequenceNumber` | `sequenceNumber` | **Decision 2:** universal, not optional — the DLQ moves onto the outbox so every event gets one. See §3.1 |
| `correlationId` / `causationId` | same | Already present |
| `payload` | same | Already present |
| `confidenceScore?` | same | Promoted to envelope level |
| `ttlMs?` | same | New |

### 2.2 Primitive assignment for today's events

**Decision 1:** the assessment is a `prediction`.

| eventType | `type` | Rationale |
|---|---|---|
| `spatial.signal.observed.v1` | `observation` | Ground truth from a feed |
| `spatial.assessment.completed.v1` | `prediction` | A world-model projection (`blastRadius`, `recommendedActionTypes`). Typing it this way is the precondition for `surprise`: prediction error needs a stored prediction to diff a later outcome against |
| `spatial.action.requested.v1` | `intent` | Proposed side effect, already gated by `requiresApproval` |
| `spatial.outcome.recorded.v1` | `observation` | Ground truth about what actually happened |
| `spatial.dead-letter.v1` | `fault` | — |

Consequence of Decision 1: once assessments are predictions, `surprise` becomes reachable —
diff an `outcome.recorded` observation against the `prediction` its `correlationId` links back
to. That is a separate piece of work, but it is no longer blocked on a missing producer.

---

## 3. The topic/type decoupling

Today `kafkaEventBus.publish()` does `topic: event.eventType`. So topic and semantic identity
are the same string. If primitives were expressed as new `eventType` values, every primitive
would mint a Kafka topic — `spatial.signal.delta.v1`, `spatial.signal.pulse.v1`, and so on —
multiplying topics by primitives and forcing every consumer to re-subscribe.

**`type` is a field, not a topic.** A delta for signals is `type: 'delta'`, not a new topic.
Routing stays on `eventType`; semantics move to `type`.

**Decision 4: rename the topics to be entity-centric, now, in the same migration.**

| Today | Becomes | Carries |
|---|---|---|
| `spatial.signal.observed.v1` | `spatial.signal.v1` | `observation`, later `delta` / `snapshot` / `pulse` / `tombstone` |
| `spatial.assessment.completed.v1` | `spatial.assessment.v1` | `prediction`, later `surprise` |
| `spatial.action.requested.v1` | `spatial.action.v1` | `intent` **and** `observation` (the outcome) |
| `spatial.outcome.recorded.v1` | *(merged above)* | — |
| `spatial.dead-letter.v1` | `spatial.fault.v1` | `fault` |

Four topics become three plus faults. Merging intent and outcome onto `spatial.action.v1` is
not just tidiness: an action's intent and its outcome currently live on separate topics with
**no ordering guarantee between them**. On one topic keyed by the action they are ordered by
construction, which is what makes an outcome safely diffable against the intent that caused it.

### 3.1 What the rename forces — read before committing to it

`spatialEventSchema` is `z.discriminatedUnion('eventType', …)`. Once `spatial.action.v1`
carries both an intent and an outcome, **`eventType` no longer discriminates** — two different
payload shapes share one value. And `type: 'observation'` means a signal payload on
`spatial.signal.v1` but an outcome payload on `spatial.action.v1`, so `type` alone does not
discriminate either.

The discriminator has to become the **pair** `(eventType, type)`, which zod's
`discriminatedUnion` cannot express. That means a registry:

```ts
const PAYLOAD_SCHEMAS = new Map<string, ZodTypeAny>([
  ['spatial.signal.v1:observation', signalObservedPayload],
  ['spatial.action.v1:intent',      actionRequestedPayload],
  ['spatial.action.v1:observation', outcomeRecordedPayload],
  // unknown key -> envelope validated, payload passed through unparsed
]);
```

This is exactly the open-union parse originally scheduled for Phase 2. **Choosing to rename now
pulls Phase 2 forward into Phase 1** — the two cannot be separated, because the moment topics
merge, the closed union stops being expressible. That is a bigger change than a constant
rename, and it is the main cost of Decision 4.

The upside: the registry is the right end state anyway. It is what makes unknown primitives
forward-compatible instead of dead-lettered, and it removes the closed union that made this
system domain-bound in the first place.

### 3.2 Partition key

Creating new topics is the only cheap moment to revisit this. Today the key is
`String(organizationId)`, so every event for an org lands on one partition: per-org total
ordering, no parallelism within an org, and hot partitions for large tenants.

Entity-centric topics make `subject` (`signal:<id>`, `action:<id>`) the natural key — per-entity
ordering, which is the guarantee that actually matters, plus real partition spread.
**Recommended, but flag if you disagree**, because it changes the ordering contract from
"per org" to "per entity" and cannot be changed later without another topic migration.

### 3.3 Cutover cost — measured, not assumed

Checked against the running dev environment:

- `KAFKA_ENABLED=true`, broker `localhost:9092`
- `kafka_outbox_events`: 10 rows, all `published` — only `spatial.signal.observed.v1` (6) and
  `spatial.assessment.completed.v1` (4) have ever carried traffic
- `kafka_consumed_events`: 6 rows across those same two topics
- `spatial.action.requested.v1` and `spatial.outcome.recorded.v1` have **never** been published

So in this environment the rename is close to free: two live topics, ten events, one consumer
group. No dual-publish window is needed — stop the consumer, switch the constants, create the
new topics, restart. The old topics can be deleted once drained.

**This holds only if dev is the only environment running Kafka.** I can only see this database.
If a staging or production broker exists, that changes the plan to: publish to both old and new
topics, migrate consumers, then retire the old topics — and the merged `spatial.action.v1`
needs the registry parse deployed to consumers *before* any producer starts using it.

### 3.4 `sequenceNumber` assignment

**Decision 2: the DLQ producer moves onto the outbox**, so there is exactly one publish path
and `sequenceNumber` is universal rather than optional. `kafka-consumer.service.ts` currently
calls `kafkaEventBus.publish()` directly in its failure path; it will instead
`enqueueKafkaEvent()` and let the relay publish, which also makes dead letters durable and
retried instead of fire-and-forget.

The relay stamps `payload.sequenceNumber` from the outbox `sequence bigserial` (migration
`0026`) immediately before publishing.

One consequence to accept: dead-lettering now requires a database write, so a Postgres-caused
failure cannot dead-letter. The `kafka_consumed_events` row already retains the full payload in
that case, and `/inbox/:id/replay` can recover it, so nothing is lost — but the DLQ topic will
not see it.

Sequence numbers are *insertion* order, not *commit* order: a transaction that starts earlier
but commits later can carry a lower sequence. Bounded by transaction duration, already
documented on the column. Do not present it as a linearisable clock.

---

## 4. Back-compatibility analysis

Verified against the live schema, not assumed:

| Change | Old consumer behaviour | Safe? |
|---|---|---|
| Add `type`, `ttlMs`, `sequenceNumber`, `traceParent`, `schemaUri`, `confidenceScore` | **Accepted, then silently stripped** (zod objects are non-strict) | ✅ additive |
| Widen `schemaVersion` to `number` | Old consumer **rejects** anything but `1` | ⚠️ only if the value stays `1` |
| Add `deadLetter` to the union | No effect on old consumers | ✅ |
| Make `type` required | Old producers emit none → new consumer rejects | ❌ ordered rollout |
| Rename topics (Decision 4) | Consumers stop receiving on the old names | ❌ **breaking — coordinated cutover, §3.3** |
| Merge intent + outcome onto one topic | Closed union can no longer discriminate | ❌ **requires the registry parse, §3.1** |

Four things follow.

**Consumers deploy before producers.** Old consumers tolerate new fields, so a new producer
against an old consumer is safe. The reverse is not.

**`schemaVersion` stays `1` until every consumer accepts `>= 1`.** The `z.literal(1)` is a
one-way door: bump it before consumers are widened and every in-flight event is rejected and
dead-lettered. Widening the *reader* is Phase 1; changing the *value* is Phase 2 at the
earliest, and buys nothing until a payload actually changes shape.

**Stripping is the sharp edge.** Old consumers do not merely tolerate unknown fields, they
delete them. Anything that parses and re-emits — today, `/inbox/:id/replay` — will downgrade
events mid-migration. Fix it to republish `entry.payload` verbatim before Phase 1 begins.

**Decision 4 makes this migration breaking, so the additive path no longer buys much.** The
envelope changes alone would have been fully back-compatible; the topic rename and the merged
action topic are not, and they force the registry parse to land at the same time. The plan
below therefore front-loads the breaking work into one coordinated cutover rather than
pretending it can be rolled out field by field.

---

## 5. Phases

**Phase 0 — fix the latent defects. SHIPPED (493329d9).** Add `deadLetter` to the union; stop the DLQ producer
emitting `organizationId: 0` (use the source event's org, or relax the rule to `nonnegative()`
with `0` meaning "system"); make `/inbox/:id/replay` republish the stored payload verbatim.
No envelope change. Independently shippable.

**Phase 1 — envelope + registry parse (no wire change yet). SHIPPED (03054ad2).** Add every new field, `type`
included, as optional on the type and in zod; widen `schemaVersion` to
`z.number().int().positive()` while still emitting `1`. Replace the `discriminatedUnion` with
the `(eventType, type)` registry from §3.1, keyed initially on the *old* topic names so
behaviour is identical. Add an explicit `default` branch to the `SpatialKafkaConsumers` switch.
Populate `type` on all five producers. Relay stamps `sequenceNumber`; DLQ moves onto the outbox.
Still fully back-compatible — nothing on the wire has changed.

**Phase 2 — the cutover (breaking). SHIPPED (a7c71818).** One coordinated step, per §3.3: register the new topic
keys, point producers and the consumer subscription list at the new names, merge intent and
outcome onto `spatial.action.v1`, switch the partition key to `subject` (§3.2), make `type`
required. Drain and delete the old topics. In dev this is stop / switch / create / restart; if
another broker exists, dual-publish first.

**Phase 3 — enforce and extend. SHIPPED (f94594a5).** Enforce `ttlMs` in `IdempotentKafkaConsumer` before it claims
a row. Then add payload shapes for `pulse`, `tombstone`, `delta`, `snapshot`, `watermark` —
each now just a payload plus a `type` value, no new plumbing. `surprise` becomes a real
producer diffing `outcome.recorded` against the `prediction` sharing its `correlationId`.

Phase 0 is independently shippable today. Phase 1 is safe to land incrementally. Phase 2 is the
one that needs a scheduled window.

---

## 6. Storage

No migration is required for the envelope — `kafka_outbox_events.payload` and
`kafka_consumed_events.payload` are `jsonb`.

Worth adding when ops queries start filtering by primitive:

```sql
CREATE INDEX kafka_outbox_type_idx ON kafka_outbox_events ((payload->>'type'));
```

---

## 7. Out of scope, but decide soon

- **`event_primitives` is misnamed and domain-bound.** Its columns (`targetSector`,
  `jurisdiction`, `severity`) and closed TS unions are exactly what stops a new stream type
  being added without a schema change. The envelope work does not touch it. Making the
  *storage* domain-agnostic is a larger, separate migration.

  > **Update (Aug 2026, migrations 0041–0042).** The table gained an optional spatial
  > telemetry block — `latitude`, `longitude`, `h3_index`, `previous_h3_index`,
  > `dwell_minutes`, `velocity_knots`, `heading_degrees`, `projected_*`,
  > `flux_density_phi`, `cell_metrics`, `subject_id`, plus the provenance pair
  > `spatial_source` / `spatial_precision_m`. Correspondingly, the
  > `spatial.signal.v1:observation` payload carries an optional `telemetry` object.
  > Both are additive and nullable, so existing producers and rows stay valid.
  > This widens the domain-bound surface rather than narrowing it, which makes the
  > domain-agnostic storage migration above *more* worth doing, not less.
  > See `SIGNAL_INTELLIGENCE_SPATIAL_RULES.md`.
- **Surprise has no producer — but Decision 1 unblocks it.** Nothing yet computes
  `|observation − prediction| > ε`. Once assessments are typed `prediction` and outcomes
  `observation`, the diff has both sides and a `correlationId` linking them, so this becomes a
  Phase 3 component rather than an architectural gap. Still the item that matters most for
  agent replanning.
- **Backpressure remains absent.** `consumerLag()` measures; nothing acts. `pause`/`resume` are
  not envelope concerns — they are relay and consumer-loop behaviour, and belong in a separate
  design.

---

## 8. Decisions

Settled 2026-08-03.

| # | Question | Decision |
|---|---|---|
| 1 | Is `assessment.completed` a prediction or an observation? | **`prediction`** — §2.2. Unblocks `surprise` |
| 2 | DLQ through the outbox, or accept no `sequenceNumber`? | **Through the outbox** — §3.4. One publish path, durable dead letters |
| 3 | ISO `occurredAt` or epoch-ms `timestamp`? | **ISO string** — §2.1. Deliberate divergence from the source spec |
| 4 | Rename topics to be entity-centric? | **Yes, now** — §3. Made against a recommendation to defer; see below |

### Note on Decision 4

I recommended deferring this and the call went the other way, which is fine — but it changes
the shape of the work and that should be explicit rather than buried:

- The migration becomes **breaking**. The envelope changes on their own were fully additive.
- **Phase 2 collapses into Phase 1.** Merging intent and outcome onto `spatial.action.v1` makes
  the closed discriminated union inexpressible, so the registry parse has to land as part of
  the same change rather than later (§3.1).
- It is genuinely cheap **in this environment** — two live topics, ten events, one consumer
  group (§3.3) — and correspondingly expensive if any other broker exists.
- The real payoff is not naming: it is per-entity ordering between an intent and its outcome,
  which the current topic split cannot provide.

### Still open

- Partition key: `subject` instead of `organizationId` (§3.2). Recommended, not confirmed.
- Whether a staging or production broker exists. The Phase 2 plan depends on it and I can only
  see the dev database.
