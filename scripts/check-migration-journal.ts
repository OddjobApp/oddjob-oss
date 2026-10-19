/**
 * Guards the migration journal against the failure mode fixed in c7f92fce9.
 *
 * migrations/runtime/meta/_journal.json had acquired a UTF-8 BOM. Drizzle reads
 * that file with JSON.parse, which rejects a leading BOM, so readMigrationFiles
 * threw before applying anything. Nine migrations sat unapplied -- including the
 * baseline drift repair -- while the schema and the journal both looked correct.
 * Nothing surfaced it except the migrator's own stack trace.
 *
 * `.gitattributes` cannot prevent this: Git has no attribute that strips a BOM.
 * So this check runs in `npm run verify`.
 *
 * It also catches two adjacent ways the chain goes dark, both of which have bitten
 * this repo before: a journal entry whose .sql file is missing, and duplicate idx
 * values from colliding migration numbers.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import path from "path";

const RUNTIME_DIR = path.join(process.cwd(), "migrations", "runtime");
const JOURNAL_PATH = path.join(RUNTIME_DIR, "meta", "_journal.json");

const errors: string[] = [];
const warnings: string[] = [];

if (!existsSync(JOURNAL_PATH)) {
    console.error(`[check-migration-journal] Journal not found at ${JOURNAL_PATH}`);
    process.exit(1);
}

const raw = readFileSync(JOURNAL_PATH);

// 1. The BOM itself. Checked on bytes, because reading as utf-8 can hide it.
if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    errors.push(
        "meta/_journal.json begins with a UTF-8 BOM (ef bb bf). Drizzle's JSON.parse " +
        "rejects it and the migrator aborts before applying any migration. Strip the " +
        "first three bytes. If you wrote this file from PowerShell, note that Out-File " +
        "and Set-Content default to UTF-8 with BOM."
    );
}

// 2. Still valid JSON at all.
let journal: { entries?: { idx: number; tag: string; when: number }[] } | undefined;
try {
    journal = JSON.parse(raw.toString("utf-8").replace(/^﻿/, ""));
} catch (err: any) {
    errors.push(`meta/_journal.json is not valid JSON: ${err.message}`);
}

if (journal) {
    const entries = journal.entries ?? [];

    // 3. Every journal entry has a matching .sql file. A missing one means the
    //    migrator advances its cursor past work that never existed.
    for (const entry of entries) {
        const sqlPath = path.join(RUNTIME_DIR, `${entry.tag}.sql`);
        if (!existsSync(sqlPath)) {
            errors.push(`Journal entry idx ${entry.idx} ("${entry.tag}") has no ${entry.tag}.sql`);
        }
    }

    // 4. Duplicate idx values. Warned, not failed: the runtime migrator orders by
    //    `when`, not by idx, so a collision does not stop anything applying -- idx 63
    //    is doubled today (0063_spatial_rule_governance / 0063_agent_deployment_project_scope)
    //    and both ran. It stays a smell worth seeing, because colliding numbers are
    //    how migrations have previously been orphaned from the journal, but failing
    //    the build over a historical collision would just block every verify run.
    const seen = new Map<number, string>();
    for (const entry of entries) {
        const prior = seen.get(entry.idx);
        if (prior) {
            warnings.push(`Duplicate journal idx ${entry.idx}: "${prior}" and "${entry.tag}" (both apply; ordered by \`when\`)`);
        }
        seen.set(entry.idx, entry.tag);
    }

    // 5. Every .sql file is actually journaled. An unjournaled migration never runs.
    const journaled = new Set(entries.map(e => `${e.tag}.sql`));
    const onDisk = readdirSync(RUNTIME_DIR).filter(f => f.endsWith(".sql"));
    for (const file of onDisk) {
        if (!journaled.has(file)) {
            errors.push(`${file} exists but has no journal entry, so it will never be applied`);
        }
    }
}

if (warnings.length > 0) {
    console.warn("[check-migration-journal] warnings:");
    for (const w of warnings) console.warn(`  - ${w}`);
    console.warn("");
}

if (errors.length > 0) {
    console.error("[check-migration-journal] FAILED\n");
    for (const e of errors) console.error(`  - ${e}\n`);
    process.exit(1);
}

console.log("[check-migration-journal] OK — no BOM, valid JSON, journal and .sql files agree.");
