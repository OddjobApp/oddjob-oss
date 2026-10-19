
import "dotenv/config";
import { db } from "../../server/database_service.js";
import { jobs, agentDeployments } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function debugAgent() {
    try {
        console.log("--- Debugging Agent-7 ---");
        const deployment = await db.query.agentDeployments.findFirst({
            where: eq(agentDeployments.slug, "agent-7")
        });

        if (!deployment) {
            console.log("ERROR: Deployment 'agent-7' not found.");
            process.exit(1);
        }

        console.log("Deployment details:");
        console.log(JSON.stringify(deployment, null, 2));

        if (deployment.jobId) {
            const job = await db.query.jobs.findFirst({
                where: eq(jobs.id, deployment.jobId)
            });

            if (job) {
                console.log("\nJob details (ID: " + deployment.jobId + "):");
                console.log("Type: " + job.type);
                console.log("IsActive: " + job.isActive);
                console.log("Config: ", JSON.stringify(job.config, null, 2));
            } else {
                console.log("\nERROR: Job ID " + deployment.jobId + " not found in 'jobs' table.");
            }
        } else {
            console.log("\nDeployment has no jobId linked.");
        }

    } catch (error) {
        console.error("Debug script failed:", error);
    } finally {
        process.exit(0);
    }
}

debugAgent();
