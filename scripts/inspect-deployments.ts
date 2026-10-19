
import { db } from "../server/db/index.js";
import { appDeployments, apps, jobs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function inspect() {
    const allDeployments = await db.select({
        id: appDeployments.id,
        orgId: appDeployments.organizationId,
        appId: appDeployments.appId,
        slug: appDeployments.publicSlug,
        published: appDeployments.isPublished,
        appName: apps.name
    })
    .from(appDeployments)
    .innerJoin(apps, eq(appDeployments.appId, apps.id));

    console.log("Current App Deployments:");
    allDeployments.forEach(d => {
        console.log(`- [ID: ${d.id}] ${d.appName} (Org: ${d.orgId}, Slug: ${d.slug}, Published: ${d.published})`);
    });

    const allAppJobs = await db.select().from(jobs).where(eq(jobs.type, 'dispatcher'));
    console.log("\nExisting Dispatcher Jobs:");
    allAppJobs.forEach(j => {
        console.log(`- [ID: ${j.id}] ${j.name} (Org: ${j.organizationId})`);
    });

    process.exit(0);
}

inspect().catch(err => {
    console.error(err);
    process.exit(1);
});
