
import { AppDeploymentService } from "../server/domain/apps/app-deployment.service.js";
import { db } from "../server/db/index.js";
import { apps, appDeployments, jobs } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function testHook() {
    console.log("--- Testing App-to-Job Publishing Hook ---");
    
    const orgId = 1;
    const appSlug = "service-dispatch";
    const publicSlug = "dispatcher";

    // 1. Ensure the app exists
    const [app] = await db.select().from(apps).where(eq(apps.slug, appSlug)).limit(1);
    const appId = app?.id || 0;

    if (!appId) {
        console.error("App 'dispatcher' not found. Please run migrations or provision apps first.");
        process.exit(1);
    }

    // 2. Ensure a deployment exists
    const [deployment] = await db.select().from(appDeployments).where(and(eq(appDeployments.appId, appId), eq(appDeployments.organizationId, orgId))).limit(1);
    
    if (!deployment) {
        console.log("Provisioning test deployment...");
        await db.insert(appDeployments).values({
            appId,
            organizationId: orgId,
            status: 'active',
            isPublished: false
        });
    }

    // 3. Trigger publishing update
    console.log(`Publishing app '${appSlug}' with public slug '${publicSlug}'...`);
    await AppDeploymentService.updateDeploymentPublishing(appId, orgId, {
        isPublished: true,
        publicSlug
    });

    // 4. Verify Job Creation
    const jobName = `App: ${publicSlug}`;
    console.log(`Checking for job: ${jobName}...`);
    
    // Wait a bit for async-ish effects (though it's awaited in the service)
    const [job] = await db.select().from(jobs).where(and(eq(jobs.organizationId, orgId), eq(jobs.name, jobName))).limit(1);

    if (job) {
        console.log("SUCCESS: Job created/updated automatically!");
        console.log("Job ID:", job.id);
        console.log("Job Type:", job.type);
        console.log("Job Tool:", job.tool);
    } else {
        console.error("FAILURE: Job was not created.");
        const allJobs = await db.select().from(jobs).where(eq(jobs.organizationId, orgId));
        console.log("Current Jobs in Org 1:");
        allJobs.forEach(j => console.log(`- ${j.name} (Type: ${j.type})`));
        process.exit(1);
    }

    process.exit(0);
}

testHook().catch(err => {
    console.error("--- TEST HOOK FAILED ---");
    console.error(err);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});
