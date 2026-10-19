import "dotenv/config";
import { db } from "../database_service.js";
import { agentDeployments, jobs, pipelines } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function checkAgent7() {
    console.log("--- Checking Agent 7 (Deployment) ---");
    const [deployment] = await db.select().from(agentDeployments).where(eq(agentDeployments.id, 7));
    if (deployment) {
        console.log("Deployment found:", JSON.stringify(deployment, null, 2));

        const jobId = deployment.jobId;
        if (jobId) {
            console.log(`\n--- Checking Linked Job #${jobId} ---`);
            const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
            if (job) {
                console.log("Job found:", JSON.stringify(job, null, 2));
            } else {
                console.log("Job NOT found in DB.");
            }
        }
    } else {
        console.log("Deployment #7 NOT found.");

        // Maybe it's Job #7?
        console.log("\n--- Checking Job #7 ---");
        const [job] = await db.select().from(jobs).where(eq(jobs.id, 7));
        if (job) {
            console.log("Job #7 found:", JSON.stringify(job, null, 2));
        } else {
            console.log("Job #7 NOT found.");
        }
    }
}

checkAgent7().catch(console.error);

