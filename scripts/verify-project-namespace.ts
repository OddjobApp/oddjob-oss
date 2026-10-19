/**
 * Verifies the Project Spaces identity namespace against a real database.
 *
 * Asserts the three things the migration actually claims, none of which a type check
 * can catch:
 *   1. the same name is now legal in two different projects,
 *   2. it is still rejected twice within ONE project,
 *   3. the (project_id, title) ON CONFLICT target the ingest paths rely on exists —
 *      if it does not, Postgres raises "no unique or exclusion constraint matching
 *      the ON CONFLICT specification" and idempotent ingest silently breaks.
 *
 * Usage: npx tsx scripts/verify-project-namespace.ts [--org=1]
 * Cleans up everything it creates.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../server/database_service.js";

function argVal(flag: string): string | undefined {
    const a = process.argv.find((x) => x.startsWith(`${flag}=`));
    return a ? a.split("=")[1] : undefined;
}

const NAME = `__ns_probe_${Date.now()}`;
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
    console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
}

(async () => {
    const org = Number(argVal("--org") ?? 1);

    const projectRows: any = await db.execute(sql`
        SELECT id FROM projects WHERE organization_id = ${org} ORDER BY is_default DESC, id ASC LIMIT 1
    `);
    const projectA = Number(projectRows?.rows?.[0]?.id);
    if (!projectA) throw new Error(`No project found for org ${org}. Run the backfill first.`);

    // A second, disposable project to namespace against.
    const created: any = await db.execute(sql`
        INSERT INTO projects (organization_id, key, name, created_by)
        VALUES (${org}, ${`ns-probe-${Date.now()}`}, 'Namespace probe', 'verify-script')
        RETURNING id
    `);
    const projectB = Number(created.rows[0].id);

    try {
        // 1. Same dataset name in two different projects — the whole point.
        await db.execute(sql`
            INSERT INTO datasets (name, organization_id, project_id) VALUES (${NAME}, ${org}, ${projectA})
        `);
        let sameNameOtherProject = true;
        try {
            await db.execute(sql`
                INSERT INTO datasets (name, organization_id, project_id) VALUES (${NAME}, ${org}, ${projectB})
            `);
        } catch (e: any) {
            sameNameOtherProject = false;
            check("same dataset name allowed in a second project", false, e.message);
        }
        if (sameNameOtherProject) check("same dataset name allowed in a second project", true);

        // 2. ...but still rejected twice inside ONE project.
        let rejectedInSameProject = false;
        try {
            await db.execute(sql`
                INSERT INTO datasets (name, organization_id, project_id) VALUES (${NAME}, ${org}, ${projectA})
            `);
        } catch {
            rejectedInSameProject = true;
        }
        check("duplicate dataset name still rejected within one project", rejectedInSameProject);

        // 3. The ON CONFLICT target the ingest paths depend on.
        let upsertWorks = true;
        let upsertErr = "";
        try {
            await db.execute(sql`
                INSERT INTO knowledge_documents (title, organization_id, project_id)
                VALUES (${NAME}, ${org}, ${projectA})
            `);
            await db.execute(sql`
                INSERT INTO knowledge_documents (title, organization_id, project_id)
                VALUES (${NAME}, ${org}, ${projectA})
                ON CONFLICT (project_id, title) DO UPDATE SET updated_at = NOW()
            `);
        } catch (e: any) {
            upsertWorks = false;
            upsertErr = e.message;
        }
        check("ON CONFLICT (project_id, title) resolves to a real index", upsertWorks, upsertErr);

        const dupes: any = await db.execute(sql`
            SELECT COUNT(*)::int AS n FROM knowledge_documents
            WHERE title = ${NAME} AND project_id = ${projectA}
        `);
        check("idempotent ingest updated rather than duplicated", Number(dupes.rows[0].n) === 1,
            `${dupes.rows[0].n} row(s)`);

        // 4. The old org-wide index must be gone, or namespacing is undone.
        const stale: any = await db.execute(sql`
            SELECT indexname FROM pg_indexes
            WHERE indexname IN ('datasets_org_name_unique','knowledge_docs_org_title_unique')
        `);
        check("org-wide unique indexes dropped", stale.rows.length === 0,
            stale.rows.map((r: any) => r.indexname).join(", "));
    } finally {
        await db.execute(sql`DELETE FROM datasets WHERE name = ${NAME}`);
        await db.execute(sql`DELETE FROM knowledge_documents WHERE title = ${NAME}`);
        await db.execute(sql`DELETE FROM projects WHERE id = ${projectB}`);
    }

    console.log(failures === 0 ? "\nAll namespace checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
    console.error("verify-project-namespace error:", e?.message ?? e);
    process.exit(1);
});
