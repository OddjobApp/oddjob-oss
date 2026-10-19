import { forgeQueue } from "../../server/domain/apps/infrastructure/forge-queue.js";
import { redis } from "../../server/domain/core/infrastructure/redis/redis-client.js";

async function checkSystem() {
    try {
        console.log("--- Queue Status ---");
        const counts = await forgeQueue.getJobCounts();
        console.log(JSON.stringify(counts, null, 2));

        const activeJobs = await forgeQueue.getActive();
        console.log(`Active Jobs: ${activeJobs.length}`);
        for (const job of activeJobs) {
             console.log(`- Job ${job.id}: ${job.data?.options?.slug || 'unknown'}`);
        }

        const waitingJobs = await forgeQueue.getWaiting();
        console.log(`Waiting Jobs: ${waitingJobs.length}`);
        for (const job of waitingJobs) {
             console.log(`- Job ${job.id}: ${job.data?.options?.slug || 'unknown'}`);
        }

        console.log("\n--- Redis Job Status ---");
        const jobId = "225661fc-6e3c-4cda-bd32-15793a3525d1";
        const status = await redis.get(`forge:job:${jobId}`);
        console.log(`Job ${jobId} Status: ${status}`);

        process.exit(0);
    } catch (err) {
        console.error("Error checking system:", err);
        process.exit(1);
    }
}

checkSystem();
