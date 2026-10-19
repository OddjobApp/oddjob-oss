import { forgeQueue } from "../../server/domain/apps/infrastructure/forge-queue.js";

async function findJob() {
    try {
        const jobId = "forge-225661fc-6e3c-4cda-bd32-15793a3525d1";
        const job = await forgeQueue.getJob(jobId);
        if (job) {
            console.log(`Job ${jobId} found in BullMQ:`);
            console.log(`Status: ${await job.getState()}`);
            console.log(`Data: ${JSON.stringify(job.data, null, 2)}`);
        } else {
            console.log(`Job ${jobId} NOT found in BullMQ.`);
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

findJob();
