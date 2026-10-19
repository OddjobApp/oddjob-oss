import { redis } from "../../server/domain/core/infrastructure/redis/redis-client.js";

async function checkJob(jobId: string) {
    try {
        console.log(`Checking status for job: ${jobId}`);
        const status = await redis.get(`forge:job:${jobId}`);
        if (status) {
            console.log("Job status found:");
            console.log(JSON.stringify(JSON.parse(status), null, 2));
        } else {
            console.log("No status found for this job ID in Redis.");
        }
        process.exit(0);
    } catch (err) {
        console.error("Error checking job status:", err);
        process.exit(1);
    }
}

const jobId = "225661fc-6e3c-4cda-bd32-15793a3525d1";
checkJob(jobId);
