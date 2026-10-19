/**
 * Provision the integration-test database.
 *
 * Idempotent and safe to re-run: creates the database if absent, applies the
 * runtime migration chain, and seeds the baseline rows the integration suites
 * assume exist (notably org 1, which several tests reference as the "default test
 * org" without creating it).
 *
 * Reads TEST_DATABASE_URL from .env.test. That file is gitignored, so local
 * credentials never reach the repository. The same guard the test runner uses is
 * applied here, so this can never point at a dev or production database.
 *
 * Usage:
 *   npm run test:db:setup
 *   npx tsx scripts/setup-test-db.ts --drop   # recreate from scratch
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";
import { execFileSync } from "node:child_process";
import { assertSafeTestDatabaseUrl } from "../tests/configure-test-environment.js";

loadEnv({ path: ".env.test", override: true });

const DEFAULT_URL = "postgresql://oddjob_test@127.0.0.1:5432/oddjob_test";

async function main() {
    const url = (process.env.TEST_DATABASE_URL || DEFAULT_URL).trim();

    // Same refusal the vitest bootstrap applies: the database name must carry a
    // distinct "test" segment, so a dev/prod URL cannot be provisioned by mistake.
    assertSafeTestDatabaseUrl(url);

    const parsed = new URL(url);
    const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    const adminUrl = new URL(url);
    adminUrl.pathname = "/postgres";

    console.log(`Target: ${parsed.protocol}//${parsed.username}:****@${parsed.hostname}:${parsed.port}/${dbName}`);

    const admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();

    if (process.argv.includes("--drop")) {
        // Terminate stragglers first; DROP DATABASE fails while sessions are attached.
        await admin.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [dbName],
        );
        await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
        console.log(`dropped ${dbName}`);
    }

    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (exists.rows.length === 0) {
        await admin.query(`CREATE DATABASE "${dbName}"`);
        console.log(`created ${dbName}`);
    } else {
        console.log(`${dbName} already exists`);
    }
    await admin.end();

    // Apply the runtime migration chain against the test database.
    console.log("applying migrations…");
    execFileSync("npx", ["tsx", "server/migrate.ts"], {
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL: url },
        shell: process.platform === "win32",
    });

    // Baseline fixtures. Integration tests reference org 1 directly rather than
    // creating it, so without this they fail on a foreign-key violation against orgs.
    const target = new Client({ connectionString: url });
    await target.connect();
    await target.query(`
        INSERT INTO orgs (org_id, name)
        VALUES (1, 'Test Organization')
        ON CONFLICT (org_id) DO NOTHING
    `);
    // Keep the sequence ahead of the explicit id, or the next natural insert collides.
    await target.query(`
        SELECT setval(
            pg_get_serial_sequence('orgs', 'org_id'),
            GREATEST((SELECT COALESCE(MAX(org_id), 1) FROM orgs), 1)
        )
    `);

    const orgs = await target.query("SELECT org_id, name FROM orgs ORDER BY org_id LIMIT 5");
    const tables = await target.query(
        "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
    );
    await target.end();

    console.log(`\ntables: ${tables.rows[0].n}`);
    console.log(`orgs:   ${orgs.rows.map((r: any) => `${r.org_id}:${r.name}`).join(", ")}`);
    console.log("\nTest database ready.");
}

main().catch((e) => {
    console.error("setup-test-db failed:", e?.message ?? e);
    process.exit(1);
});
