/**
 * Durable confirmation counters, against a real database.
 *
 * The question is whether the iteration gate survives a process restart. That
 * cannot be answered with a mocked store: the whole point is that a NEW engine
 * instance, with an empty in-memory map, reads back what the previous one
 * wrote. Anything stubbed would be asserting my own assumption about the
 * round trip rather than the round trip.
 *
 * Runs against the test database only, via requireTestDatabaseUrl.
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { latLngToCell, gridDisk } from "h3-js";
import { requireTestDatabaseUrl } from "../../../../../tests/configure-test-environment.js";

const databaseUrl = requireTestDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;

const { SpatialPredicateEngineService } = await import(
  "../../core/spatial-predicate-engine.service.js"
);
const { spatialPersistenceStore } = await import("../../core/spatial-persistence-store.service.js");

const pool = new Pool({ connectionString: databaseUrl });

const HUB = latLngToCell(33.743, -118.267, 7);
const FAR = latLngToCell(20, -40, 7);
const ZONE = gridDisk(HUB, 1);

let orgId = 0;

const condition = () => ({
  type: "spatial" as const,
  mode: "geofence_trigger" as const,
  trigger: "ON_ENTER" as const,
  conditionId: "cond-harbour-entry",
  persistence: { requiredConsecutiveHits: 2, releaseAfterMisses: 3 },
  geometry: { regionName: "Harbour", h3Cells: ZONE, h3Resolution: 7 },
});

const entering = (subjectId: string) => ({
  h3Index: HUB,
  previousH3Index: FAR,
  subjectId,
});

/** A fresh engine with the durable store attached — i.e. a restarted process. */
function newEngine() {
  const engine = new SpatialPredicateEngineService();
  engine.setPersistenceStore(spatialPersistenceStore);
  return engine;
}

/** One evaluation cycle: hydrate, evaluate, flush. Mirrors the rule engine. */
async function tick(engine: ReturnType<typeof newEngine>, subjectId: string) {
  const cond = condition();
  const obs = entering(subjectId);
  await engine.hydratePersistence(orgId, [cond], obs);
  const result = engine.evaluateCondition(cond, obs);
  await engine.flushPersistence(orgId);
  return result;
}

beforeAll(async () => {
  const org = await pool.query(`INSERT INTO orgs (name) VALUES ($1) RETURNING org_id`, [
    `spatial-persist-${Date.now()}`,
  ]);
  orgId = org.rows[0].org_id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM orgs WHERE org_id = $1`, [orgId]);
  await pool.end();
});

beforeEach(async () => {
  await pool.query(`DELETE FROM spatial_condition_state WHERE organization_id = $1`, [orgId]);
});

describe("durable confirmation counters", () => {
  it("carries confirmation progress across a restart", async () => {
    const before = newEngine();
    const first = await tick(before, "vessel-restart");
    expect(first.passed).toBe(false);
    expect(first.persistence).toMatchObject({ hits: 1, required: 2 });

    // A new instance is exactly what a redeploy produces.
    const after = newEngine();
    const second = await tick(after, "vessel-restart");

    // Previously this reported 1/2 again and re-confirmed from scratch.
    expect(second.persistence?.hits).toBe(2);
    expect(second.passed).toBe(true);
  });

  it("keeps a latched geofence latched across a restart", async () => {
    const before = newEngine();
    await tick(before, "vessel-latched");
    const latched = await tick(before, "vessel-latched");
    expect(latched.passed).toBe(true);

    const after = newEngine();
    const stillLatched = await tick(after, "vessel-latched");

    // The bug this table exists to prevent: an asset already inside the zone
    // re-firing ON_ENTER after every deploy.
    expect(stillLatched.passed).toBe(true);
    expect(stillLatched.persistence?.latched).toBe(true);
  });

  it("persists exactly one row per (condition, subject)", async () => {
    const engine = newEngine();
    await tick(engine, "vessel-a");
    await tick(engine, "vessel-a");
    await tick(engine, "vessel-b");

    const rows = await pool.query(
      `SELECT subject_id, hits, latched FROM spatial_condition_state
       WHERE organization_id = $1 ORDER BY subject_id`,
      [orgId]
    );
    expect(rows.rowCount).toBe(2);
    expect(rows.rows[0]).toMatchObject({ subject_id: "vessel-a", latched: true });
    expect(rows.rows[1]).toMatchObject({ subject_id: "vessel-b", latched: false });
  });

  it("keeps subjects independent across restarts", async () => {
    const before = newEngine();
    await tick(before, "alpha");
    await tick(before, "alpha"); // alpha latched
    await tick(before, "bravo"); // bravo at 1/2

    const after = newEngine();
    expect((await tick(after, "bravo")).passed).toBe(true); // bravo reaches 2/2
    // Alpha's independent state is untouched by bravo's progress.
    const alpha = await pool.query(
      `SELECT latched FROM spatial_condition_state WHERE organization_id=$1 AND subject_id='alpha'`,
      [orgId]
    );
    expect(alpha.rows[0].latched).toBe(true);
  });

  it("does not persist counters for ungated conditions", async () => {
    const engine = newEngine();
    const ungated = { ...condition(), persistence: undefined };
    const obs = entering("vessel-ungated");

    await engine.hydratePersistence(orgId, [ungated as any], obs);
    engine.evaluateCondition(ungated as any, obs);
    await engine.flushPersistence(orgId);

    // A condition with no gate has no progress worth a row.
    const rows = await pool.query(
      `SELECT 1 FROM spatial_condition_state WHERE organization_id = $1`,
      [orgId]
    );
    expect(rows.rowCount).toBe(0);
  });

  it("degrades to in-memory when no store is attached", async () => {
    const engine = new SpatialPredicateEngineService(); // no store
    const cond = condition();
    const obs = entering("vessel-nostore");

    await engine.hydratePersistence(orgId, [cond], obs);
    expect(engine.evaluateCondition(cond, obs).passed).toBe(false);
    expect(engine.evaluateCondition(cond, obs).passed).toBe(true);
    await engine.flushPersistence(orgId);

    const rows = await pool.query(
      `SELECT 1 FROM spatial_condition_state WHERE organization_id = $1`,
      [orgId]
    );
    expect(rows.rowCount).toBe(0);
  });
});

describe("dry-run isolation", () => {
  it("does not read or write live counters", async () => {
    const engine = newEngine();
    await tick(engine, "vessel-live");
    await tick(engine, "vessel-live"); // latched

    const beforeRows = await pool.query(
      `SELECT hits, misses, latched FROM spatial_condition_state
       WHERE organization_id=$1 AND subject_id='vessel-live'`,
      [orgId]
    );
    expect(beforeRows.rows[0]).toMatchObject({ hits: 2, latched: true });

    // A dry run evaluates the SAME conditionId. Isolated, it must start clean
    // and leave nothing behind.
    const dryResult = await engine.withIsolatedPersistence(async () => {
      const cond = condition();
      const obs = entering("vessel-live");
      await engine.hydratePersistence(orgId, [cond], obs);
      const r = engine.evaluateCondition(cond, obs);
      await engine.flushPersistence(orgId);
      return r;
    });

    // Starts from zero rather than inheriting the live latch.
    expect(dryResult.passed).toBe(false);
    expect(dryResult.persistence?.hits).toBe(1);

    const afterRows = await pool.query(
      `SELECT hits, misses, latched FROM spatial_condition_state
       WHERE organization_id=$1 AND subject_id='vessel-live'`,
      [orgId]
    );
    // Live state untouched — this is what stops "test rule" corrupting a real
    // vessel's confirmation progress.
    expect(afterRows.rows[0]).toMatchObject({ hits: 2, latched: true });
  });

  it("restores live state even when the dry run throws", async () => {
    const engine = newEngine();
    await tick(engine, "vessel-throw");

    await expect(
      engine.withIsolatedPersistence(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    // The live map and store must be back, so evaluation still persists.
    const result = await tick(engine, "vessel-throw");
    expect(result.persistence?.hits).toBe(2);
  });
});

describe("pruning", () => {
  it("drops stale unlatched rows but keeps latched ones", async () => {
    const engine = newEngine();
    await tick(engine, "stale-unlatched"); // 1/2, not latched
    await tick(engine, "stale-latched");
    await tick(engine, "stale-latched"); // latched

    // Age both well past the unlatched cutoff.
    await pool.query(
      `UPDATE spatial_condition_state SET last_seen_at = now() - interval '10 days'
       WHERE organization_id = $1`,
      [orgId]
    );

    await spatialPersistenceStore.prune();

    const rows = await pool.query(
      `SELECT subject_id, latched FROM spatial_condition_state WHERE organization_id=$1`,
      [orgId]
    );
    // A latched geofence is live state — dropping it would re-fire ON_ENTER for
    // an asset still sitting in the zone.
    expect(rows.rows.map((r) => r.subject_id)).toEqual(["stale-latched"]);
  });
});
