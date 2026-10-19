import { db } from "../database_service.js";
import { operationalCycles, apps, appDeployments, orgs } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    const orgName = "TECHHEAD7";
    const [org] = await db.select().from(orgs).where(eq(orgs.name, orgName)).limit(1);
    if (!org) {
        console.error(`Org ${orgName} not found`);
        process.exit(1);
    }
    const orgId = org.id;
    console.log(`Checking database records for Org: ${org.name} (ID: ${orgId})`);

    // 1. Cycles
    const cycles = await db.select()
        .from(operationalCycles)
        .where(eq(operationalCycles.organizationId, orgId));
    console.log(`\n--- Operational Cycles (${cycles.length}) ---`);
    for (const c of cycles) {
        console.log(`ID: ${c.id}, Name: ${c.name}, Status: ${c.status}, blueprintCount: ${c.blueprintCount}`);
    }

    // 2. Apps and Deployments
    const appDeps = await db.select({
        appId: apps.id,
        appName: apps.name,
        appSlug: apps.slug,
        depId: appDeployments.id,
        depSlug: appDeployments.publicSlug,
        depStatus: appDeployments.status
    })
        .from(appDeployments)
        .innerJoin(apps, eq(appDeployments.appId, apps.id))
        .where(eq(appDeployments.organizationId, orgId));
    console.log(`\n--- Apps and Deployments (${appDeps.length}) ---`);
    for (const ad of appDeps) {
        console.log(`App: ${ad.appName} (${ad.appSlug}), DepID: ${ad.depId}, PublicSlug: ${ad.depSlug}, Status: ${ad.depStatus}`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
