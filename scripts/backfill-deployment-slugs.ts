/**
 * Gives published deployments that have no public_slug one, so they are reachable.
 *
 * A deployment with is_published = true and public_slug = NULL is published to nowhere:
 * /app/<slug> has no slug to match, and getPublicDeployment can only reach it through
 * an app-slug fallback that may resolve to a different organization's copy. 10 of 117
 * deployments were in that state, all but one of them in org 291.
 *
 * Naming follows the convention already present in the data (rescue-dispatch-org291):
 * the bare app slug when it is free, otherwise the app slug suffixed with the
 * organization. public_slug is UNIQUE across the whole table — not per organization —
 * so 9 of the 10 cannot take the bare form; another org's deployment already holds it.
 *
 * Only NULL slugs are touched. An existing slug is a published URL somebody may have
 * linked to, and rewriting one would break it.
 *
 * Usage:
 *   npx tsx scripts/backfill-deployment-slugs.ts            # report only
 *   npx tsx scripts/backfill-deployment-slugs.ts --apply
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../server/database_service.js";

const APPLY = process.argv.includes("--apply");

interface Candidate {
    id: number;
    organization_id: number;
    app_slug: string | null;
    app_name: string | null;
}

/** Lowercase, alphanumerics and single dashes, no leading or trailing dash. */
function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

async function main() {
    const candidates = (await db.execute(sql`
        SELECT d.id, d.organization_id, a.slug AS app_slug, a.name AS app_name
        FROM app_deployments d
        JOIN apps a ON a.id = d.app_id
        WHERE d.is_published = true AND coalesce(btrim(d.public_slug), '') = ''
        ORDER BY d.id
    `)).rows as unknown as Candidate[];

    if (candidates.length === 0) {
        console.log("Every published deployment already has a public_slug. Nothing to do.");
        process.exit(0);
    }

    const takenRows = (await db.execute(sql`
        SELECT public_slug FROM app_deployments WHERE public_slug IS NOT NULL AND btrim(public_slug) <> ''
    `)).rows as unknown as Array<{ public_slug: string }>;
    // Tracked in-process as well as in the database, so two candidates in the same run
    // cannot be assigned the same slug and collide on the second insert.
    const taken = new Set(takenRows.map((r) => r.public_slug));

    const planned: Array<{ id: number; slug: string; reason: string }> = [];

    for (const row of candidates) {
        const base = slugify(row.app_slug || row.app_name || `app-${row.id}`);
        if (!base) {
            console.warn(`  deployment ${row.id}: no usable name to derive a slug from; skipped`);
            continue;
        }

        let slug = base;
        let reason = "app slug was free";
        if (taken.has(slug)) {
            slug = `${base}-org${row.organization_id}`;
            reason = `"${base}" already belongs to another deployment`;
        }
        // Only if the org-suffixed form is somehow taken too.
        let counter = 2;
        while (taken.has(slug)) {
            slug = `${base}-org${row.organization_id}-${counter++}`;
            reason = "app slug and org-suffixed form both taken";
        }

        taken.add(slug);
        planned.push({ id: row.id, slug, reason });
        console.log(`  deployment ${row.id} (org ${row.organization_id}) -> ${slug}   [${reason}]`);
    }

    if (!APPLY) {
        console.log(`\n${planned.length} slug(s) planned. Re-run with --apply to write.`);
        process.exit(0);
    }

    for (const { id, slug } of planned) {
        // The NULL check is repeated in the UPDATE so a concurrent writer that set a slug
        // between the read and the write is not overwritten.
        await db.execute(sql`
            UPDATE app_deployments
            SET public_slug = ${slug}
            WHERE id = ${id} AND coalesce(btrim(public_slug), '') = ''
        `);
    }

    const [{ remaining }] = (await db.execute(sql`
        SELECT count(*)::int AS remaining FROM app_deployments
        WHERE is_published = true AND coalesce(btrim(public_slug), '') = ''
    `)).rows as unknown as Array<{ remaining: number }>;

    console.log(`\nWrote ${planned.length} slug(s). ${remaining} published deployment(s) still without one.`);
    process.exit(remaining === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error("Slug backfill failed:", err);
    process.exit(1);
});
