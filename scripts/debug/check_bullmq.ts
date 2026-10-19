
import { Queue } from 'bullmq';

const redisOptions = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
};

async function main() {
    const queue = new Queue('knowledge-extractions', { connection: redisOptions });

    const counts = await queue.getJobCounts();
    console.log("Job Counts:", JSON.stringify(counts, null, 2));

    const failed = await queue.getFailed();
    console.log(`Failed Jobs (${failed.length}):`);
    failed.slice(0, 5).forEach(job => {
        console.log(`- Job ${job.id}: ${job.failedReason}`);
        // console.log("Stacktrace:", job.stacktrace);
    });

    await queue.close();
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
