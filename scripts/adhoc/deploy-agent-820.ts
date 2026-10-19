import { db } from "@server/database_service.js";
import { jobs, agentDeployments } from "@shared/schema";
import { eq } from "drizzle-orm";

async function deploy() {
    const jobId = 820;
    const slug = "agent-820";
    
    // Check if job exists
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    if (!job) {
        console.error(`Job ${jobId} not found`);
        process.exit(1);
    }
    
    console.log(`Found job ${jobId}: ${job.name}`);
    
    // Check if deployment already exists
    const [existing] = await db.select().from(agentDeployments).where(eq(agentDeployments.slug, slug));
    if (existing) {
        console.log(`Deployment already exists: ${existing.slug} (isActive: ${existing.isActive})`);
        
        // If not active, activate it
        if (!existing.isActive) {
            await db.update(agentDeployments)
                .set({ isActive: true, updatedAt: new Date() })
                .where(eq(agentDeployments.id, existing.id));
            console.log("Activated existing deployment");
        }
        process.exit(0);
    }
    
    // Create new deployment
    const [deployment] = await (db.insert(agentDeployments) as any).values({
        jobId: jobId,
        organizationId: job.organizationId ?? 1,
        slug: slug,
        title: job.name || "Agent 820",
        description: job.description || "Published agent deployment",
        welcomeMessage: "Hello! How can I help you today?",
        isActive: true,
        accessPolicy: "public",
        createdBy: "admin",
        oceanTraits: { o: 0.5, c: 0.5, e: 0.5, a: 0.5, n: 0.5 },
        soulArchetype: "Lead Directive",
    }).returning();
    
    console.log(`Created deployment: ${deployment.slug} (id: ${deployment.id})`);
    console.log(`\nYour agent is now available at: http://localhost:5000/a/${slug}`);
    console.log(`API endpoint: http://localhost:5000/api/public/agents/${slug}`);
    
    process.exit(0);
}

deploy().catch(err => {
    console.error(err);
    process.exit(1);
});
