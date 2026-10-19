import dotenv from "dotenv";
dotenv.config({ override: true });
import pg from "pg";
import { readFileSync } from "fs";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const sql = readFileSync("./migrations/0066_funny_puppet_master.sql", "utf-8");

// Split on drizzle breakpoint markers
const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

// Codes that mean "already done" — safe to skip
const SKIP_CODES = new Set([
    "42P07", // relation already exists
    "42701", // column already exists
    "42710", // index already exists
    "42P16", // invalid_table_definition (constraint already there)
    "42P01", // undefined_table (for IF EXISTS drops)
    "23505", // unique_violation when inserting seed data
]);

console.log(`Applying ${statements.length} statements from 0066_funny_puppet_master.sql...`);
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

await pool.end();

console.log(`\nDone: ${applied} applied, ${skipped} skipped (already exist), ${failed} failed.`);
if (failed > 0) {
    console.error("❌ Some statements failed. Check errors above.");
    process.exit(1);
} else {
    console.log("✅ Migration 0066 complete.");
}
