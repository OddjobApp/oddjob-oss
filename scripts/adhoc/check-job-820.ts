import { db } from "@server/database_service.js";
import { jobs, agentDeployments } from "@shared/schema";
import { eq } from "drizzle-orm";

async function check() {
    console.log("Checking for job 820...");
    
    // Check job 820
    const job820 = await db.select().from(jobs).where(eq(jobs.id, 820));
    console.log("Job 820:", job820.length > 0 ? job820[0] : "NOT FOUND");
    
    // Check all deployments with '820' in slug
    const allDeployments = await db.select().from(agentDeployments);
    const matches = allDeployments.filter(d => d.slug.includes('820'));
    console.log("\nDeployments with '820' in slug:", matches);
    
    // Show all active deployments
    console.log("\nAll ACTIVE deployments:");
    allDeployments.filter(d => d.isActive).forEach(d => {
        console.log(`  - ${d.slug} (jobId: ${d.jobId})`);
    });
    
    process.exit(0);
}

check().catch(err => {
    console.error(err);
    process.exit(1);
});
