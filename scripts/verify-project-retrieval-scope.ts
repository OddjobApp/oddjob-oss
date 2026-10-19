/**
 * Verifies the Project Space retrieval/agent boundary (PROJECT_SPACES_DESIGN §6.4)
 * against real data.
 *
 * search-service.ts is `@ts-nocheck` and the capability prior is pure runtime logic,
 * so neither is covered by the type checker. These are the behaviours that actually
 * matter, including the two failure modes worth engineering against:
 *   - retrieval silently returning NOTHING once scoped,
 *   - the capability prior hard-filtering instead of ranking, which would make the
 *     agent claim a capability does not exist.
 *
 * Usage: npx tsx scripts/verify-project-retrieval-scope.ts [--org=1]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../server/database_service.js";

function argVal(flag: string): string | undefined {
    const a = process.argv.find((x) => x.startsWith(`${flag}=`));
    return a ? a.split("=")[1] : undefined;
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
    console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
}

(async () => {
    const org = Number(argVal("--org") ?? 1);

    const projRows: any = await db.execute(sql`
        SELECT id, key FROM projects WHERE organization_id = ${org} ORDER BY is_default DESC LIMIT 1
    `);
    const projectId = Number(projRows.rows[0]?.id);
    if (!projectId) throw new Error(`No project for org ${org}; run the backfill first.`);
    console.log(`org ${org}, project ${projectId} (${projRows.rows[0].key})\n`);

    // ---- 1. Capability discovery prior ------------------------------------
    const { CAPABILITY_DISCOVERY_TOOLS } = await import(
        "../server/domain/tools/v1/capabilities/capability-discovery.js"
    );
    const discover = CAPABILITY_DISCOVERY_TOOLS.discover_capabilities;

    const baseCtx: any = { organizationId: org, named: {}, positional: {} };
    const unscoped = JSON.parse(await discover.execute({ limit: 50 }, baseCtx));
    const scoped = JSON.parse(await discover.execute({ limit: 50 }, { ...baseCtx, projectId }));

    check("discovery returns missions unscoped", (unscoped.missions?.length ?? 0) > 0,
        `${unscoped.missions?.length ?? 0}`);

    // A prior must not shrink the candidate set — that is the difference between
    // ranking and filtering, and filtering here makes the agent deny capabilities.
    check("project prior does NOT drop missions from the result set",
        (scoped.missions?.length ?? 0) === (unscoped.missions?.length ?? 0),
        `scoped ${scoped.missions?.length} vs unscoped ${unscoped.missions?.length}`);

    const attached: any = await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM project_resources
        WHERE project_id = ${projectId} AND resource_type = 'mission'
    `);
    const attachedCount = Number(attached.rows[0].n);

    if (attachedCount > 0 && (scoped.missions?.length ?? 0) > 0) {
        const flaggedFirst = scoped.missions[0]?.inActiveProject === true;
        check("in-project mission ranks first under the prior", flaggedFirst,
            `first = ${scoped.missions[0]?.name} (inActiveProject=${scoped.missions[0]?.inActiveProject})`);
    } else {
        console.log("  --  no missions attached to this project; ranking assertion skipped");
    }

    // ---- 2. Retrieval scope ------------------------------------------------
    const { searchService } = await import("../server/domain/knowledge/core/search/search-service.js");

    const nameRow: any = await db.execute(sql`
        SELECT name FROM datasets WHERE organization_id = ${org} AND project_id = ${projectId}
        AND name IS NOT NULL LIMIT 1
    `);
    const probe = nameRow.rows[0]?.name;

    if (probe) {
        const term = String(probe).split(/\s+/)[0].slice(0, 12);
        const orgWide = await searchService.executeUnifiedSearch(term, "unknown", org, { limit: 10 });
        const inProject = await searchService.executeUnifiedSearch(term, "unknown", org, { limit: 10, projectId });

        check("scoped retrieval still returns results (did not silently empty)",
            inProject.length > 0, `${inProject.length} hit(s) vs ${orgWide.length} org-wide`);
        check("scoped retrieval returns no more than org-wide",
            inProject.length <= orgWide.length, `${inProject.length} vs ${orgWide.length}`);

        // Every dataset hit must belong to the scoped project.
        const datasetHits = inProject.filter((r: any) => r.type === "dataset" && String(r.id).startsWith("gen-ds-"));
        let leaked = 0;
        for (const hit of datasetHits) {
            const id = Number(String(hit.id).replace("gen-ds-", ""));
            const row: any = await db.execute(sql`SELECT project_id FROM datasets WHERE id = ${id}`);
            const owner = row.rows[0]?.project_id;
            if (owner !== null && owner !== undefined && Number(owner) !== projectId) leaked++;
        }
        check("no dataset from another project leaked into scoped results", leaked === 0,
            `${leaked} leak(s) across ${datasetHits.length} dataset hit(s)`);
    } else {
        console.log("  --  no project-scoped dataset to probe with; retrieval assertions skipped");
    }

    // ---- 3. Narrowing actually EXCLUDES ------------------------------------
    // The assertions above prove scoping is safe, not that it does anything: an org
    // with a single project cannot distinguish "scoped correctly" from "ignored the
    // scope". This builds a second project and proves cross-project exclusion.
    const marker = `zzprobe${Date.now()}`;
    const tmpProject: any = await db.execute(sql`
        INSERT INTO projects (organization_id, key, name, created_by)
        VALUES (${org}, ${`scope-probe-${Date.now()}`}, 'Scope probe', 'verify-script')
        RETURNING id
    `);
    const projectB = Number(tmpProject.rows[0].id);

    try {
        await db.execute(sql`
            INSERT INTO datasets (name, description, organization_id, project_id)
            VALUES (${marker}, ${`probe dataset ${marker}`}, ${org}, ${projectB})
        `);

        const fromA = await searchService.executeUnifiedSearch(marker, "unknown", org, { limit: 10, projectId });
        const fromB = await searchService.executeUnifiedSearch(marker, "unknown", org, { limit: 10, projectId: projectB });
        const orgWide = await searchService.executeUnifiedSearch(marker, "unknown", org, { limit: 10 });

        const hasMarker = (rows: any[]) => rows.some((r) => String(r.title ?? "").includes(marker));

        check("a dataset in project B is INVISIBLE when scoped to project A", !hasMarker(fromA));
        check("the same dataset IS visible when scoped to project B", hasMarker(fromB));
        check("and is visible org-wide when no project scope is passed", hasMarker(orgWide));
    } finally {
        await db.execute(sql`DELETE FROM datasets WHERE name = ${marker}`);
        await db.execute(sql`DELETE FROM projects WHERE id = ${projectB}`);
    }

    console.log(failures === 0 ? "\nAll retrieval-scope checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
    console.error("verify-project-retrieval-scope error:", e?.message ?? e);
    process.exit(1);
});
