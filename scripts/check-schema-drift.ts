/**
 * Fails when the drizzle schema declares something the database does not have.
 *
 * WHY THIS EXISTS
 *
 * Drizzle SELECTs every column a table declares. So a column present in
 * `shared/schema` but absent from the database does not degrade gracefully — it
 * breaks the first query that touches that table, at runtime, in production.
 *
 * Nothing else in the pipeline can see it. `tsc` type-checks the schema against
 * itself and passes. Unit tests mock the database and pass. The migration chain
 * is never compared to the schema it is supposed to produce. The failure
 * surfaces as a 500 in the UI, often disguised as something else entirely — one
 * of the cases below was reported as "admins can't see components", which read
 * as a permissions bug and was not one.
 *
 * Four real instances found on 2026-08-08, all invisible to CI at the time:
 *
 *   apps.project_id, app_deployments.project_id, knowledge_topics.project_id
 *     -> "Graph build error: Failed query: select ..., project_id, ... from apps"
 *   component_index (whole table)
 *     -> /platform-maintenance/components rendered empty for every user
 *   transference_rules + ai_execution_logs (whole tables)
 *     -> "[Transference Router] Execution skipped" on effectively every model call
 *
 * WHAT IT CHECKS
 *
 * Schema -> database only. A table or column that exists in the database but not
 * in the schema is NOT an error: legacy tables, other services' tables and
 * ledgers like `drizzle.__drizzle_migrations` all legitimately live there. The
 * one-directional check is the point — it is the direction that breaks queries.
 *
 * Run it against a database built purely from the migration chain and it proves
 * the property that actually matters: the migrations produce what the code
 * expects.
 *
 * THE BASELINE
 *
 * Introducing this check found 12 pre-existing instances beyond the four above.
 * Gating on zero drift from day one would have meant a red pipeline on every
 * unrelated PR until that backlog cleared, which is how a check gets disabled
 * rather than obeyed.
 *
 * So `schema-drift-baseline.json` records known drift, and the check fails only
 * on drift NOT in it. New declarations without migrations are blocked
 * immediately; the existing backlog stays visible and is meant to shrink. An
 * entry that no longer drifts is reported as stale so the baseline can be
 * pruned — a warning rather than a failure, so tidying never blocks a release.
 *
 * Usage:
 *   DATABASE_URL=postgres://... tsx scripts/check-schema-drift.ts
 *   tsx scripts/check-schema-drift.ts --json      # machine-readable
 *   tsx scripts/check-schema-drift.ts --update-baseline
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../shared/schema/index.js";

const BASELINE_PATH = path.resolve(process.cwd(), "scripts/schema-drift-baseline.json");

interface Baseline {
  /** "schema.table" entries known to be absent entirely. */
  missingTables: string[];
  /** "schema.table.column" entries known to be absent. */
  missingColumns: string[];
}

function loadBaseline(): Baseline {
  if (!fs.existsSync(BASELINE_PATH)) return { missingTables: [], missingColumns: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    return {
      missingTables: parsed.missingTables ?? [],
      missingColumns: parsed.missingColumns ?? [],
    };
  } catch (err: any) {
    console.error(`Could not read ${BASELINE_PATH}: ${err.message}`);
    process.exit(2);
  }
}

interface DeclaredTable {
  /** Export name in shared/schema, for a useful error message. */
  exportName: string;
  schemaName: string;
  tableName: string;
  columns: string[];
}

interface Drift {
  missingTables: DeclaredTable[];
  missingColumns: Array<{ table: string; exportName: string; columns: string[] }>;
}

/** Every pgTable the schema barrel exports. */
function declaredTables(): DeclaredTable[] {
  const out: DeclaredTable[] = [];
  for (const [exportName, value] of Object.entries(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value as PgTable);
    out.push({
      exportName,
      schemaName: config.schema ?? "public",
      tableName: config.name,
      columns: config.columns.map((c) => c.name),
    });
  }
  // Deterministic output so a diff between runs is readable.
  return out.sort((a, b) => a.tableName.localeCompare(b.tableName));
}

async function actualColumns(pool: Pool): Promise<Map<string, Set<string>>> {
  const { rows } = await pool.query<{ table_schema: string; table_name: string; column_name: string }>(
    `SELECT table_schema, table_name, column_name
       FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`,
  );
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = `${r.table_schema}.${r.table_name}`;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(r.column_name);
  }
  return map;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Point it at a database built from the migration chain.");
    process.exit(2);
  }

  const asJson = process.argv.includes("--json");
  const pool = new Pool({ connectionString: url, max: 2 });

  let drift: Drift;
  try {
    const declared = declaredTables();
    const actual = await actualColumns(pool);

    drift = { missingTables: [], missingColumns: [] };

    for (const table of declared) {
      const key = `${table.schemaName}.${table.tableName}`;
      const have = actual.get(key);

      if (!have) {
        drift.missingTables.push(table);
        continue;
      }
      const missing = table.columns.filter((c) => !have.has(c));
      if (missing.length) {
        drift.missingColumns.push({
          table: key,
          exportName: table.exportName,
          columns: missing,
        });
      }
    }

    // --- split against the baseline -------------------------------------
    const observedTables = drift.missingTables.map((t) => `${t.schemaName}.${t.tableName}`);
    const observedColumns = drift.missingColumns.flatMap((c) =>
      c.columns.map((col) => `${c.table}.${col}`),
    );

    if (process.argv.includes("--update-baseline")) {
      const next: Baseline = {
        missingTables: [...observedTables].sort(),
        missingColumns: [...observedColumns].sort(),
      };
      fs.writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
      console.log(
        `Baseline written to ${BASELINE_PATH}\n` +
          `  ${next.missingTables.length} table(s), ${next.missingColumns.length} column(s) recorded as known drift.`,
      );
      return;
    }

    const baseline = loadBaseline();
    const knownTables = new Set(baseline.missingTables);
    const knownColumns = new Set(baseline.missingColumns);

    const newTables = observedTables.filter((t) => !knownTables.has(t));
    const newColumns = observedColumns.filter((c) => !knownColumns.has(c));
    const staleTables = baseline.missingTables.filter((t) => !observedTables.includes(t));
    const staleColumns = baseline.missingColumns.filter((c) => !observedColumns.includes(c));

    if (asJson) {
      console.log(JSON.stringify({ ...drift, newTables, newColumns, staleTables, staleColumns }, null, 2));
    } else {
      const target = url.replace(/:[^:@]+@/, ":****@");
      console.log(`Schema drift check against ${target}`);
      console.log(`  ${declared.length} tables declared in shared/schema`);
      console.log(
        `  known drift in baseline: ${baseline.missingTables.length} table(s), ${baseline.missingColumns.length} column(s)\n`,
      );

      const byTable = new Map(drift.missingColumns.map((c) => [c.table, c]));

      if (newTables.length) {
        console.log(`NEW MISSING TABLES (${newTables.length}) — declared but never migrated:`);
        for (const t of newTables) {
          const d = drift.missingTables.find((x) => `${x.schemaName}.${x.tableName}` === t)!;
          console.log(`  ${t}   (export: ${d.exportName})`);
        }
        console.log();
      }

      if (newColumns.length) {
        console.log(`NEW MISSING COLUMNS (${newColumns.length}):`);
        for (const c of newColumns) {
          const table = c.slice(0, c.lastIndexOf("."));
          console.log(`  ${c}   (export: ${byTable.get(table)?.exportName ?? "?"})`);
        }
        console.log();
      }

      if (staleTables.length || staleColumns.length) {
        console.log(
          `STALE BASELINE (${staleTables.length + staleColumns.length}) — these now exist; ` +
            `remove them from schema-drift-baseline.json:`,
        );
        for (const t of [...staleTables, ...staleColumns]) console.log(`  ${t}`);
        console.log();
      }
    }

    const failures = newTables.length + newColumns.length;
    if (failures > 0) {
      if (!asJson) {
        console.error(
          `FAIL: ${failures} object(s) the code expects are absent, and are not known drift.\n\n` +
            `Drizzle selects every declared column, so each of these throws at runtime on\n` +
            `the first query touching that table — in production, not in tsc or in any\n` +
            `test that mocks the database.\n\n` +
            `Fix by writing a migration, or remove the declaration if it was speculative.\n` +
            `If it is genuinely expected for now, run with --update-baseline.\n`,
        );
      }
      process.exit(1);
    }

    if (!asJson) {
      const known = baseline.missingTables.length + baseline.missingColumns.length;
      console.log(
        known > 0
          ? `OK: no new drift. ${known} known item(s) remain in the baseline — please shrink it.`
          : "OK: every declared table and column exists.",
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Schema drift check failed to run:", err?.message ?? err);
  process.exit(2);
});
