import { db } from "../database_service.js";
import { apps, appDeployments, appInstances } from "../../shared/schema/index.js";
import { eq, or, ilike } from "drizzle-orm";

async function main() {
    console.log("--- APP DEPLOYMENTS FOR DISPATCH OR LOCATION ---");
    const deployments = await db.select({
        id: appDeployments.id,
        appId: appDeployments.appId,
        appName: apps.name,
        appSlug: apps.slug,
        publicSlug: appDeployments.publicSlug,
        status: appDeployments.status,
        organizationId: appDeployments.organizationId
    })
    .from(appDeployments)
    .innerJoin(apps, eq(appDeployments.appId, apps.id))
    .where(or(
        ilike(apps.slug, "%dispatch%"),
        ilike(apps.slug, "%location%")
    ));
    console.log(deployments);

    console.log("\n--- APP INSTANCES ---");
    for (const d of deployments) {
        const instances = await db.select().from(appInstances).where(eq(appInstances.deploymentId, d.id));
        if (instances.length > 0) {
            console.log(`Deployment ID ${d.id} (${d.appName}) instances:`, instances.map(i => ({ id: i.id, port: i.port, status: i.status })));
        }
    }
}

main().catch(console.error).finally(() => process.exit(0));
