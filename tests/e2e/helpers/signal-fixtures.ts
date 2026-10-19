import type { APIRequestContext } from "@playwright/test";
import { Pool } from "pg";
import { config as loadEnv } from "dotenv";
import { configureTestEnvironment } from "../../configure-test-environment.js";

/**
 * Fixture construction and teardown for the spatial-signal suite.
 *
 * Cycles, missions and mission runs are inserted directly rather than launched
 * through `POST /api/cycles/launch`. That endpoint spawns a real agent cycle —
 * it calls out to a model, creates jobs and takes tens of seconds — none of
 * which is under test here. What IS under test is what happens to a cycle when a
 * signal arrives, and that needs cycles in precise, chosen states (one paused,
 * one closed, one awaiting approval) that the launch endpoint will not produce
 * on demand.
 *
 * Everything on the path actually being verified — signal injection, rule
 * evaluation, subscription creation, delivery — goes through the real HTTP API.
 */

loadEnv({ path: ".env.test", override: true });

let pool: Pool | null = null;

export function signalPool(): Pool {
  if (!pool) {
    const { databaseUrl } = configureTestEnvironment();
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
  }
  return pool;
}

export async function closeSignalPool(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}

/** The organisation the seeded E2E user belongs to. */
export const E2E_ORG_ID = 1;

export type CycleKey =
  | "CYC_CTX"
  | "CYC_GATE"
  | "CYC_REPLAN"
  | "CYC_TRIGGER"
  | "CYC_BLOCKED"
  | "CYC_CLOSED";

export interface SignalFixtures {
  orgId: number;
  cycleIds: Record<CycleKey, number>;
  missionId: number;
  /** Active mission runs by cycle key, in creation order. */
  runIds: Partial<Record<CycleKey, number[]>>;
  /** A completed run on CYC_REPLAN — must be excluded from re-queue counts. */
  completedRunId: number;
  /** Graph entities a signal maps onto; see `seedCausalGraph`. */
  graph: SeededGraph;
}

/**
 * Entity ids the causal graph will link a matching signal to.
 *
 * `graph_nodes.ref_id` is a uuid column, so these are uuids rather than the
 * cycle ids one might expect: `targetEntityId` on a causal link is whatever
 * ref_id the matched node carries. A subscription's `entityIds` filter has to
 * name the same value, which is why the fixture hands them back rather than
 * letting a spec guess.
 */
export interface SeededGraph {
  /** Matches Logistics/NL signals; the hub of a 4-node blast radius. */
  primaryEntityId: string;
  /** Matches Financial/SA signals only; isolated, so blast radius is 0. */
  secondaryEntityId: string;
  /** Downstream nodes reachable from the primary entity. */
  downstreamEntityIds: string[];
  /** What `computeBlastRadius` returns for the primary entity. */
  primaryBlastRadius: number;
  /**
   * How many causal links a Logistics/NL signal produces.
   *
   * Fixed and known because the semantic-graph operators are defined on it:
   * NEIGHBORHOOD_DENSITY compares it to a threshold directly, and
   * FIEDLER_CUT_IMPACT derives `min(1, degree/10)` from it. Without a
   * deterministic degree those conditions can only be asserted vacuously.
   */
  logisticsLinkCount: number;
}

/**
 * Seeds the graph nodes a signal's causal mapping needs.
 *
 * Without this, `findMatchingAssets` returns nothing on a fresh test database
 * (graph_nodes ships empty), so every signal produces ZERO causal links. That
 * silently disables three things at once: the `entityIds` subscription filter
 * has nothing to match, blast radius is always 0 so the MAUF blast term is
 * constant, and every semantic-graph condition degenerates.
 *
 * Note graph_nodes has no organization_id — the table is global — so these rows
 * are cleared by ref_id rather than by org.
 */
async function seedCausalGraph(): Promise<SeededGraph> {
  const db = signalPool();

  const mkNode = async (
    type: string,
    label: string,
    properties: Record<string, unknown>,
  ): Promise<{ id: string; refId: string }> => {
    const { rows } = await db.query(
      `INSERT INTO graph_nodes (type, label, ref_id, properties)
       VALUES ($1,$2,gen_random_uuid(),$3::jsonb) RETURNING id, ref_id`,
      [type, label, JSON.stringify(properties)],
    );
    return { id: rows[0].id, refId: rows[0].ref_id };
  };

  const primary = await mkNode("supplier", "E2E Signal Primary Supplier", {
    sectorTags: ["Logistics"],
    operatingRegions: ["NL"],
    entityType: "supplier",
  });

  // Three more Logistics suppliers, so a Logistics signal links to exactly four
  // entities. `findMatchingAssets` matches on sector OR jurisdiction, so this
  // fixes the causal degree that the semantic-graph operators are defined on.
  const peers: Array<{ id: string; refId: string }> = [];
  for (let i = 1; i <= 3; i++) {
    peers.push(
      await mkNode("supplier", `E2E Signal Peer Supplier ${i}`, {
        sectorTags: ["Logistics"],
        entityType: "supplier",
      }),
    );
  }

  const secondary = await mkNode("supplier", "E2E Signal Secondary Supplier", {
    sectorTags: ["Financial"],
    operatingRegions: ["SA"],
    entityType: "supplier",
  });

  // Four downstream nodes, edges out of the primary only. They carry NO
  // sectorTags or operatingRegions, so they are never matched directly and only
  // ever contribute through the edge traversal. Blast radius is "reachable
  // nodes minus the start", so the primary scores 4 and every other entity
  // scores 0 — two distinguishable values the MAUF blast term can move on.
  const downstream: Array<{ id: string; refId: string }> = [];
  for (let i = 1; i <= 4; i++) {
    downstream.push(
      await mkNode("workstream", `E2E Signal Downstream ${i}`, { entityType: "workstream" }),
    );
  }
  for (const node of downstream) {
    await db.query(
      // strength/confidence/weight are NOT NULL without defaults in the live
      // schema, even though the drizzle model makes them look optional.
      `INSERT INTO graph_edges (source_node_id, target_node_id, type, strength, confidence, weight)
       VALUES ($1,$2,'impacts',1,1,1)`,
      [primary.id, node.id],
    );
  }

  return {
    primaryEntityId: primary.refId,
    secondaryEntityId: secondary.refId,
    downstreamEntityIds: downstream.map((n) => n.refId),
    primaryBlastRadius: downstream.length,
    logisticsLinkCount: 1 + peers.length,
  };
}

const CYCLE_PLAN: Array<{ key: CycleKey; name: string; status: string; activeRuns: number }> = [
  { key: "CYC_CTX", name: "E2E Signal · Context", status: "active", activeRuns: 1 },
  { key: "CYC_GATE", name: "E2E Signal · Gate", status: "active", activeRuns: 1 },
  { key: "CYC_REPLAN", name: "E2E Signal · Replan", status: "active", activeRuns: 2 },
  { key: "CYC_TRIGGER", name: "E2E Signal · Trigger", status: "paused", activeRuns: 0 },
  { key: "CYC_BLOCKED", name: "E2E Signal · Blocked", status: "pending_approval", activeRuns: 0 },
  { key: "CYC_CLOSED", name: "E2E Signal · Closed", status: "closed", activeRuns: 0 },
];

/**
 * Clears every signal-intelligence row for the organisation.
 *
 * Not optional hygiene — a correctness requirement. `deliver()` iterates EVERY
 * enabled subscription in the org, so a subscription left behind by an earlier
 * run receives the current run's signals and inflates the exact delivery counts
 * Scenario 2 asserts on. The suite must start from a known empty state.
 *
 * Safe because the connection is guarded by `assertSafeTestDatabaseUrl`: the
 * database name must carry a distinct "test" segment, so this cannot reach a
 * development or production database.
 */
export async function resetSignalState(orgId = E2E_ORG_ID): Promise<void> {
  const db = signalPool();
  // Foreign-key order: deliveries reference subscriptions, transitions and
  // primitives; world states reference primitives and transitions.
  await db.query(`DELETE FROM cycle_signal_deliveries WHERE organization_id = $1`, [orgId]);
  await db.query(`DELETE FROM cycle_world_states WHERE organization_id = $1`, [orgId]);
  await db.query(`DELETE FROM cycle_signal_subscriptions WHERE organization_id = $1`, [orgId]);
  await db.query(`DELETE FROM autonomous_action_logs WHERE organization_id = $1`, [orgId]);
  await db.query(`DELETE FROM autonomous_action_policies WHERE organization_id = $1`, [orgId]);
  await db.query(`DELETE FROM causal_graph_links WHERE organization_id = $1`, [orgId]);
  await db.query(`DELETE FROM state_transition_events WHERE organization_id = $1`, [orgId]);
  await db.query(`DELETE FROM event_primitives WHERE organization_id = $1`, [orgId]);
  await db.query(`DELETE FROM rule_execution_audits WHERE organization_id = $1`, [orgId]);
  await db
    .query(`DELETE FROM spatial_condition_state WHERE organization_id = $1`, [orgId])
    .catch(() => {
      /* Table is created lazily by the persistence store; absent is fine. */
    });
  await db.query(
    `DELETE FROM rule_specifications WHERE suite_db_id IN (SELECT id FROM rule_suites WHERE organization_id = $1)`,
    [orgId],
  );
  await db.query(`DELETE FROM rule_suites WHERE organization_id = $1`, [orgId]);

  // Mission runs and cycles created by previous fixture builds, matched on the
  // fixture name prefix so unrelated data in the test database survives.
  await db.query(
    `DELETE FROM mission_runs WHERE organization_id = $1 AND cycle_id IN
       (SELECT id FROM operational_cycles WHERE organization_id = $1 AND name LIKE 'E2E Signal · %')`,
    [orgId],
  );
  // LIKE, not equality: createIsolatedCycle suffixes the mission name per label.
  await db.query(
    `DELETE FROM missions WHERE organization_id = $1 AND name LIKE 'E2E Signal Mission%'`,
    [orgId],
  );
  await db.query(
    `DELETE FROM operational_cycles WHERE organization_id = $1 AND name LIKE 'E2E Signal · %'`,
    [orgId],
  );

  // graph_nodes carries no organization_id, so these are matched by label.
  // Edges cascade from the node delete.
  await db.query(`DELETE FROM graph_nodes WHERE label LIKE 'E2E Signal %'`);
}

/** Builds the cycle/mission/run fixture set from a clean slate. */
export async function createSignalFixtures(orgId = E2E_ORG_ID): Promise<SignalFixtures> {
  await resetSignalState(orgId);
  const db = signalPool();

  const mission = await db.query(
    `INSERT INTO missions (organization_id, name, objective, status, blackboard, created_by)
     VALUES ($1,'E2E Signal Mission','verify signal-driven replanning','active','{}'::jsonb,'signal-e2e')
     RETURNING id`,
    [orgId],
  );
  const missionId: number = mission.rows[0].id;

  const cycleIds = {} as Record<CycleKey, number>;
  const runIds: Partial<Record<CycleKey, number[]>> = {};

  for (const plan of CYCLE_PLAN) {
    const cycle = await db.query(
      `INSERT INTO operational_cycles (organization_id, name, objective, status, priority, created_by)
       VALUES ($1,$2,'verify signal reaction',$3,5,'signal-e2e') RETURNING id`,
      [orgId, plan.name, plan.status],
    );
    const cycleId: number = cycle.rows[0].id;
    cycleIds[plan.key] = cycleId;

    const ids: number[] = [];
    for (let i = 0; i < plan.activeRuns; i++) {
      const run = await db.query(
        `INSERT INTO mission_runs (organization_id, mission_id, cycle_id, name, status, created_by, mission_context)
         VALUES ($1,$2,$3,$4,'active','signal-e2e','{}'::jsonb) RETURNING id`,
        [orgId, missionId, cycleId, `${plan.name} run ${i + 1}`],
      );
      ids.push(run.rows[0].id);
    }
    if (ids.length) runIds[plan.key] = ids;
  }

  // A completed run on the replan cycle. `applyDeliveryMode` filters to
  // status='active', so a correct implementation reports requeued:2 here, not 3
  // — this row is the difference between those two answers.
  const completed = await db.query(
    `INSERT INTO mission_runs (organization_id, mission_id, cycle_id, name, status, created_by, mission_context)
     VALUES ($1,$2,$3,'E2E Signal · Replan completed run','completed','signal-e2e','{}'::jsonb) RETURNING id`,
    [orgId, missionId, cycleIds.CYC_REPLAN],
  );

  const graph = await seedCausalGraph();

  return { orgId, cycleIds, missionId, runIds, completedRunId: completed.rows[0].id, graph };
}

/**
 * Creates a cycle that no other subscription is attached to, plus one active
 * mission run.
 *
 * World-state version arithmetic is only meaningful in isolation. `deliver()`
 * iterates every enabled subscription in the organisation, and each match
 * projects — so on a shared cycle the version advances once per matching
 * subscription, and "did this signal bump the version by one?" becomes a
 * question about how many other tests happen to have run first.
 *
 * Any scenario asserting an exact version delta gets its own cycle from here.
 */
export async function createIsolatedCycle(
  label: string,
  status = "active",
  orgId = E2E_ORG_ID,
): Promise<{ cycleId: number; runId: number; missionId: number }> {
  const db = signalPool();

  const mission = await db.query(
    `INSERT INTO missions (organization_id, name, objective, status, blackboard, created_by)
     VALUES ($1,$2,'isolated fixture','active','{}'::jsonb,'signal-e2e') RETURNING id`,
    [orgId, `E2E Signal Mission · ${label}`],
  );
  const missionId: number = mission.rows[0].id;

  const cycle = await db.query(
    `INSERT INTO operational_cycles (organization_id, name, objective, status, priority, created_by)
     VALUES ($1,$2,'isolated fixture',$3,5,'signal-e2e') RETURNING id`,
    [orgId, `E2E Signal · ${label}`, status],
  );
  const cycleId: number = cycle.rows[0].id;

  const run = await db.query(
    `INSERT INTO mission_runs (organization_id, mission_id, cycle_id, name, status, created_by, mission_context)
     VALUES ($1,$2,$3,$4,'active','signal-e2e','{}'::jsonb) RETURNING id`,
    [orgId, missionId, cycleId, `E2E Signal · ${label} run`],
  );

  return { cycleId, runId: run.rows[0].id, missionId };
}

export interface SubscriptionInput {
  cycleId: number;
  name: string;
  deliveryMode?: "context_only" | "notify" | "replan" | "trigger" | "gate";
  filters?: Record<string, unknown>;
  cooldownMinutes?: number;
  stateProjection?: Record<string, unknown>;
  enabled?: boolean;
}

/** Creates a subscription through the real API and returns its id. */
export async function createSubscription(
  request: APIRequestContext,
  input: SubscriptionInput,
): Promise<number> {
  const res = await request.post("/api/cycle-signal-subscriptions", { data: input });
  if (res.status() !== 201) {
    throw new Error(
      `Subscription create failed (${res.status()}): ${await res.text()}\ninput: ${JSON.stringify(input)}`,
    );
  }
  return (await res.json()).id as number;
}

/** Sets a cycle's status directly — used to restore state between scenarios. */
export async function setCycleStatus(cycleId: number, status: string): Promise<void> {
  await signalPool().query(
    `UPDATE operational_cycles SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, cycleId],
  );
}

/** Sets a mission run's status directly. */
export async function setRunStatus(runId: number, status: string): Promise<void> {
  await signalPool().query(
    `UPDATE mission_runs SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, runId],
  );
}

/** Reads a cycle's current status. */
export async function cycleStatus(cycleId: number): Promise<string> {
  const { rows } = await signalPool().query(`SELECT status FROM operational_cycles WHERE id = $1`, [
    cycleId,
  ]);
  return rows[0]?.status;
}
