import { Queue } from 'bullmq';
import { createLogger } from "@server/utils/logger.js";
import { getRedisOptions } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("InnovationQueue");
const QUEUE_NAME = 'governor-innovation';

export const innovationQueue = new Queue(QUEUE_NAME, {
    connection: getRedisOptions() as any,
    defaultJobOptions: {
        attempts: 1, // Evolution scans can be retried in next cycle
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
    }
});

/**
 * Registers the 12-hour repeatable job for trust-graph evolution.
 */
export async function initInnovationSchedule() {
    logger.info("Initializing 12-hour Innovation Lab schedule...");
    
    // Pattern: 0 0,12 * * * (Every day at midnight and noon)
    await innovationQueue.add('evolution-scan', {}, {
        repeat: {
            pattern: '0 0,12 * * *',
        },
        jobId: 'innovation-lab-cycle', // Singleton job across restarts
    });
    
    logger.info("Innovation Lab schedule registered successfully.");
}
