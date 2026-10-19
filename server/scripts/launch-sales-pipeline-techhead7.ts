/**
 * Launch (build + start) the sales-opportunity-workbench app in TECHHEAD7 now
 * that committed blueprint source exists. startApp scaffolds from
 * server/blueprints/apps/sales-opportunity-workbench, runs npm install + next
 * build (buildContainer), and starts the container.
 *
 * Usage: npx tsx server/scripts/launch-sales-pipeline-techhead7.ts
 */
import { db } from "../database_service.js";
import { orgs, apps } from "@shared/schema/index.js";
import { appRegistryService } from "../domain/apps/app-registry.service.js";
import { and, eq, ilike } from "drizzle-orm";

async function main() {
    const [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
    if (!org) throw new Error("TECHHEAD7 not found");

    const [app] = await db
        .select()
        .from(apps)
        .where(and(eq(apps.organizationId, org.id), ilike(apps.slug, "%sales-opportunity-workbench%")))
        .limit(1);
    if (!app) throw new Error(`sales-opportunity-workbench app not found in org ${org.id}`);

    console.log(`Launching app #${app.id} (${app.slug}) in org ${org.id} — this runs npm install + next build...`);
    const result = await appRegistryService.startApp(app.id, org.id);
    console.log("==========================================");
    console.log("Launch result:", JSON.stringify(result, null, 2));
    console.log("==========================================");
    process.exit(0);
}

main().catch((e) => { console.error("Launch failed:", e); process.exit(1); });
