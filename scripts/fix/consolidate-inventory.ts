
import { db } from "../../server/database_service.js";
import { missions, apps, appDeployments, users } from "../../shared/schema/index.js";
import { eq, isNull, and, notInArray } from "drizzle-orm";

async function consolidateInventory() {
    console.log("Starting Inventory Consolidation...");
    
    const targetOrgId = 1;

    // 1. Consolidate Missions
    const missionUpdate = await db.update(missions)
        .set({ organizationId: targetOrgId })
        .where(isNull(missions.organizationId));
    
    console.log(`Consolidated missions with null organization into Org ${targetOrgId}`);

    // 2. Consolidate Apps (ensure all exist in app_deployments for Org 1)
    const allApps = await db.select().from(apps);
    console.log(`Checking ${allApps.length} apps for deployment in Org ${targetOrgId}`);

    for (const app of allApps) {
        const [existing] = await db.select()
            .from(appDeployments)
            .where(and(
                eq(appDeployments.appId, app.id),
                eq(appDeployments.organizationId, targetOrgId)
            ))
            .limit(1);

        if (!existing) {
            await db.insert(appDeployments).values({
                appId: app.id,
                organizationId: targetOrgId,
                status: 'active', // Ensure they are active
                config: {},
                installedAt: new Date()
            });
            console.log(`Deployed App [${app.slug}] to Org ${targetOrgId}`);
        } else if (existing.status !== 'active') {
            await db.update(appDeployments)
                .set({ status: 'active' })
                .where(eq(appDeployments.id, existing.id));
            console.log(`Activated App [${app.slug}] in Org ${targetOrgId}`);
        }
    }

    console.log("Inventory Consolidation Complete.");
    process.exit(0);
}

consolidateInventory().catch(err => {
    console.error(err);
    process.exit(1);
});
