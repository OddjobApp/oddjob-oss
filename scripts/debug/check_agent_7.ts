
import { db } from "@server/database_service.js";
import { agentDeployments, jobs } from "../../shared/schema";
import { eq } from "drizzle-orm";

async function checkAgent() {
    try {
        const slug = "agent-7";
        console.log(`Checking deployment for slug: ${slug}`);

        const [deployment] = await db
            .select()
            .from(agentDeployments)
            .where(eq(agentDeployments.slug, slug))
            .limit(1);

        if (!deployment) {
            console.error("Deployment not found");
            return;
        }

        console.log("Deployment found:", JSON.stringify(deployment, null, 2));

        const [job] = await db
            .select()
            .from(jobs)
            .where(eq(jobs.id, deployment.jobId))
            .limit(1);

        if (!job) {
            console.error("Job not found for deployment");
            return;
        }

        console.log("Job found:", JSON.stringify(job, null, 2));
        console.log("Job Config:", JSON.stringify(job.config, null, 2));

    } catch (error) {
        console.error("Error:", error);
    } finally {
        process.exit(0);
    }
}

checkAgent();
