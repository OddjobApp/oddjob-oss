import { signalPool } from "./signal-fixtures.js";

/**
 * Backend reads for the spatial-signal suite.
 *
 * Every meaningful assertion in these specs runs against the database rather
 * than the API response or the rendered page. `disposition` on a delivery row
 * records what the operator ASKED for and is written before anything happens;
 * `payload.appliedEffect` records what the delivery actually did. A suite that
 * asserted on the first would pass against a completely inert subscription,
 * which is the exact failure mode the effect string was introduced to expose.
 */

export interface DeliveryRow {
  id: string;
  subscriptionId: number;
  cycleId: number;
  eventPrimitiveId: string;
  disposition: string;
  payload: Record<string, any>;
  deliveredAt: Date;
}

function toDelivery(row: any): DeliveryRow {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    cycleId: row.cycle_id,
    eventPrimitiveId: row.event_primitive_id,
    disposition: row.disposition,
    payload: row.payload ?? {},
    deliveredAt: row.delivered_at,
  };
}

/** Every delivery for one signal, across all subscriptions. */
export async function deliveriesForEvent(eventId: string): Promise<DeliveryRow[]> {
  const { rows } = await signalPool().query(
    `SELECT * FROM cycle_signal_deliveries WHERE event_primitive_id = $1 ORDER BY delivered_at`,
    [eventId],
  );
  return rows.map(toDelivery);
}

/**
 * The single delivery for a (subscription, signal) pair, or null.
 *
 * Returns null rather than throwing so a spec can assert a signal was correctly
 * NOT delivered — the negative half of the filter matrix.
 */
export async function deliveryFor(
  subscriptionId: number,
  eventId: string,
): Promise<DeliveryRow | null> {
  const { rows } = await signalPool().query(
    `SELECT * FROM cycle_signal_deliveries WHERE subscription_id = $1 AND event_primitive_id = $2`,
    [subscriptionId, eventId],
  );
  return rows.length ? toDelivery(rows[0]) : null;
}

/** The effect a delivery actually applied, or null if it never delivered. */
export async function appliedEffect(
  subscriptionId: number,
  eventId: string,
): Promise<string | null> {
  const delivery = await deliveryFor(subscriptionId, eventId);
  return delivery ? (delivery.payload.appliedEffect ?? null) : null;
}

/** How many deliveries a subscription has received in total. */
export async function deliveryCount(subscriptionId: number): Promise<number> {
  const { rows } = await signalPool().query(
    `SELECT count(*)::int AS c FROM cycle_signal_deliveries WHERE subscription_id = $1`,
    [subscriptionId],
  );
  return rows[0].c;
}

export interface WorldState {
  version: number;
  variables: Record<string, any>;
  materialChanges: Array<Record<string, any>>;
  lastEventPrimitiveId: string | null;
}

/** A cycle's world state, or null before its first signal. */
export async function worldState(cycleId: number): Promise<WorldState | null> {
  const { rows } = await signalPool().query(
    `SELECT version, variables, material_changes, last_event_primitive_id
     FROM cycle_world_states WHERE cycle_id = $1`,
    [cycleId],
  );
  if (!rows.length) return null;
  return {
    version: rows[0].version,
    variables: rows[0].variables ?? {},
    materialChanges: rows[0].material_changes ?? [],
    lastEventPrimitiveId: rows[0].last_event_primitive_id,
  };
}

/** A world-state version, treating "no row yet" as 0 so deltas are comparable. */
export async function worldStateVersion(cycleId: number): Promise<number> {
  return (await worldState(cycleId))?.version ?? 0;
}

/** A mission run's context blob. */
export async function missionContext(runId: number): Promise<Record<string, any>> {
  const { rows } = await signalPool().query(
    `SELECT mission_context FROM mission_runs WHERE id = $1`,
    [runId],
  );
  return rows[0]?.mission_context ?? {};
}

/** A mission's blackboard. */
export async function blackboard(missionId: number): Promise<Record<string, any>> {
  const { rows } = await signalPool().query(`SELECT blackboard FROM missions WHERE id = $1`, [
    missionId,
  ]);
  return rows[0]?.blackboard ?? {};
}

/** The event primitive row, for asserting resolver-derived spatial columns. */
export async function eventRow(eventId: string): Promise<Record<string, any> | null> {
  const { rows } = await signalPool().query(`SELECT * FROM event_primitives WHERE id = $1`, [
    eventId,
  ]);
  return rows[0] ?? null;
}

/**
 * Kafka outbox rows for a correlation — the durable half of the dual delivery
 * path.
 *
 * `correlationId`, `eventType` and `type` are envelope fields inside `payload`,
 * not columns: the table stores the whole envelope as jsonb and keys only on
 * `event_id`. Filtering has to reach into the document.
 */
export async function outboxFor(correlationId: string): Promise<
  Array<{ eventId: string; topic: string; type: string; eventType: string; payload: any }>
> {
  const { rows } = await signalPool().query(
    `SELECT event_id, topic, payload FROM kafka_outbox_events
     WHERE payload->>'correlationId' = $1 ORDER BY sequence`,
    [correlationId],
  );
  return rows.map((r) => ({
    eventId: r.event_id,
    topic: r.topic,
    type: r.payload?.type,
    eventType: r.payload?.eventType,
    payload: r.payload?.payload ?? {},
  }));
}

/** Rule-execution audit rows for a signal. */
export async function auditsForEvent(eventId: string): Promise<Array<Record<string, any>>> {
  const { rows } = await signalPool().query(
    `SELECT rule_id, suite_id, matched_branch, disposition, master_priority_score, fuzzy_scores
     FROM rule_execution_audits WHERE event_primitive_id = $1 ORDER BY executed_at`,
    [eventId],
  );
  return rows;
}

/** Autonomous action log rows for a signal. */
export async function actionLogsForEvent(eventId: string): Promise<Array<Record<string, any>>> {
  const { rows } = await signalPool().query(
    `SELECT id, policy_id, action_type, approval_status, outcome, failure_reason
     FROM autonomous_action_logs WHERE event_primitive_id = $1 ORDER BY id`,
    [eventId],
  );
  return rows;
}

export interface ConditionState {
  conditionKey: string;
  subjectId: string;
  hits: number;
  misses: number;
  latched: boolean;
}

/**
 * Durable confirmation counters for the iteration gate.
 *
 * These are what make a latched geofence survive a restart instead of re-firing
 * ON_ENTER for an asset that never moved, and they are keyed per (condition,
 * subject) so two vessels confirm independently.
 */
export async function conditionState(
  conditionKey: string,
  subjectId: string,
): Promise<ConditionState | null> {
  const { rows } = await signalPool().query(
    `SELECT condition_key, subject_id, hits, misses, latched
     FROM spatial_condition_state WHERE condition_key = $1 AND subject_id = $2`,
    [conditionKey, subjectId],
  );
  if (!rows.length) return null;
  return {
    conditionKey: rows[0].condition_key,
    subjectId: rows[0].subject_id,
    hits: rows[0].hits,
    misses: rows[0].misses,
    latched: rows[0].latched,
  };
}

/**
 * Waits for a condition's counter to reach an expected hit count.
 *
 * Rule evaluation — and therefore the persistence flush — happens on the
 * fire-and-forget promise, so the counter lands shortly after the inject call
 * resolves rather than before it.
 */
export async function waitForConditionState(
  conditionKey: string,
  subjectId: string,
  predicate: (state: ConditionState | null) => boolean,
  description: string,
  timeoutMs = 15_000,
): Promise<ConditionState | null> {
  const deadline = Date.now() + timeoutMs;
  let last: ConditionState | null = null;
  while (Date.now() < deadline) {
    last = await conditionState(conditionKey, subjectId);
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Timed out waiting for ${description}. Last state: ${JSON.stringify(last)}`,
  );
}

/**
 * Rule evaluation audits are written by a promise the delivery path deliberately
 * does not await — `subscriptionRuleEngine.evaluateEvent(...).catch(...)` is
 * fire-and-forget so a slow LLM judge cannot stall cycle delivery.
 *
 * That means the audit row may not exist when `injectSignal` resolves. Polling
 * is the honest way to assert on it; a fixed sleep would either flake or waste
 * time on every run.
 */
export async function waitForAudits(
  eventId: string,
  expected: number,
  timeoutMs = 20_000,
  /**
   * Optional stronger condition. Prefer it whenever a specific rule is under
   * test: a suite normally holds several enabled rules, so a bare count can be
   * satisfied by an unrelated rule that happened to be evaluated first.
   */
  until?: (rows: Array<Record<string, any>>) => boolean,
): Promise<Array<Record<string, any>>> {
  const deadline = Date.now() + timeoutMs;
  let audits: Array<Record<string, any>> = [];
  while (Date.now() < deadline) {
    audits = await auditsForEvent(eventId);
    const satisfied = until ? until(audits) : audits.length >= expected;
    if (satisfied) return audits;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Timed out waiting for ${until ? "a specific" : expected} rule audit(s) on event ${eventId}; ` +
      `saw ${audits.length}: ${audits.map((a) => a.rule_id).join(", ")}`,
  );
}

/**
 * Every rule evaluation recorded for a signal, matched or not.
 *
 * `auditsForEvent` predates the outcome column and returns the same rows; this
 * exposes the fields that make "why didn't my rule fire" answerable.
 */
export async function ruleOutcomesForEvent(eventId: string): Promise<
  Array<{ ruleId: string; outcome: string; failureReason: string | null; spatialTrace: any }>
> {
  const { rows } = await signalPool().query(
    `SELECT rule_id, outcome, failure_reason, spatial_trace
     FROM rule_execution_audits WHERE event_primitive_id = $1 ORDER BY executed_at`,
    [eventId],
  );
  return rows.map((r) => ({
    ruleId: r.rule_id,
    outcome: r.outcome,
    failureReason: r.failure_reason,
    spatialTrace: r.spatial_trace,
  }));
}

/** Waits for a specific rule's audit row, whatever its outcome. */
export async function waitForRuleOutcome(
  eventId: string,
  ruleId: string,
  timeoutMs = 20_000,
): Promise<{ ruleId: string; outcome: string; failureReason: string | null; spatialTrace: any }> {
  const deadline = Date.now() + timeoutMs;
  let seen: string[] = [];
  while (Date.now() < deadline) {
    const rows = await ruleOutcomesForEvent(eventId);
    const hit = rows.find((r) => r.ruleId === ruleId);
    if (hit) return hit;
    seen = rows.map((r) => `${r.ruleId}:${r.outcome}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Timed out waiting for an audit of rule "${ruleId}" on event ${eventId}. Saw: ${seen.join(", ") || "none"}`,
  );
}

/**
 * The outcome observation envelope for a signal, if one was produced.
 *
 * `policyId` narrows to one policy's action. A signal can match several
 * policies, each producing its own observation, so an unfiltered read returns
 * whichever happened to be enqueued first — which makes an assertion about "the
 * outcome" depend on what other tests left lying around. The action id is
 * `policy-<id>-signal-<eventId>`, so the policy is recoverable from it.
 */
export async function outcomeEnvelope(
  correlationId: string,
  policyId?: number,
): Promise<any | null> {
  const rows = await outboxFor(correlationId);
  const observations = rows.filter((r) => r.type === "observation");
  const match =
    policyId == null
      ? observations[0]
      : observations.find((r) => String(r.payload?.actionId ?? "").startsWith(`policy-${policyId}-`));
  return match?.payload ?? null;
}

/**
 * The surprise envelope for a signal, if a prediction error was raised.
 *
 * Narrowed by `policyId` for the same reason as `outcomeEnvelope`: one signal
 * can match several policies, each producing its own action, outcome and
 * therefore potentially its own surprise.
 */
export async function surpriseEnvelope(
  correlationId: string,
  policyId?: number,
): Promise<any | null> {
  const rows = await outboxFor(correlationId);
  const surprises = rows.filter((r) => r.type === "surprise");
  const match =
    policyId == null
      ? surprises[0]
      : surprises.find((r) => String(r.payload?.actionId ?? "").startsWith(`policy-${policyId}-`));
  return match?.payload ?? null;
}

/** Artifacts an autonomous action produced for a signal. */
export async function artifactsForEvent(eventId: string): Promise<
  Array<{
    id: string;
    kind: string;
    title: string;
    body: string;
    status: string;
    severity: string | null;
    jurisdiction: string | null;
    targetSector: string | null;
    affectedEntityIds: string[];
    details: Record<string, any>;
    policyId: number | null;
  }>
> {
  const { rows } = await signalPool().query(
    `SELECT id, kind, title, body, status, severity, jurisdiction, target_sector,
            affected_entity_ids, details, policy_id
     FROM autonomous_action_artifacts WHERE event_primitive_id = $1 ORDER BY created_at`,
    [eventId],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    status: r.status,
    severity: r.severity,
    jurisdiction: r.jurisdiction,
    targetSector: r.target_sector,
    affectedEntityIds: r.affected_entity_ids ?? [],
    details: r.details ?? {},
    policyId: r.policy_id,
  }));
}
