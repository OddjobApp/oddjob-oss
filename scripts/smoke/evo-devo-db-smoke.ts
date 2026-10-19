/**
 * Evo-devo, exercised against a real database.
 *
 * WHY THIS EXISTS
 *
 * The evo-devo services are written against an injected `EvoDevoStore`, and the
 * unit tests supply an in-memory implementation. That is good design and the 26
 * tests are worth having — but it means the half that talks to postgres is
 * completely unexercised. Nothing had ever run `DrizzleEvoDevoStore`, and none
 * of the guarantees that live in the MIGRATIONS rather than the code had been
 * tested at all:
 *
 *   - the replay unique index on (genome, environment, compiler, seed), which is
 *     what makes development reproducible rather than merely deterministic
 *   - ON DELETE RESTRICT on lineage and phenotype references, which is what
 *     stops history being erased by a cascade
 *   - the immutability trigger on stage events, which is what makes the
 *     lifecycle an audit log rather than a mutable status column
 *
 * A green unit suite tells you the algebra is right. It cannot tell you the
 * schema agrees, and those are different failures.
 *
 * `package.json` already declared `smoke:evo-devo-db` pointing here; the file
 * was never written.
 *
 * Runs against the TEST database only, via requireTestDatabaseUrl — it writes
 * real rows and cleans up after itself.
 *
 * Usage:  npm run smoke:evo-devo-db
 */

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

loadEnv({ path: ".env.test", override: true });

const { configureTestEnvironment } = await import("../../tests/configure-test-environment.js");
const { databaseUrl } = configureTestEnvironment();
process.env.DATABASE_URL = databaseUrl;

// Imported after DATABASE_URL is set, so the services' pool points at the test
// database rather than whatever .env happened to carry.
const { EvoDevoService, DrizzleEvoDevoStore } = await import(
  "../../server/domain/evolution/core/evo-devo.service.js"
);

/**
 * This smoke verifies PERSISTENCE, so capability existence is stubbed.
 *
 * The exported singleton checks genome capabilities against the real registry,
 * which is correct in production and wrong here: it would make every assertion
 * below depend on Qdrant holding a capability named `triage`, so a green run
 * would mean "the registry happens to be seeded" rather than "the schema
 * behaves". The registry check has its own tests, and one negative assertion
 * against the real contract is made explicitly at the end.
 */
const evoDevoService = new EvoDevoService(new DrizzleEvoDevoStore(), {
  findUnregistered: async () => [],
});
const { evolutionPopulationService } = await import(
  "../../server/domain/evolution/core/evolution-population.service.js"
);
const { evolutionLifecycleService } = await import(
  "../../server/domain/evolution/core/evolution-lifecycle.service.js"
);

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Asserts a promise rejects, which is how the schema-level guarantees show up. */
async function expectRejection(label: string, fn: () => Promise<unknown>, match?: RegExp): Promise<void> {
  try {
    await fn();
    check(label, false, "expected a rejection, but it succeeded");
  } catch (err: any) {
    const message = String(err?.message ?? err);
    check(label, match ? match.test(message) : true, match ? `got: ${message.slice(0, 120)}` : "");
  }
}

async function main(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const orgResult = await pool.query(
    `INSERT INTO orgs (name) VALUES ($1) RETURNING org_id`,
    [`evo-devo-smoke-${suffix}`],
  );
  const orgId: number = orgResult.rows[0].org_id;
  const otherOrgResult = await pool.query(
    `INSERT INTO orgs (name) VALUES ($1) RETURNING org_id`,
    [`evo-devo-smoke-other-${suffix}`],
  );
  const otherOrgId: number = otherOrgResult.rows[0].org_id;

  console.log(`\nevo-devo DB smoke — org ${orgId} on ${new URL(databaseUrl).pathname}\n`);

  try {
    // ---------------------------------------------------------------- register
    const environment = {
      schemaVersion: "1.0.0",
      id: `sandbox-${suffix}`,
      capabilities: ["triage"],
      allowedPermissions: ["read"],
      signals: {},
      maxSteps: 5,
    };
    const genome = {
      schemaVersion: "1.0.0",
      id: `founder-${suffix}`,
      speciesId: "support",
      steps: [
        { id: "triage", kind: "agent", capability: "triage", dependsOn: [], config: {}, permissions: ["read"] },
      ],
      developmentalRules: [],
      protectedLoci: [],
      metadata: {},
    };

    const storedEnv = await evoDevoService.registerEnvironment(orgId, environment);
    check("registers a development environment", !!storedEnv.id);

    const storedGenome = await evoDevoService.registerFounderGenome(orgId, genome);
    check("registers a founder genome", !!storedGenome.id);

    // ---------------------------------------------------------------- develop
    const phenotype = await evoDevoService.develop(orgId, genome.id, environment.id, 9);
    check("develops a genome into a phenotype", !!phenotype.id);

    const hashRow = await pool.query(
      `SELECT content_hash, seed, compiler_version FROM evo_devo_phenotypes WHERE id = $1`,
      [phenotype.id],
    );
    check("phenotype persists a content hash", !!hashRow.rows[0]?.content_hash);
    check("phenotype records the seed it was grown with", hashRow.rows[0]?.seed === 9);

    // Reproducibility: the same genome, environment, compiler and seed must not
    // be storable twice. This is the migration's replay unique index, and it is
    // the difference between "deterministic" and "provably reproducible".
    // No message matcher: drizzle wraps the pg error and the "duplicate key"
    // text does not survive into `err.message`. What matters is that the write
    // is refused, and the index is verified directly below.
    await expectRejection(
      "refuses a duplicate (genome, environment, compiler, seed) replay",
      () => evoDevoService.develop(orgId, genome.id, environment.id, 9),
    );

    const replayIndex = await pool.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'evo_devo_phenotype_replay_unique'`,
    );
    check(
      "the replay guarantee is a UNIQUE index, not just application logic",
      /UNIQUE/i.test(replayIndex.rows[0]?.indexdef ?? ""),
      replayIndex.rows[0]?.indexdef ?? "index missing",
    );

    // A different seed is a different developmental path and IS allowed.
    const phenotypeSeed10 = await evoDevoService.develop(orgId, genome.id, environment.id, 10);
    check("allows a different seed as a distinct phenotype", phenotypeSeed10.id !== phenotype.id);

    // ---------------------------------------------------------------- lineage
    const child = await evoDevoService.createChild(orgId, genome.id, `child-${suffix}`, {
      type: "replace_step_config",
      stepId: "triage",
      config: { retries: 3 },
    });
    check("creates a mutated descendant genome", !!child.id && child.id !== storedGenome.id);

    const lineage = await evoDevoService.getLineage(orgId, `child-${suffix}`);
    check("reports the child's parent lineage", lineage.parents.some((p: any) => p.id === storedGenome.id));

    // History must not be erasable by a cascade: the parent is referenced with
    // ON DELETE RESTRICT precisely so ancestry survives.
    await expectRejection(
      "refuses to delete a genome that has descendants",
      () => pool.query(`DELETE FROM evo_devo_genomes WHERE id = $1`, [storedGenome.id]),
      /foreign key|violates/i,
    );

    // ------------------------------------------------------------ tenant scope
    await expectRejection(
      "does not resolve another organisation's genome",
      () => evoDevoService.develop(otherOrgId, genome.id, environment.id, 1),
      /not found/i,
    );

    // ------------------------------------------------------------- population
    const population = await evolutionPopulationService.createPopulation(orgId, {
      populationKey: `pop-${suffix}`,
      speciesId: "support",
      constraints: {
        minimumSafety: 0.5,
        minimumReliability: 0.5,
        minimumSampleSize: 1,
      },
    });
    check("creates a population", !!population);

    await evolutionPopulationService.addMember(orgId, `pop-${suffix}`, phenotype.id, 0);
    const members = await pool.query(
      `SELECT count(*)::int n FROM evo_devo_population_members WHERE phenotype_id = $1`,
      [phenotype.id],
    );
    check("admits a phenotype into the population", members.rows[0].n === 1);

    // ------------------------------------------------------------- evaluation
    await evolutionPopulationService.recordEvaluation(orgId, phenotype.id, {
      evaluatorKey: "smoke",
      evaluatorVersion: "1.0.0",
      fitness: {
        outcome: 0.9,
        reliability: 0.9,
        safety: 0.95,
        humanExperience: 0.8,
        costUsd: 0.02,
        latencyMs: 1200,
        sampleSize: 25,
      },
      eligible: true,
      ineligibilityReasons: [],
      evidence: { source: "smoke" },
    });
    const evals = await pool.query(
      `SELECT fitness, eligible, ineligibility_reasons FROM evo_devo_evaluations WHERE phenotype_id = $1`,
      [phenotype.id],
    );
    check("records an evaluation against the phenotype", evals.rows.length === 1);
    check(
      "stores the fitness vector as jsonb",
      !!evals.rows[0] && typeof evals.rows[0].fitness === "object",
    );
    check(
      "stores ineligibility reasons as a text array",
      Array.isArray(evals.rows[0]?.ineligibility_reasons),
    );

    // -------------------------------------------------------------- lifecycle
    const initial = await evolutionLifecycleService.initialize(orgId, phenotype.id, "smoke-actor");
    check("initialises the phenotype lifecycle", !!initial);

    const stage = await evolutionLifecycleService.getCurrentStage(orgId, phenotype.id);
    check("reports a current stage after initialisation", !!stage);

    const stageRows = await pool.query(
      `SELECT id, to_stage, action FROM evo_devo_stage_events WHERE phenotype_id = $1 ORDER BY created_at`,
      [phenotype.id],
    );
    check("writes a stage event", stageRows.rows.length >= 1);
    check("first stage event is an initialize", stageRows.rows[0]?.action === "initialize");

    // The lifecycle is an audit trail. The migration installs an immutability
    // trigger so a stage event cannot be rewritten after the fact — without it
    // "what happened" would be editable and the log would be worthless.
    await expectRejection(
      "rejects UPDATE on a stage event (immutability trigger)",
      () =>
        pool.query(`UPDATE evo_devo_stage_events SET actor_id = 'tampered' WHERE id = $1`, [
          stageRows.rows[0].id,
        ]),
      /immutab|cannot|not allowed|reject/i,
    );

    const afterTamper = await pool.query(
      `SELECT actor_id FROM evo_devo_stage_events WHERE id = $1`,
      [stageRows.rows[0].id],
    );
    check("stage event actor survives the rejected update", afterTamper.rows[0].actor_id === "smoke-actor");

    // Capability validation is asserted here for its DB-visible consequence:
    // a refused genome must leave NOTHING behind. The rule itself is unit
    // tested; what those tests cannot show is that the write is refused BEFORE
    // the insert rather than rolled back after (or worse, left half-applied).
    const strictService = new EvoDevoService(new DrizzleEvoDevoStore(), {
      findUnregistered: async (_org, ids) => ids,
    });
    await expectRejection(
      "refuses a genome naming capabilities the registry does not hold",
      () =>
        strictService.registerFounderGenome(orgId, {
          ...genome,
          id: `unregistered-${suffix}`,
        }),
      /unregistered capabilit/i,
    );
    const ghost = await pool.query(
      `SELECT 1 FROM evo_devo_genomes WHERE organization_id = $1 AND genome_key = $2`,
      [orgId, `unregistered-${suffix}`],
    );
    check("the refused genome was never persisted", ghost.rows.length === 0);
  } finally {
    // Ordered by dependency: RESTRICT references mean children must go first.
    await pool.query(`DELETE FROM evo_devo_stage_events WHERE organization_id = ANY($1)`, [[orgId, otherOrgId]]);
    await pool.query(`DELETE FROM evo_devo_selection_runs WHERE organization_id = ANY($1)`, [[orgId, otherOrgId]]);
    await pool.query(
      `DELETE FROM evo_devo_population_members WHERE population_id IN
         (SELECT id FROM evo_devo_populations WHERE organization_id = ANY($1))`,
      [[orgId, otherOrgId]],
    );
    await pool.query(`DELETE FROM evo_devo_populations WHERE organization_id = ANY($1)`, [[orgId, otherOrgId]]);
    await pool.query(`DELETE FROM evo_devo_evaluations WHERE organization_id = ANY($1)`, [[orgId, otherOrgId]]);
    await pool.query(`DELETE FROM evo_devo_phenotypes WHERE organization_id = ANY($1)`, [[orgId, otherOrgId]]);
    await pool.query(
      `DELETE FROM evo_devo_genome_parents WHERE child_genome_id IN
         (SELECT id FROM evo_devo_genomes WHERE organization_id = ANY($1))`,
      [[orgId, otherOrgId]],
    );
    await pool.query(`DELETE FROM evo_devo_genomes WHERE organization_id = ANY($1)`, [[orgId, otherOrgId]]);
    await pool.query(`DELETE FROM evo_devo_environments WHERE organization_id = ANY($1)`, [[orgId, otherOrgId]]);
    await pool.query(`DELETE FROM orgs WHERE org_id = ANY($1)`, [[orgId, otherOrgId]]);
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("evo-devo persistence layer verified against a real database.\n");

  // Exit explicitly. The services share the application's connection pool from
  // `database_service`, which is a module singleton with no exported close —
  // it is built to live for the lifetime of a server, not a script. Without
  // this the process hangs after reporting success, which reads exactly like a
  // failing smoke and is the more confusing outcome.
  process.exit(0);
}

main().catch((err) => {
  console.error("\nevo-devo smoke failed to run:", err?.message ?? err);
  process.exit(2);
});
