import { db } from "../server/database_service.js";
import { apps, appDeployments, appInstances } from "../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function queryApps() {
    const orgId = 291;
    const res = await db.select().from(apps).where(eq(apps.organizationId, orgId));
    console.log(`Apps for TECHHEAD7 (${orgId}):`, JSON.stringify(res, null, 2));

    const deps = await db.select().from(appDeployments).where(eq(appDeployments.organizationId, orgId)).orderBy(desc(appDeployments.updatedAt)).limit(5);
    console.log(`Deployments for TECHHEAD7 (${orgId}):`, JSON.stringify(deps, null, 2));

    const instances = await db.select().from(appInstances).limit(10);
    console.log(`Instances:`, JSON.stringify(instances, null, 2));

    process.exit(0);
}
queryApps().catch(console.error);
