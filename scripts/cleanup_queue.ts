
import { dynamicMissionQueue } from "../server/domain/mission/infrastructure/dynamic-mission-queue.js";

async function cleanup() {
    console.log("Cleaning up active jobs...");
    const active = await dynamicMissionQueue.getActive();
    console.log(`Found ${active.length} active jobs.`);
    
    for (const job of active) {
        console.log(`Removing active job ${job.id}`);
        await job.remove();
    }
    
    console.log("Cleaning up waiting jobs...");
    const waiting = await dynamicMissionQueue.getWaiting();
    for (const job of waiting) {
        console.log(`Removing waiting job ${job.id}`);
        await job.remove();
    }
    
    process.exit(0);
}

cleanup().catch(console.error);
