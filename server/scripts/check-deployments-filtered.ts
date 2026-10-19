import { db } from "../database_service.js";
import { apps, appDeployments, appInstances } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    const orgId = 291;
    const allDeps = await db.select().from(appDeployments).where(eq(appDeployments.organizationId, orgId));
    console.log("=== DEPLOYMENTS FOR ORG 291 ===");
    for (const dep of allDeps) {
        const [app] = await db.select().from(apps).where(eq(apps.id, dep.appId)).limit(1);
        const insts = await db.select().from(appInstances).where(eq(appInstances.deploymentId, dep.id));
        console.log(`App: ${app?.name} (Slug: ${app?.slug}, ID: ${app?.id})`);
        console.log(`Deployment: ID: ${dep.id}, Status: ${dep.status}, Published: ${dep.isPublished}, PublicSlug: ${dep.publicSlug}, URL: ${dep.url}`);
        console.log(`Instances:`, insts.map(i => ({ port: i.port, status: i.status })));
        console.log("-----------------------------------------");
    }
}

main().catch(console.error);
