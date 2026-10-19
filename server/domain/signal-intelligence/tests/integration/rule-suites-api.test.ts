/**
 * Rule suite persistence, against a real database.
 *
 * The questions worth asking here are not "does the handler return 200" but
 * whether the scoping actually holds. `rule_specifications` carries no
 * organization_id, so a rule is only ever
 * reachable through its suite — one missing filter and a tenant reads another
 * tenant's rules. A mocked database would assert my own assumptions about the
 * join rather than the join.
 *
 * Runs against the test database only, via requireTestDatabaseUrl.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { requireTestDatabaseUrl } from "../../../../../tests/configure-test-environment.js";

const databaseUrl = requireTestDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;

const pool = new Pool({ connectionString: databaseUrl });

const ids = {
  orgA: 0,
  orgB: 0,
  projectA1: 0,
  projectA2: 0,
};

const suffix = Date.now();

beforeAll(async () => {
  const a = await pool.query(`INSERT INTO orgs (name) VALUES ($1) RETURNING org_id`, [
    `rulesuite-a-${suffix}`,
  ]);
  ids.orgA = a.rows[0].org_id;
  const b = await pool.query(`INSERT INTO orgs (name) VALUES ($1) RETURNING org_id`, [
    `rulesuite-b-${suffix}`,
  ]);
  ids.orgB = b.rows[0].org_id;

  const p1 = await pool.query(
    `INSERT INTO projects (organization_id, key, name, visibility, created_by)
     VALUES ($1,$2,$3,'open','test') RETURNING id`,
    [ids.orgA, `proj-a1-${suffix}`, "Project A1"]
  );
  ids.projectA1 = p1.rows[0].id;
  const p2 = await pool.query(
    `INSERT INTO projects (organization_id, key, name, visibility, created_by)
     VALUES ($1,$2,$3,'open','test') RETURNING id`,
    [ids.orgA, `proj-a2-${suffix}`, "Project A2"]
  );
  ids.projectA2 = p2.rows[0].id;
});

afterAll(async () => {
  // Suites and specs cascade from the org FK.
  await pool.query(`DELETE FROM orgs WHERE org_id = ANY($1::int[])`, [[ids.orgA, ids.orgB]]);
  await pool.end();
});

async function insertSuite(orgId: number, projectId: number | null, suiteId: string) {
  const r = await pool.query(
    `INSERT INTO rule_suites (organization_id, project_id, suite_id, suite_name)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [orgId, projectId, suiteId, `Suite ${suiteId}`]
  );
  return r.rows[0].id as number;
}

// ===========================================================================
// SCHEMA GUARANTEES
// ===========================================================================

describe("rule table constraints", () => {
  it("scopes suite identity to organization and project", async () => {
    const sharedId = `shared-${suffix}`;
    await insertSuite(ids.orgA, ids.projectA1, sharedId);
    await insertSuite(ids.orgA, ids.projectA2, sharedId);
    await insertSuite(ids.orgB, null, sharedId);

    await expect(insertSuite(ids.orgA, ids.projectA1, sharedId)).rejects.toThrow(/duplicate key|unique/i);
  });

  it("rolls back suite creation when its rule write fails", async () => {
    const suiteId = `atomic-${suffix}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const suite = await client.query(
        `INSERT INTO rule_suites (organization_id, project_id, suite_id, suite_name)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [ids.orgA, ids.projectA1, suiteId, "Atomic suite"]
      );
      await expect(client.query(
        `INSERT INTO rule_specifications (suite_db_id, rule_id, rule_name, specification)
         VALUES ($1,NULL,'Broken','{}'::jsonb)`,
        [suite.rows[0].id]
      )).rejects.toThrow();
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    const left = await pool.query(`SELECT 1 FROM rule_suites WHERE suite_id = $1`, [suiteId]);
    expect(left.rowCount).toBe(0);
  });
  it("enforces one rule per (suite, ruleId) so a replayed save cannot duplicate", async () => {
    const suiteDbId = await insertSuite(ids.orgA, ids.projectA1, `dup-${suffix}`);

    await pool.query(
      `INSERT INTO rule_specifications (suite_db_id, rule_id, rule_name, specification)
       VALUES ($1,'r1','Rule One','{}'::jsonb)`,
      [suiteDbId]
    );

    // The unique index is what makes the PUT upsert idempotent; without it the
    // runtime-created table silently accumulated duplicates.
    await expect(
      pool.query(
        `INSERT INTO rule_specifications (suite_db_id, rule_id, rule_name, specification)
         VALUES ($1,'r1','Rule One Again','{}'::jsonb)`,
        [suiteDbId]
      )
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("cascades rule deletion when its suite is removed", async () => {
    const suiteDbId = await insertSuite(ids.orgA, ids.projectA1, `cascade-${suffix}`);
    await pool.query(
      `INSERT INTO rule_specifications (suite_db_id, rule_id, rule_name, specification)
       VALUES ($1,'r1','R','{}'::jsonb)`,
      [suiteDbId]
    );

    await pool.query(`DELETE FROM rule_suites WHERE id = $1`, [suiteDbId]);

    const left = await pool.query(
      `SELECT 1 FROM rule_specifications WHERE suite_db_id = $1`,
      [suiteDbId]
    );
    expect(left.rowCount).toBe(0);
  });

  it("nulls a suite's project rather than deleting the suite when a project goes", async () => {
    const doomed = await pool.query(
      `INSERT INTO projects (organization_id, key, name, visibility, created_by)
       VALUES ($1,$2,$3,'open','test') RETURNING id`,
      [ids.orgA, `proj-doomed-${suffix}`, "Doomed"]
    );
    const projectId = doomed.rows[0].id;
    const suiteDbId = await insertSuite(ids.orgA, projectId, `orphan-${suffix}`);

    await pool.query(`DELETE FROM projects WHERE id = $1`, [projectId]);

    const row = await pool.query(
      `SELECT project_id FROM rule_suites WHERE id = $1`,
      [suiteDbId]
    );
    // Losing a project must not silently destroy the rules written in it.
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].project_id).toBeNull();
  });
});

// ===========================================================================
// SCOPING — the queries the routes actually issue
// ===========================================================================

describe("tenant and project scoping", () => {
  it("does not resolve another org's suite by id", async () => {
    const sharedId = `crosstenant-${suffix}`;
    await insertSuite(ids.orgB, null, sharedId);

    // This mirrors findSuite(): filter on suiteId AND organizationId.
    const wrongTenant = await pool.query(
      `SELECT id FROM rule_suites WHERE suite_id = $1 AND organization_id = $2`,
      [sharedId, ids.orgA]
    );
    expect(wrongTenant.rowCount).toBe(0);

    const rightTenant = await pool.query(
      `SELECT id FROM rule_suites WHERE suite_id = $1 AND organization_id = $2`,
      [sharedId, ids.orgB]
    );
    expect(rightTenant.rowCount).toBe(1);

    // Filtering on suite_id alone — the bug this guards — WOULD have found it.
    const unscoped = await pool.query(`SELECT id FROM rule_suites WHERE suite_id = $1`, [
      sharedId,
    ]);
    expect(unscoped.rowCount).toBe(1);
  });

  it("hides a sibling project's suite but keeps org-wide (null-project) suites", async () => {
    await insertSuite(ids.orgA, ids.projectA1, `in-a1-${suffix}`);
    await insertSuite(ids.orgA, ids.projectA2, `in-a2-${suffix}`);
    await insertSuite(ids.orgA, null, `legacy-${suffix}`);

    // Mirrors scopeOf(): org AND (project = current OR project IS NULL).
    const visible = await pool.query(
      `SELECT suite_id FROM rule_suites
       WHERE organization_id = $1 AND (project_id = $2 OR project_id IS NULL)`,
      [ids.orgA, ids.projectA1]
    );
    const names = visible.rows.map((r) => r.suite_id);

    expect(names).toContain(`in-a1-${suffix}`);
    // A legacy suite predating project scoping must not vanish from the UI.
    expect(names).toContain(`legacy-${suffix}`);
    expect(names).not.toContain(`in-a2-${suffix}`);
  });

  it("counts rules only for in-scope suites", async () => {
    const mine = await insertSuite(ids.orgA, ids.projectA1, `count-mine-${suffix}`);
    const theirs = await insertSuite(ids.orgB, null, `count-theirs-${suffix}`);

    await pool.query(
      `INSERT INTO rule_specifications (suite_db_id, rule_id, rule_name, specification)
       VALUES ($1,'a','A','{}'::jsonb), ($1,'b','B','{}'::jsonb)`,
      [mine]
    );
    await pool.query(
      `INSERT INTO rule_specifications (suite_db_id, rule_id, rule_name, specification)
       VALUES ($1,'x','X','{}'::jsonb)`,
      [theirs]
    );

    // The list handler counts with inArray over in-scope suite ids only; an
    // unfiltered count would read across tenants.
    const counts = await pool.query(
      `SELECT suite_db_id, count(*)::int AS n FROM rule_specifications
       WHERE suite_db_id = ANY($1::int[]) GROUP BY suite_db_id`,
      [[mine]]
    );
    expect(counts.rows).toHaveLength(1);
    expect(counts.rows[0].n).toBe(2);
  });
});
