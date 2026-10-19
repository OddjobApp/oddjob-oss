import { Queue } from 'bullmq';
import { getRedisOptions } from '../server/domain/core/infrastructure/redis/redis-client.js';

async function check() {
    const queue = new Queue('app-forge', {
        connection: getRedisOptions() as any
    });
    const completed = await queue.getCompleted();
    const failed = await queue.getFailed();
    
    console.log("--- Completed Test Apps ---");
    completed.filter(j => j.id?.includes('test-spa-app') || j.id?.includes('test-analytics-app')).forEach(j => {
        console.log(`- ${j.id}: ${JSON.stringify(j.returnvalue, null, 2)}`);
    });

    console.log("\n--- Failed Test Apps ---");
    failed.filter(j => j.id?.includes('test-spa-app') || j.id?.includes('test-analytics-app')).forEach(j => {
        console.log(`- ${j.id}: ${j.failedReason}`);
    });
    process.exit(0);
}

check();
