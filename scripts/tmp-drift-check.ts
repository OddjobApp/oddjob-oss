/**
 * TEMPORARY read-only schema drift check (delete after use).
 * Compares Drizzle's declared columns against information_schema for the tables
 * the golden path demo touches. Makes no writes.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";

import { orgs, users } from "../shared/schema/auth.js";
import { missions } from "../shared/schema/missions/core.js";
import { missionRuns } from "../shared/schema/missions/runs.js";
import { approvalRequests } from "../shared/schema/hil.js";
import { knowledgeDocuments } from "../shared/schema/knowledge-base.js";

const url = readFileSync(process.argv[2], "utf8").trim();

const tables: Array<[string, any]> = [
    ["orgs", orgs],
    ["users", users],
    ["missions", missions],
    ["mission_runs", missionRuns],
    ["approval_requests", approvalRequests],
    ["knowledge_documents", knowledgeDocuments],
];

(async () => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    let totalMissing = 0;
    const ddl: string[] = [];

    for (const [label, table] of tables) {
        const cfg = getTableConfig(table);
        const expected = cfg.columns.map((col: any) => col.name).sort();
        const { rows } = await c.query(
            "select column_name from information_schema.columns where table_name = $1",
            [cfg.name],
        );
        const actual = new Set(rows.map((r: any) => r.column_name));
        const missing = expected.filter((col: string) => !actual.has(col));
        totalMissing += missing.length;

        console.log(`${label.padEnd(22)} declared=${String(expected.length).padEnd(4)} ${missing.length === 0 ? "OK" : "MISSING " + missing.length}`);
        for (const col of missing) {
            const def: any = cfg.columns.find((x: any) => x.name === col);
            const sqlType = def?.getSQLType?.() ?? "text";
            console.log(`    - ${col}  (${sqlType}${def?.notNull ? ", NOT NULL" : ""}${def?.hasDefault ? ", has default" : ""})`);
            ddl.push(`ALTER TABLE ${cfg.name} ADD COLUMN IF NOT EXISTS ${col} ${sqlType};`);
        }
    }

    console.log(`\ntotal missing columns: ${totalMissing}`);
    if (ddl.length) {
        console.log("\n-- additive DDL to close the drift (all nullable):");
        for (const line of ddl) console.log(line);
    }
    await c.end();
})().catch((e) => {
    console.error("drift check failed:", e.message);
    process.exit(1);
});
