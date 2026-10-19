import { sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { projectService } from "./project.service.js";
import type { ProjectResourceType } from "@shared/schema/projects.js";

const logger = createLogger("ProjectBackfill");

/**
 * Project Spaces — Phase 1 backfill.
 *
 * Derives project membership from the lineage columns that already exist
 * (`cycle_id` / `mission_id`) and leaves every one of them intact. That is what makes
 * this safe: the source of truth is untouched, so the backfill is re-runnable and
 * correctable, and dropping the three new tables restores the prior system exactly
 * (docs/PROJECT_SPACES_DESIGN.md §3, §9, §11).
 *
 * Derivation chain:
 *   cycle            -> the org's default project
 *   mission          -> project of the cycle its earliest run belonged to, else default
 *   dataset          -> project of its cycle, else of its mission, else default
 *   job_collection   -> same as dataset
 *   app              -> project of its oddjob_mission_id, else default
 *   kb_document      -> project of its mission, else default
 *   form             -> default (a Form Studio template has no lineage to derive from)
 *
 * Every statement is ON CONFLICT DO NOTHING against project_resources' unique
 * indexes, so a second run is a no-op rather than a duplicate or an error.
 */

export interface BackfillReport {
    organizationId: number;
    defaultProjectId: number;
    attached: Record<string, number>;
    cyclesLinked: number;
}

/**
 * Resources are only ever attached to a project in the SAME org. Each statement
 * re-asserts the org on the resource row rather than trusting the lineage column,
 * because most of those columns are unconstrained plain integers that accumulate
 * orphans (§2.1).
 */
async function attachViaSql(
    label: ProjectResourceType,
    statement: ReturnType<typeof sql>,
): Promise<number> {
    const result: any = await db.execute(statement);
    const count = Number(result?.rowCount ?? result?.rows?.length ?? 0);
    if (count > 0) logger.info(`[Backfill] Attached ${count} ${label} resource(s).`);
    return count;
}

/** Backfill a single org. Idempotent. */
export async function backfillOrg(
    organizationId: number,
    opts: { userId?: string; dryRun?: boolean } = {},
): Promise<BackfillReport> {
    const ctx = {
        organizationId,
        userId: opts.userId ?? "backfill",
        isSuperAdmin: true,
        isOrgAdmin: true,
    };

    // A dry run must not write, so it reports against the existing default project
    // rather than creating one (defaultProjectId 0 = "would be created").
    if (opts.dryRun) {
        const existing: any = await db.execute(sql`
            SELECT id FROM projects WHERE organization_id = ${organizationId} AND is_default LIMIT 1
        `);
        const pending: any = await db.execute(sql`
            SELECT COUNT(*)::int AS n FROM operational_cycles
            WHERE organization_id = ${organizationId} AND project_id IS NULL AND deleted_at IS NULL
        `);
        const report: BackfillReport = {
            organizationId,
            defaultProjectId: Number(existing?.rows?.[0]?.id ?? 0),
            attached: {},
            cyclesLinked: Number(pending?.rows?.[0]?.n ?? 0),
        };
        logger.info(
            `[Backfill] (dry run) org ${organizationId}: ${report.cyclesLinked} cycle(s) would be linked to ` +
            (report.defaultProjectId ? `project ${report.defaultProjectId}.` : "a default project that would be created."),
        );
        return report;
    }

    const defaultProject = await projectService.ensureDefaultProject(ctx);
    const pid = defaultProject.id;
    const addedBy = opts.userId ?? "backfill";

    const report: BackfillReport = {
        organizationId,
        defaultProjectId: pid,
        attached: {},
        cyclesLinked: 0,
    };

    // --- Cycles: the real column (§5.3) plus a junction row, so "everything in
    //     project X" stays a single query over one table.
    const cycleUpdate: any = await db.execute(sql`
        UPDATE operational_cycles
        SET project_id = ${pid}
        WHERE organization_id = ${organizationId}
          AND project_id IS NULL
          AND deleted_at IS NULL
    `);
    report.cyclesLinked = Number(cycleUpdate?.rowCount ?? 0);

    report.attached.cycle = await attachViaSql("cycle", sql`
        INSERT INTO project_resources (project_id, resource_type, resource_id, relation, added_by)
        SELECT c.project_id, 'cycle', c.id, 'primary', ${addedBy}
        FROM operational_cycles c
        WHERE c.organization_id = ${organizationId}
          AND c.project_id IS NOT NULL
          AND c.deleted_at IS NULL
        ON CONFLICT DO NOTHING
    `);

    // --- Missions: derived from the earliest run that named a cycle. A mission with
    //     no cycle-bearing run falls to the default project, which keeps the "every
    //     resource has exactly one home" invariant total (§10.1).
    report.attached.mission = await attachViaSql("mission", sql`
        INSERT INTO project_resources (project_id, resource_type, resource_id, relation, added_by)
        SELECT COALESCE(c.project_id, ${pid}), 'mission', m.id, 'primary', ${addedBy}
        FROM missions m
        LEFT JOIN LATERAL (
            SELECT r.cycle_id
            FROM mission_runs r
            WHERE r.mission_id = m.id AND r.cycle_id IS NOT NULL
            ORDER BY r.id ASC
            LIMIT 1
        ) first_run ON TRUE
        LEFT JOIN operational_cycles c
          ON c.id = first_run.cycle_id AND c.organization_id = ${organizationId}
        WHERE m.organization_id = ${organizationId}
          AND m.deleted_at IS NULL
        ON CONFLICT DO NOTHING
    `);

    // --- Datasets: cycle lineage first, then mission lineage, then default.
    report.attached.dataset = await attachViaSql("dataset", sql`
        INSERT INTO project_resources (project_id, resource_type, resource_id, relation, added_by)
        SELECT COALESCE(c.project_id, mp.project_id, ${pid}), 'dataset', d.id, 'primary', ${addedBy}
        FROM datasets d
        LEFT JOIN operational_cycles c
          ON c.id = d.cycle_id AND c.organization_id = ${organizationId}
        LEFT JOIN project_resources mp
          ON mp.resource_type = 'mission' AND mp.resource_id = d.mission_id AND mp.relation = 'primary'
        WHERE d.organization_id = ${organizationId}
        ON CONFLICT DO NOTHING
    `);

    report.attached.job_collection = await attachViaSql("job_collection", sql`
        INSERT INTO project_resources (project_id, resource_type, resource_id, relation, added_by)
        SELECT COALESCE(c.project_id, mp.project_id, ${pid}), 'job_collection', jc.id, 'primary', ${addedBy}
        FROM job_collections jc
        LEFT JOIN operational_cycles c
          ON c.id = jc.cycle_id AND c.organization_id = ${organizationId}
        LEFT JOIN project_resources mp
          ON mp.resource_type = 'mission' AND mp.resource_id = jc.mission_id AND mp.relation = 'primary'
        WHERE jc.organization_id = ${organizationId}
        ON CONFLICT DO NOTHING
    `);

    // --- Apps: this replaces App Arsenal's parentCycle grouping key, which was a
    //     proxy for exactly the concept projects now make real (§2.3).
    report.attached.app = await attachViaSql("app", sql`
        INSERT INTO project_resources (project_id, resource_type, resource_id, relation, added_by)
        SELECT COALESCE(mp.project_id, ${pid}), 'app', a.id, 'primary', ${addedBy}
        FROM apps a
        LEFT JOIN project_resources mp
          ON mp.resource_type = 'mission' AND mp.resource_id = a.oddjob_mission_id AND mp.relation = 'primary'
        WHERE a.organization_id = ${organizationId}
        ON CONFLICT DO NOTHING
    `);

    report.attached.kb_document = await attachViaSql("kb_document", sql`
        INSERT INTO project_resources (project_id, resource_type, resource_id, relation, added_by)
        SELECT COALESCE(mp.project_id, ${pid}), 'kb_document', kd.id, 'primary', ${addedBy}
        FROM knowledge_documents kd
        LEFT JOIN project_resources mp
          ON mp.resource_type = 'mission' AND mp.resource_id = kd.mission_id AND mp.relation = 'primary'
        WHERE kd.organization_id = ${organizationId}
        ON CONFLICT DO NOTHING
    `);

    // --- Forms: authored Form Studio templates carry no cycle or mission lineage, so
    //     each lands in the default project. A default project does not namespace names,
    //     so their project_id stays NULL and forms that already share a name do not collide.
    report.attached.form = await attachViaSql("form", sql`
        INSERT INTO project_resources (project_id, resource_type, resource_id, relation, added_by)
        SELECT ${pid}, 'form', f.id, 'primary', ${addedBy}
        FROM hil_forms f
        WHERE f.organization_id = ${organizationId}
          AND f.kind = 'template'
        ON CONFLICT DO NOTHING
    `);

    // Keep the two namespacing columns (migration 0007) in step with the junction.
    // These carry the per-project uniqueness constraints, so a resource attached to a
    // project but left with a null project_id would escape its namespace.
    await db.execute(sql`
        UPDATE datasets d SET project_id = pr.project_id
        FROM project_resources pr
        WHERE pr.resource_type = 'dataset' AND pr.resource_id = d.id AND pr.relation = 'primary'
          AND d.organization_id = ${organizationId}
          AND d.project_id IS DISTINCT FROM pr.project_id
    `);
    await db.execute(sql`
        UPDATE knowledge_documents kd SET project_id = pr.project_id
        FROM project_resources pr
        WHERE pr.resource_type = 'kb_document' AND pr.resource_id = kd.id AND pr.relation = 'primary'
          AND kd.organization_id = ${organizationId}
          AND kd.project_id IS DISTINCT FROM pr.project_id
    `);

    // Existing orgs were seeded with the Object Types that predate Project Spaces;
    // re-seeding is idempotent and registers the new "Project" / "Project Resource"
    // virtual types so agents and the ontology REST surface can see them (§6.2).
    try {
        const { ontologyService } = await import("@domain/knowledge/core/ontology.service.js");
        await ontologyService.seedDefaultObjectTypes(ctx);
    } catch (e: any) {
        // The ontology tables are applied by a separate migration chain (§10.3); a
        // missing one must not fail the data backfill, which stands on its own.
        logger.warn(`[Backfill] Skipped ontology Object Type seeding for org ${organizationId}: ${e?.message ?? e}`);
    }

    // Membership changed wholesale; anything cached is stale.
    projectService.resourceCache.clear();

    logger.info(
        `[Backfill] org ${organizationId}: linked ${report.cyclesLinked} cycle(s), attached ${Object.values(
            report.attached,
        ).reduce((a, b) => a + b, 0)} resource(s) to project ${pid}.`,
    );
    return report;
}

/** Backfill every org (or just the ones named). Idempotent. */
export async function backfillAllOrgs(
    opts: { organizationIds?: number[]; userId?: string; dryRun?: boolean } = {},
): Promise<BackfillReport[]> {
    let ids = opts.organizationIds;
    if (!ids || ids.length === 0) {
        const rows: any = await db.execute(sql`SELECT org_id FROM orgs ORDER BY org_id`);
        ids = (rows?.rows ?? []).map((r: any) => Number(r.org_id));
    }

    const reports: BackfillReport[] = [];
    for (const id of ids!) {
        try {
            reports.push(await backfillOrg(id, opts));
        } catch (e: any) {
            logger.error(`[Backfill] org ${id} failed: ${e?.message ?? e}`);
            throw e;
        }
    }
    return reports;
}
