import { Queue, Job, QueueEvents } from "bullmq";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { alerts } from "@shared/schema/index.js";

const logger = createLogger("DeadLetterQueue");


// Redis connection options
function getRedisOptions() {
    const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
    const password = process.env.REDIS_PASSWORD;

    let connectionOpts: any = {
        maxRetriesPerRequest: null,
    };

    if (redisUrl.startsWith("redis://")) {
        try {
            const url = new URL(redisUrl);
            connectionOpts.host = url.hostname;
            connectionOpts.port = parseInt(url.port || "6379");
            if (url.password) connectionOpts.password = url.password;
            if (url.username) connectionOpts.username = url.username;
        } catch (e) {
            connectionOpts.host = "127.0.0.1";
            connectionOpts.port = 6379;
        }
    }

    if (password) connectionOpts.password = password;
    return connectionOpts;
}



const DLQ_QUEUE_NAME = "oddjob-dlq";

export const dlqQueue = new Queue(DLQ_QUEUE_NAME, {
    connection: getRedisOptions(),
    defaultJobOptions: {
        removeOnComplete: false, // Keep failed jobs for inspection
        removeOnFail: false,
    }
});

export interface DLQEntry {
    originalQueue: string;
    originalJobId: string;
    jobName: string;
    data: any;
    failedAt: string;
    error: string;
    attemptsMade: number;
    stacktrace?: string[];
}

/**
 * Move a failed job to the dead letter queue
 */
export async function moveToDeadLetterQueue(
    failedJob: Job,
    error: Error,
    originalQueue: string
): Promise<void> {
    const dlqEntry: DLQEntry = {
        originalQueue,
        originalJobId: failedJob.id || "unknown",
        jobName: failedJob.name,
        data: failedJob.data,
        failedAt: new Date().toISOString(),
        error: error.message,
        attemptsMade: failedJob.attemptsMade,
        stacktrace: error.stack?.split("\n"),
    };

    await dlqQueue.add("failed-job", dlqEntry, {
        jobId: `dlq-${originalQueue}-${failedJob.id}-${Date.now()}`,
    });

    logger.error(`Job moved to DLQ: ${originalQueue}/${failedJob.id}`, {
        jobName: failedJob.name,
        error: error.message,
    });

    // Create an alert for failed jobs
    try {
        await db.insert(alerts).values({
            severity: "warning",
            category: "job_failure",
            message: `Job failed permanently: ${failedJob.name} in ${originalQueue}`,
            details: {
                queue: originalQueue,
                jobId: failedJob.id,
                error: error.message,
            },
        });
    } catch (alertError) {
        logger.warn("Failed to create DLQ alert", { error: alertError });
    }
}

/**
 * Get all jobs in the dead letter queue
 */
export async function getDLQJobs(limit: number = 100): Promise<Job[]> {
    return await dlqQueue.getJobs(["waiting", "delayed", "active"], 0, limit);
}

/**
 * Get DLQ statistics
 */
export async function getDLQStats(): Promise<{
    waiting: number;
    total: number;
}> {
    const waiting = await dlqQueue.getWaitingCount();
    const delayed = await dlqQueue.getDelayedCount();
    return {
        waiting,
        total: waiting + delayed,
    };
}

/**
 * Retry a job from the DLQ (moves back to original queue)
 */
export async function retryDLQJob(jobId: string): Promise<boolean> {
    const job = await dlqQueue.getJob(jobId);
    if (!job) {
        logger.warn(`DLQ job not found: ${jobId}`);
        return false;
    }

    const entry = job.data as DLQEntry;

    // Get the original queue
    const originalQueue = new Queue(entry.originalQueue, {
        connection: getRedisOptions(),
    });

    // Re-add to original queue
    await originalQueue.add(entry.jobName, entry.data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
    });

    // Remove from DLQ
    await job.remove();

    logger.info(`DLQ job retried: ${jobId} -> ${entry.originalQueue}`);
    return true;
}

/**
 * Purge a job from the DLQ
 */
export async function purgeDLQJob(jobId: string): Promise<boolean> {
    const job = await dlqQueue.getJob(jobId);
    if (!job) {
        return false;
    }
    await job.remove();
    logger.info(`DLQ job purged: ${jobId}`);
    return true;
}

/**
 * Purge all jobs from the DLQ
 */
export async function purgeDLQ(): Promise<number> {
    const jobs = await dlqQueue.getJobs(["waiting", "delayed"]);
    let purged = 0;
    for (const job of jobs) {
        await job.remove();
        purged++;
    }
    logger.info(`DLQ purged: ${purged} jobs removed`);
    return purged;
}

/**
 * Setup DLQ handlers for a queue
 * Call this after creating a worker to automatically handle failed jobs
 */
export function setupDLQHandler(queueName: string, queueEvents: QueueEvents): void {
    queueEvents.on("failed", async ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
        const queue = new Queue(queueName, { connection: getRedisOptions() });
        const job = await queue.getJob(jobId);

        if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
            // All retries exhausted, move to DLQ
            await moveToDeadLetterQueue(
                job,
                new Error(failedReason),
                queueName
            );
        }
    });

    logger.debug(`DLQ handler registered for queue: ${queueName}`);
}




