import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const migrationsFolder = process.env.DRIZZLE_MIGRATIONS_FOLDER || "migrations/runtime";
const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const baseline = journal.entries.find((entry) => /baseline$/i.test(entry.tag));
if (!baseline) throw new Error(`No baseline entry found in ${journalPath}`);

const migrationPath = path.join(migrationsFolder, `${baseline.tag}.sql`);
const hash = crypto.createHash("sha256").update(fs.readFileSync(migrationPath)).digest("hex");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
    const verification = await pool.query(`
        SELECT
          to_regclass('public.orgs') IS NOT NULL AS has_orgs,
          to_regclass('public.users') IS NOT NULL AS has_users,
          to_regclass('public.capability_sync_state') IS NOT NULL AS has_capability_state,
          to_regclass('public.cycle_run_events') IS NOT NULL AS has_cycle_run_events,
          to_regclass('public.ontology_object_types') IS NOT NULL AS has_ontology_object_types,
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'capability_sync_state'
              AND column_name = 'capability_version'
          ) AS has_capability_version
    `);
    const state = verification.rows[0];
    if (
        !state.has_orgs
        || !state.has_users
        || !state.has_capability_state
        || !state.has_capability_version
        || !state.has_cycle_run_events
        || !state.has_ontology_object_types
    ) {
        throw new Error(
            "Refusing to baseline: the existing database does not match the required current-schema sentinels " +
            `(orgs=${state.has_orgs}, users=${state.has_users}, capability_sync_state=${state.has_capability_state}, ` +
            `capability_version=${state.has_capability_version}, cycle_run_events=${state.has_cycle_run_events}, ` +
            `ontology_object_types=${state.has_ontology_object_types}). ` +
            "Use db:migrate on an empty database or reconcile the legacy schema before baselining.",
        );
    }

    await pool.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await pool.query(`
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
          id serial PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
    `);
    const existing = await pool.query(
        "SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1",
    );
    const latestCreatedAt = existing.rows.length > 0 ? Number(existing.rows[0].created_at) : null;
    if (latestCreatedAt != null && latestCreatedAt >= baseline.when) {
        console.log(`Migration ledger already initialized at ${latestCreatedAt}; no baseline change needed.`);
    } else {
        await pool.query(
            "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
            [hash, baseline.when],
        );
        console.log(`Recorded existing database at baseline ${baseline.tag} (${baseline.when}).`);
    }
} finally {
    await pool.end();
}
