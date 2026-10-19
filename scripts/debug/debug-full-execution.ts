
import { db } from "@server/database_service.js";
import { jobs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { jobTestService } from "@domain/mission/core/job-test.service.js";

async function runDebug() {
    console.log("🚀 Starting Full Execution Debug for Job 29");

    const jobId = 29;
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));

    if (!job) {
        console.error("Job 29 not found");
        process.exit(1);
    }

    console.log(`Job Found: ${job.name}`);
    console.log(`Config:`, JSON.stringify(job.config, null, 2));
    console.log(`Output Dataset ID: ${job.outputDatasetId}`);

    // Parse config if string
    const config = typeof job.config === 'string' ? JSON.parse(job.config) : job.config;

    console.log("Executing testGenericJob...");
    try {
        const result = await jobTestService.testGenericJob(job, config, {
            captureInput: false,
            captureOutput: false
        });

        console.log("---------------------------------------------------");
        console.log("Execution Result:", JSON.stringify(result, null, 2));
        console.log("---------------------------------------------------");

        if (result.success) {
            console.log("✅ Execution Successful");
        if (result.success) {
            console.log("✅ Execution Successful");
        } else {
            console.error("❌ Execution Failed:", result.error);
        }
        } else {
            console.error("❌ Execution Failed:", result.error);
        }

    } catch (e) {
        console.error("🔥 Exception during execution:", e);
    }

    process.exit(0);
}

runDebug().catch((e: any) => {
    console.error(e);
    process.exit(1);
});
