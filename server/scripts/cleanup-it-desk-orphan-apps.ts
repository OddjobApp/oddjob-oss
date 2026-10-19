/**
 * One-off: remove orphaned it-service-desk workbench app rows for TECHHEAD7 left
 * by iterative install testing (changing slugs orphaned prior rows, and the
 * apps_name_unique constraint then blocks re-install). Deletes deployments first,
 * then the apps, for org 291 by name.
 *
 * Usage: npx tsx server/scripts/cleanup-it-desk-orphan-apps.ts
 */
import { db } from "../database_service.js";
import { orgs, apps, appDeployments } from "@shared/schema/index.js";
import { and, eq, inArray, like, or } from "drizzle-orm";

async function main() {
    const [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
    if (!org) throw new Error("TECHHEAD7 not found");

    const rows = await db.select().from(apps).where(and(
        eq(apps.organizationId, org.id),
        or(like(apps.name, "%IT Ticketing Portal%"), like(apps.name, "%Support Agent Dashboard%")),
    ));
    if (rows.length === 0) { console.log("No orphaned workbench apps to remove."); process.exit(0); }

    const ids = rows.map((r) => r.id);
    console.log(`Removing ${rows.length} app(s): ${rows.map((r) => `#${r.id} "${r.name}" [${r.slug}]`).join(", ")}`);

    const delDeps = await db.delete(appDeployments).where(inArray(appDeployments.appId, ids)).returning({ id: appDeployments.id });
    console.log(`  deleted ${delDeps.length} deployment row(s)`);
    const delApps = await db.delete(apps).where(inArray(apps.id, ids)).returning({ id: apps.id });
    console.log(`  deleted ${delApps.length} app row(s)`);
    process.exit(0);
}

main().catch((e) => { console.error("cleanup threw:", e); process.exit(1); });
