/**
 * The prediction-error loop, end to end, against a real database.
 *
 * Everything else about surprise is covered by pure-function tests: whether a
 * divergence counts, what the escalation floor is, whether the ids are stable.
 * None of that answers the question that matters — does an outcome diverging
 * from a prediction actually cause a running cycle to replan?
 *
 * That question needs real rows, because the whole mechanism is a chain of
 * lookups: correlationId -> event primitive -> causal links -> subscription
 * match -> delivery row -> mission context. A stubbed database would assert my
 * own assumptions about that chain rather than the chain.
 *
 * Runs against the test database only, via requireTestDatabaseUrl. It writes
 * real rows, and it must never touch the development database.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { requireTestDatabaseUrl } from '../../../../../tests/configure-test-environment.js';

// The replan effect is a queue push. Capturing it is how we observe that a
// surprise reached the point of actually disturbing work.
const queued: Array<{ missionRunId: number }> = [];
vi.mock('@domain/mission/infrastructure/dynamic-mission-queue.js', () => ({
  queueMissionCycle: vi.fn(async (job: any) => { queued.push(job); }),
}));

const databaseUrl = requireTestDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;

const { cycleSignalSubscriptionService } = await import('../../core/cycle-signal-subscription.service.js');

const pool = new Pool({ connectionString: databaseUrl });
const ids = {
  org: 0,
  cycle: 0,
  mission: 0,
  run: 0,
  primitive: randomUUID(),
  transition: randomUUID(),
  subscription: 0,
};

async function seed(): Promise<void> {
  const org = await pool.query(
    `INSERT INTO orgs (name) VALUES ($1) RETURNING org_id`,
    [`surprise-loop-${Date.now()}`],
  );
  ids.org = org.rows[0].org_id;

  const cycle = await pool.query(
    `INSERT INTO operational_cycles (organization_id, name, objective, status, priority, created_by)
     VALUES ($1,$2,$3,'active',5,'test') RETURNING id`,
    [ids.org, 'Surprise loop cycle', 'verify replanning'],
  );
  ids.cycle = cycle.rows[0].id;

  const mission = await pool.query(
    `INSERT INTO missions (organization_id, name, objective, status, blackboard, created_by)
     VALUES ($1,$2,$3,'active','{}'::jsonb,'test') RETURNING id`,
    [ids.org, 'Surprise loop mission', 'verify replanning'],
  );
  ids.mission = mission.rows[0].id;

  const run = await pool.query(
    `INSERT INTO mission_runs (organization_id, mission_id, cycle_id, name, status, created_by, mission_context)
     VALUES ($1,$2,$3,'Surprise loop run','active','test','{}'::jsonb) RETURNING id`,
    [ids.org, ids.mission, ids.cycle],
  );
  ids.run = run.rows[0].id;

  await pool.query(
    `INSERT INTO event_primitives
       (id, organization_id, source_entry_id, event_type, target_sector, jurisdiction,
        severity, source_url, extraction_timestamp, confidence_score, content_hash)
     VALUES ($1,$2,$3,'policy_change','Energy','US','High','http://test',NOW(),0.95,$4)`,
    [ids.primitive, ids.org, `test:${ids.primitive}`, `hash-${ids.primitive}`],
  );

  await pool.query(
    `INSERT INTO state_transition_events
       (id, organization_id, event_primitive_id, affected_entities, impact_horizons,
        environment_variables, status)
     VALUES ($1,$2,$3,$4,'{}'::jsonb,'{}'::jsonb,'accepted')`,
    [ids.transition, ids.org, ids.primitive, JSON.stringify([{ targetEntityId: 'asset-1', blastRadius: 10 }])],
  );

  await pool.query(
    `INSERT INTO causal_graph_links
       (organization_id, event_primitive_id, target_entity_type, target_entity_id,
        impact_horizon_min_days, impact_horizon_max_days, impact_confidence, blast_radius)
     VALUES ($1,$2,'cycle',$3,1,7,80,10)`,
    [ids.org, ids.primitive, String(ids.cycle)],
  );

  // context_only on purpose: the escalation floor is what has to lift this to a
  // replan. A subscription that already asked for one would prove nothing.
  const subscription = await pool.query(
    `INSERT INTO cycle_signal_subscriptions
       (organization_id, cycle_id, name, enabled, filters, delivery_mode, state_projection,
        cooldown_minutes, created_by)
     VALUES ($1,$2,'loop test',true,'{}'::jsonb,'context_only','{}'::jsonb,0,'test') RETURNING id`,
    [ids.org, ids.cycle],
  );
  ids.subscription = subscription.rows[0].id;
}

beforeAll(async () => {
  await seed();
}, 60_000);

afterAll(async () => {
  // Ordered by foreign key, so the suite leaves nothing behind.
  await pool.query(`DELETE FROM cycle_signal_deliveries WHERE organization_id = $1`, [ids.org]);
  await pool.query(`DELETE FROM cycle_signal_subscriptions WHERE organization_id = $1`, [ids.org]);
  await pool.query(`DELETE FROM causal_graph_links WHERE organization_id = $1`, [ids.org]);
  await pool.query(`DELETE FROM state_transition_events WHERE organization_id = $1`, [ids.org]);
  await pool.query(`DELETE FROM event_primitives WHERE organization_id = $1`, [ids.org]);
  await pool.query(`DELETE FROM mission_runs WHERE organization_id = $1`, [ids.org]);
  await pool.query(`DELETE FROM missions WHERE organization_id = $1`, [ids.org]);
  await pool.query(`DELETE FROM operational_cycles WHERE organization_id = $1`, [ids.org]);
  await pool.query(`DELETE FROM orgs WHERE org_id = $1`, [ids.org]);
  await pool.end();
}, 60_000);

const surprise = {
  predictionEventId: 'prediction-1',
  observationEventId: 'observation-1',
  dimension: 'outcome',
  predicted: 'succeeded',
  observed: 'failed',
  error: 1,
  threshold: 0.25,
  summary: 'Expected the action to have succeeded; it failed.',
};

describe('surprise -> replan, end to end', () => {
  it('delivers a surprise to the subscribed cycle', async () => {
    const delivered = await cycleSignalSubscriptionService.deliverSurprise({
      organizationId: ids.org,
      correlationId: ids.primitive,
      surprise,
    });

    expect(delivered).toBe(1);
  }, 60_000);

  it('escalates a context_only subscription to a replan', async () => {
    const { rows } = await pool.query(
      `SELECT disposition, payload FROM cycle_signal_deliveries WHERE subscription_id = $1`,
      [ids.subscription],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].payload.surpriseMode).toBe('replan');
    expect(rows[0].payload.surpriseEffect).toBe('requeued:1');
  });

  it('actually re-queues the running mission — the replan itself', async () => {
    // The point of the whole chain. Without this the surprise is just a row.
    expect(queued).toHaveLength(1);
    expect(queued[0].missionRunId).toBe(ids.run);
  });

  it('tells the agent WHY, via the blackboard the orchestrator merges in', async () => {
    // Re-queueing a mission whose context does not mention the prediction error
    // just repeats the work that produced it.
    const { rows } = await pool.query(`SELECT blackboard FROM missions WHERE id = $1`, [ids.mission]);

    expect(rows[0].blackboard.last_surprise).toMatchObject({
      dimension: 'outcome',
      predicted: 'succeeded',
      observed: 'failed',
    });
  });

  it('writes the same context onto the running mission run', async () => {
    const { rows } = await pool.query(`SELECT mission_context FROM mission_runs WHERE id = $1`, [ids.run]);

    expect(rows[0].mission_context.lastSurprise).toMatchObject({ observed: 'failed' });
  });

  it('is idempotent — a second evaluation does not replan twice', async () => {
    // Evaluation runs from both the Kafka consumer and the in-process path, so
    // this is the guard that stops one divergence disturbing a cycle repeatedly.
    const before = queued.length;

    const delivered = await cycleSignalSubscriptionService.deliverSurprise({
      organizationId: ids.org,
      correlationId: ids.primitive,
      surprise,
    });

    expect(delivered).toBe(0);
    expect(queued).toHaveLength(before);
  }, 60_000);

  it('ignores a correlation that matches no signal', async () => {
    const delivered = await cycleSignalSubscriptionService.deliverSurprise({
      organizationId: ids.org,
      correlationId: randomUUID(),
      surprise,
    });

    expect(delivered).toBe(0);
  }, 60_000);
});

/**
 * The same material, reachable by name.
 *
 * Signals, predictions and surprises were previously reachable only by the code
 * that produced them — pushed into a mission blackboard for agents, rendered on
 * a dashboard for people, queryable by neither. These adapters put them in the
 * ontology, which is the one registry both halves of a hybrid team already use:
 * `ontology_get_object` for an agent, the ontology browser for a person.
 */
describe('signal intelligence as referenceable objects', () => {
  const ctx = { organizationId: 0 } as any;

  beforeAll(() => {
    ctx.organizationId = ids.org;
  });

  it('lists signals scoped to the organisation', async () => {
    const { ONTOLOGY_ADAPTERS } = await import('@domain/knowledge/core/ontology-adapters.js');
    const rows = await ONTOLOGY_ADAPTERS.signals.list(ctx, { limit: 50 });

    expect(rows.some(r => r.id === ids.primitive)).toBe(true);
    const signal = rows.find(r => r.id === ids.primitive)!;
    expect(signal.eventType).toBe('policy_change');
    expect(signal.severity).toBe('High');
  }, 60_000);

  it('resolves a single signal by id, the way a citation would', async () => {
    const { ONTOLOGY_ADAPTERS } = await import('@domain/knowledge/core/ontology-adapters.js');
    const signal = await ONTOLOGY_ADAPTERS.signals.get(ctx, ids.primitive);

    expect(signal).not.toBeNull();
    expect(signal!.targetSector).toBe('Energy');
  }, 60_000);

  it('resolves a prediction and threads it back to its signal', async () => {
    // signalId is the correlation the whole episode hangs off, so one reference
    // reaches the signal, the prediction and any surprise about it.
    const { ONTOLOGY_ADAPTERS } = await import('@domain/knowledge/core/ontology-adapters.js');
    const prediction = await ONTOLOGY_ADAPTERS.predictions.get(ctx, ids.transition);

    expect(prediction).not.toBeNull();
    expect(prediction!.signalId).toBe(ids.primitive);
  }, 60_000);

  it('surfaces a surprise as flat properties, not buried jsonb', async () => {
    const { ONTOLOGY_ADAPTERS } = await import('@domain/knowledge/core/ontology-adapters.js');
    const rows = await ONTOLOGY_ADAPTERS.surprises.list(ctx, { limit: 50 });

    const raised = rows.find(r => r.signalId === ids.primitive);
    expect(raised).toBeDefined();
    expect(raised!.dimension).toBe('outcome');
    expect(raised!.predicted).toBe('succeeded');
    expect(raised!.observed).toBe('failed');
    expect(raised!.error).toBe(1);
  }, 60_000);

  it('lists only deliveries that actually carried a surprise', async () => {
    // The stream-driven delivery above produced a delivery with no surprise on
    // it; a naive read of the table would report it as one.
    const { ONTOLOGY_ADAPTERS } = await import('@domain/knowledge/core/ontology-adapters.js');
    const rows = await ONTOLOGY_ADAPTERS.surprises.list(ctx, { limit: 50 });

    expect(rows.every(r => r.dimension !== null)).toBe(true);
  }, 60_000);

  it('refuses to leak across organisations', async () => {
    const { ONTOLOGY_ADAPTERS } = await import('@domain/knowledge/core/ontology-adapters.js');
    const otherOrg = { organizationId: ids.org + 999_999 } as any;

    expect(await ONTOLOGY_ADAPTERS.signals.get(otherOrg, ids.primitive)).toBeNull();
    expect(await ONTOLOGY_ADAPTERS.predictions.get(otherOrg, ids.transition)).toBeNull();
    expect(await ONTOLOGY_ADAPTERS.signals.list(otherOrg, { limit: 50 })).toHaveLength(0);
  }, 60_000);
});

/**
 * Cycle delivery reached from the durable stream, not only the in-process call.
 *
 * The in-process call is bound to the instance that assessed the signal: if it
 * dies between committing the transition and delivering, no cycle ever hears
 * about it. The consumer path survives that. Both run, so the property that has
 * to hold is that running both delivers exactly ONCE.
 */
describe('stream-driven delivery', () => {
  const second = {
    primitive: randomUUID(),
    transition: randomUUID(),
    subscription: 0,
    run: 0,
  };

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO event_primitives
         (id, organization_id, source_entry_id, event_type, target_sector, jurisdiction,
          severity, source_url, extraction_timestamp, confidence_score, content_hash)
       VALUES ($1,$2,$3,'supply_disruption','Energy','US','Critical','http://test',NOW(),0.99,$4)`,
      [second.primitive, ids.org, `test:${second.primitive}`, `hash-${second.primitive}`],
    );
    await pool.query(
      `INSERT INTO state_transition_events
         (id, organization_id, event_primitive_id, affected_entities, impact_horizons,
          environment_variables, status)
       VALUES ($1,$2,$3,'[]'::jsonb,'{}'::jsonb,$4,'accepted')`,
      [second.transition, ids.org, second.primitive, JSON.stringify({ tariff: 'raised' })],
    );

    const run = await pool.query(
      `INSERT INTO mission_runs (organization_id, mission_id, cycle_id, name, status, created_by, mission_context)
       VALUES ($1,$2,$3,'Stream run','active','test','{}'::jsonb) RETURNING id`,
      [ids.org, ids.mission, ids.cycle],
    );
    second.run = run.rows[0].id;

    const subscription = await pool.query(
      `INSERT INTO cycle_signal_subscriptions
         (organization_id, cycle_id, name, enabled, filters, delivery_mode, state_projection,
          cooldown_minutes, created_by)
       VALUES ($1,$2,'stream test',true,'{}'::jsonb,'replan','{}'::jsonb,0,'test') RETURNING id`,
      [ids.org, ids.cycle],
    );
    second.subscription = subscription.rows[0].id;
  }, 60_000);

  it('delivers when reached only by correlation, as the consumer does', async () => {
    const delivered = await cycleSignalSubscriptionService.deliverByCorrelation(
      ids.org,
      second.primitive,
    );

    // Both subscriptions on this cycle match an unfiltered signal.
    expect(delivered).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      `SELECT payload FROM cycle_signal_deliveries WHERE subscription_id = $1 AND event_primitive_id = $2`,
      [second.subscription, second.primitive],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.appliedEffect).toMatch(/^requeued:/);
  }, 60_000);

  it('delivers exactly once when both paths run — the whole point of running both', async () => {
    // Simulates the in-process call arriving after the consumer already handled
    // the same assessment. Every side effect in deliver() is gated behind an
    // insert unique per (subscription, event primitive), so the second arrival
    // must project nothing and re-queue nothing.
    const queuedBefore = queued.length;

    const again = await cycleSignalSubscriptionService.deliverByCorrelation(ids.org, second.primitive);

    expect(again).toBe(0);
    expect(queued).toHaveLength(queuedBefore);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS c FROM cycle_signal_deliveries WHERE event_primitive_id = $1`,
      [second.primitive],
    );
    expect(rows[0].c).toBe(2); // one per matching subscription, not four
  }, 60_000);

  it('returns 0 for a correlation with no state transition', async () => {
    // A signal assessed but never transitioned has nothing to project.
    const orphan = randomUUID();
    await pool.query(
      `INSERT INTO event_primitives
         (id, organization_id, source_entry_id, event_type, target_sector, jurisdiction,
          severity, source_url, extraction_timestamp, confidence_score, content_hash)
       VALUES ($1,$2,$3,'policy_change','Energy','US','Low','http://test',NOW(),0.5,$4)`,
      [orphan, ids.org, `test:${orphan}`, `hash-${orphan}`],
    );

    expect(await cycleSignalSubscriptionService.deliverByCorrelation(ids.org, orphan)).toBe(0);
  }, 60_000);
});
