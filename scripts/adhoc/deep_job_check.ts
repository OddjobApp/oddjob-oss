import { forgeQueue } from "../../server/domain/apps/infrastructure/forge-queue.js";

async function checkFailed() {
    try {
        console.log("--- Failed Jobs ---");
        const failedJobs = await forgeQueue.getFailed();
        console.log(`Checking ${failedJobs.length} failed jobs...`);
        for (const job of failedJobs) {
            if (job.id?.includes("225661fc-6e3c-4cda-bd32-15793a3525d1")) {
                console.log(`Job Found in Failed: ${job.id}`);
                console.log(`Reason: ${job.failedReason}`);
                return;
            }
        }

        console.log("--- Waiting Jobs ---");
        const waitingJobs = await forgeQueue.getWaiting();
        for (const job of waitingJobs) {
            if (job.id?.includes("225661fc-6e3c-4cda-bd32-15793a3525d1")) {
                console.log(`Job Found in Waiting: ${job.id}`);
                return;
            }
        }

        console.log("Job not found in Recent failed or waiting lists.");
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkFailed();
