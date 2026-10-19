import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@shared/schema/index.js";

/**
 * Applies the runtime migration chain (migrations/runtime) to `databaseUrl`.
 * Shared by `npm run db:migrate` (server/migrate.ts) and `npm run setup`
 * (server/setup.ts). Throws on failure; describeMigrationError() turns the
 * error into operator guidance.
 */
export async function runMigrations(
    databaseUrl: string,
    migrationsFolder: string = process.env.DRIZZLE_MIGRATIONS_FOLDER || "migrations/runtime",
): Promise<void> {
    // A separate single-connection pool, so migrations never share the app's.
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
        await migrate(drizzle(pool, { schema }), { migrationsFolder });
    } finally {
        await pool.end();
    }
}

/**
 * Tags of the migrations runMigrations() would apply, read without writing.
 *
 * Mirrors drizzle's own rule: a journal entry is pending when its `when` is
 * later than the newest `created_at` in drizzle.__drizzle_migrations (it does
 * not compare hashes). No table means nothing has been applied.
 */
export async function pendingMigrations(
    pool: Pool,
    migrationsFolder: string = process.env.DRIZZLE_MIGRATIONS_FOLDER || "migrations/runtime",
): Promise<string[]> {
    const journal = JSON.parse(
        fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: { when: number; tag: string }[] };

    const { rows } = await pool.query<{ exists: boolean }>(
        "select to_regclass('drizzle.__drizzle_migrations') is not null as exists",
    );
    let last = -Infinity;
    if (rows[0]?.exists) {
        const latest = await pool.query<{ created_at: string | null }>(
            "select max(created_at)::text as created_at from drizzle.__drizzle_migrations",
        );
        if (latest.rows[0]?.created_at != null) last = Number(latest.rows[0].created_at);
    }
    return journal.entries.filter((e) => e.when > last).map((e) => e.tag);
}

export function redactDatabaseUrl(url: string): string {
    return url.replace(/:[^:@]+@/, ":****@");
}

/** Lines to print after a failed migration: the error, then what to do. */
export function describeMigrationError(err: any): string[] {
    const lines = [`❌ Migration failed with error: ${err?.message ?? err}`];
    if (err?.detail) lines.push(`Detail: ${err.detail}`);
    if (err?.where) lines.push(`Where: ${err.where}`);
    if (err?.query) lines.push(`Query: ${err.query}`);

    // 42P07 is "relation already exists": the baseline's bare CREATE TABLEs
    // cannot replay onto a database that already has those tables, so drizzle
    // aborts on the first collision and nothing is applied or recorded.
    //
    // This used to be downgraded to a warning with an exit 0. That branch
    // never actually fired -- drizzle wraps the pg error, so the code lives on
    // err.cause.code and the top-level err.code is undefined -- meaning the
    // real behaviour was always a loud exit 1 with a raw stack and no guidance
    // about what to do. A dev database sat 372 tables behind the schema
    // because that failure was hit and abandoned rather than resolved.
    //
    // So: keep failing (a migration that did not apply is a failure), but
    // read the code where it actually is and say what the operator should do.
    const pgCode = err?.code ?? err?.cause?.code;
    if (pgCode === "42P07") {
        lines.push(
            "",
            "❌ A migration collided with an object that already exists (42P07).",
            "   Nothing was applied and nothing was recorded, so the database is",
            "   NOT at the schema the migration chain describes.",
            "   This usually means the database was created outside the migration",
            "   chain (e.g. `drizzle-kit push`) and the baseline cannot replay onto it.",
            "   Recreate the database and re-run, or reconcile it by hand.",
            "",
        );
    }
    return lines;
}
