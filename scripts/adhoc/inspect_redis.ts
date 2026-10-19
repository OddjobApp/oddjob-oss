import { redis } from "../../server/domain/core/infrastructure/redis/redis-client.js";

async function inspectRedis() {
    const jobId = "1d5f5df9-7850-4dab-a406-ceb34000ce87";
    console.log(`\n--- Inspecting Redis Job: ${jobId} ---`);

    try {
        const jobKey = `forge:job:${jobId}`;
        const raw = await redis.get(jobKey);
        
        if (!raw) {
            console.log("Job not found in Redis.");
            return;
        }

        console.log(raw);

    } catch (err) {
        console.error("Redis inspection failed:", err);
    } finally {
        process.exit(0);
    }
}

inspectRedis();
