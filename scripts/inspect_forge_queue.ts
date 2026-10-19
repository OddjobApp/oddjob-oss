import { Queue } from 'bullmq';
import { getRedisOptions } from '../server/domain/core/infrastructure/redis/redis-client.js';

async function listJobs() {
    const queue = new Queue('app-forge', {
        connection: getRedisOptions() as any
    });

    const waiting = await queue.getWaiting();
    const active = await queue.getActive();
    const completed = await queue.getCompleted();
    const failed = await queue.getFailed();

    console.log(`Queue Status:`);
    console.log(`Waiting: ${waiting.length}`);
    console.log(`Active: ${active.length}`);
    console.log(`Completed: ${completed.length}`);
    console.log(`Failed: ${failed.length}`);

    if (completed.length > 0) {
        console.log(`\nRecently Completed Jobs:`);
        completed.slice(-5).forEach(j => {
            console.log(`- ${j.id}: ${j.name}`);
            console.log(`  Result: ${JSON.stringify(j.returnvalue, null, 2)}`);
        });
    }
    if (active.length > 0) {
        console.log(`\nActive Jobs:`);
        active.forEach(j => console.log(`- ${j.id}: ${j.name}`));
    }

    process.exit(0);
}

listJobs();
