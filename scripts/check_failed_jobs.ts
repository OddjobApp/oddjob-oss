import { Queue } from 'bullmq';
import { getRedisOptions } from '../server/domain/core/infrastructure/redis/redis-client.js';

async function check() {
    const queue = new Queue('app-forge', {
        connection: getRedisOptions() as any
    });
    const failed = await queue.getFailed();
    console.log(`Failed Jobs: ${failed.length}`);
    failed.slice(-5).forEach(j => {
        console.log(`- ${j.id}: ${j.failedReason}`);
    });
    process.exit(0);
}

check();
