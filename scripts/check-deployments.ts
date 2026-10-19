import { db } from "../server/db/index.js";
import { appDeployments, apps } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function checkDeployments() {
    console.log("🔍 Checking app deployments for Org ID 1 (KUS)...");
    const deployments = await db.select({
        appId: appDeployments.appId,
        appName: apps.name,
        orgId: appDeployments.organizationId,
        status: appDeployments.status
    })
    .from(appDeployments)
    .innerJoin(apps, eq(appDeployments.appId, apps.id))
    .where(eq(appDeployments.organizationId, 1));

    console.log("Total deployments for Org 1:", deployments.length);
    deployments.forEach(d => {
        console.log(`- App: ${d.appName} (ID: ${d.appId}), Status: ${d.status}`);
    });
    process.exit(0);
}

checkDeployments().catch(err => {
    console.error(err);
    process.exit(1);
});
