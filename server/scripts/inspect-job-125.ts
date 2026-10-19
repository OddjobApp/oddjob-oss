
import "dotenv/config";
import { db } from "../database_service.js";
import { jobs } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
// Skip agentRunSteps if it keeps failing, let's just see the job config first
// import { agentRunSteps } from "../../shared/schema/agent/chat.js";

async function inspectJob() {
    console.log("--- Inspecting Job 125 ---");
    try {
        const [job] = await db.select().from(jobs).where(eq(jobs.id, 125)).limit(1);

        if (!job) {
            console.error("Job 125 not found");
            return;
        }

        console.log("Job Name:", job.name);
        console.log("Job Config:", JSON.stringify(job.config, null, 2));

        // Let's try to find steps by table name if the import fails
        console.log("\n--- Fetching steps via raw query ---");
        const stepsResult = await db.execute(sql`SELECT type, content, created_at FROM agent_run_steps WHERE job_id = 125 ORDER BY created_at DESC LIMIT 10`);
        const steps = stepsResult.rows as any[];

        if (steps.length === 0) {
            console.log("No steps found for this job.");
        } else {
            console.log(`Found ${steps.length} steps.`);
            steps.forEach((step, i) => {
                console.log(`\n[Step ${i}] Type: ${step.type} | Created At: ${step.created_at}`);
                console.log(`Content: ${step.content.substring(0, 200)}...`);
            });
        }
    } catch (err: any) {
        console.error("Error during inspection:", err);
    }
}

inspectJob().catch(console.error).finally(() => process.exit());

