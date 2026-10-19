import { forgeQueue } from "../../server/domain/apps/infrastructure/forge-queue.js";

async function checkCompleted() {
    try {
        console.log("--- Completed Jobs ---");
        const jobs = await forgeQueue.getCompleted();
        for (const job of jobs) {
            if (job.id?.includes("225661fc-6e3c-4cda-bd32-15793a3525d1")) {
                console.log(`Job Found in Completed: ${job.id}`);
                console.log(`Result: ${JSON.stringify(job.returnvalue, null, 2)}`);
                return;
            }
        }
        console.log("Job not found in Completed list.");
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkCompleted();
