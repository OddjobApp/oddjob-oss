import dotenv from "dotenv";
dotenv.config({ override: true });
import pg from "pg";
import { readFileSync } from "fs";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const sql = readFileSync("./migrations/0070_capability_sync_state.sql", "utf-8");

// This migration uses PL/pgSQL DO blocks (no drizzle breakpoint markers), so it
// is applied as a single idempotent batch. Every statement is IF NOT EXISTS /
// EXCEPTION-guarded, so re-running is a no-op.
const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

const SKIP_CODES = new Set([
    "42P07", // relation already exists
    "42701", // column already exists
    "42710", // index already exists
    "42P16", // constraint already there
    "42P01", // undefined_table (for IF EXISTS drops)
    "23505", // unique_violation
]);

const masked = (process.env.DATABASE_URL || "").replace(/:[^:@]+@/, ":****@");
console.log(`Applying 0070_capability_sync_state.sql to ${masked}`);
console.log(`(${statements.length} batch statement(s))`);

let applied = 0, skipped = 0, failed = 0;
for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.slice(0, 70).replace(/\n/g, " ");
    const client = await pool.connect();
    try {
        await client.query(stmt);
        process.stdout.write(`  ✓ [${i + 1}/${statements.length}] ${preview}\n`);
        applied++;
    } catch (err) {
        if (SKIP_CODES.has(err.code)) {
            process.stdout.write(`  ~ [${i + 1}/${statements.length}] SKIP (${err.code}): ${preview}\n`);
            skipped++;
        } else {
            process.stdout.write(`  ✗ [${i + 1}/${statements.length}] FAIL (${err.code}): ${preview}\n`);
            console.error("    →", err.message);
            if (err.detail) console.error("    Detail:", err.detail);
            failed++;
        }
    } finally {
        client.release();
    }
}

// Verify the tables now exist.
const check = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_name IN ('capability_sync_state','capability_doc_file_state')
     ORDER BY table_name`,
);
console.log(`\nTables present: ${check.rows.map((r) => r.table_name).join(", ") || "(none)"}`);

await pool.end();
console.log(`Done: ${applied} applied, ${skipped} skipped, ${failed} failed.`);
if (failed > 0) process.exit(1);
console.log("✅ Migration 0070 complete.");
