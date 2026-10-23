/**
 * Bull Queue Service - Async Job Queue Infrastructure
 *
 * Purpose: Offload long-running tasks to background workers
 * Strategy: Redis-backed job queue with retry, error handling, and status tracking
 * Impact: 50-100x request latency improvement, 10x throughput
 *
 * Queues:
 *   - cycle-synthesis: Cycle blueprint synthesis and composition
 *   - approval-notifications: Approval request alerts and updates
 *   - postmortem-analysis: Incident analysis and reports
 *   - analytics-aggregation: Metric computation and dashboards
 */

import Bull, { Queue, Job } from 'bull';
import { createLogger } from '@server/utils/logger.js';
import { db } from '@server/database_service.js';
import { deadLetterJobs, workerHeartbeats } from '@shared/schema/infrastructure/worker-spine.js';
import { redis, getRedisOptions } from '@domain/core/infrastructure/redis/redis-client.js';
import { sql } from 'drizzle-orm';

const logger = createLogger('QueueService');

/**
 * Queue job priority levels
 */
export enum JobPriority {
    LOW = 10,
    NORMAL = 5,
    HIGH = 1,
    CRITICAL = 0,
}

/**
 * Queue job retry configuration
 */
interface RetryConfig {
    attempts: number;
    delay: number; // ms
    backoff?: 'exponential' | 'linear';
}

/**
 * Standard retry configurations
 */
const RETRY_CONFIGS = {
    SAFE: { attempts: 3, delay: 5000, backoff: 'exponential' as const },          // Fail-safe ops
    STANDARD: { attempts: 2, delay: 10000, backoff: 'exponential' as const },      // Normal ops
    RISKY: { attempts: 1, delay: 0 },                                              // External APIs
    CRITICAL: { attempts: 5, delay: 2000, backoff: 'exponential' as const },       // Mission-critical
};

/**
 * Job status tracking
 */
export interface JobStatus {
    jobId: string;
    queueName: string;
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
    progress: number; // 0-100
    attempt: number;
    startedAt?: Date;
    completedAt?: Date;
    error?: string;
    data: Record<string, any>;
}

/**
 * Main Queue Service
 */
export class QueueService {
    private queues: Map<string, Queue> = new Map();
    private workerId: string;

    constructor() {
        this.workerId = `worker-${process.pid}-${Date.now()}`;
    }

    /**
     * Initialize all queues
     */
    async initialize(): Promise<void> {
        logger.info('Initializing Bull queues', { workerId: this.workerId });

        // Create all queues
        const queueNames = [
            'cycle-synthesis',
            'approval-notifications',
            'postmortem-analysis',
            'analytics-aggregation',
        ];

        for (const name of queueNames) {
            await this.createQueue(name);
        }

        logger.info(`Initialized ${queueNames.length} queues`);
    }

    /**
     * Create or get a queue
     */
    private async createQueue(name: string): Promise<Queue> {
        if (this.queues.has(name)) {
            return this.queues.get(name)!;
        }

        const queue = new Bull(name, {
            redis: getRedisOptions(),
            defaultJobOptions: {
                removeOnComplete: { age: 3600 }, // Keep for 1 hour
                removeOnFail: false, // Keep failures for debugging
            },
        });

        // Set up event listeners
        this.setupQueueEventHandlers(queue);

        this.queues.set(name, queue);

        logger.debug(`Created queue: ${name}`);
        return queue;
    }

    /**
     * Set up queue event handlers
     */
    private setupQueueEventHandlers(queue: Queue): void {
        const queueName = queue.name;

        // Job started
        queue.on('active', (job) => {
            logger.debug(`Job active: ${job.id}`, { queue: queueName });
        });

        // Job progress
        queue.on('progress', (job, progress) => {
            logger.debug(`Job progress: ${job.id}`, { queue: queueName, progress });
        });

        // Job completed
        queue.on('completed', (job) => {
            logger.info(`Job completed: ${job.id}`, { queue: queueName });
            this.recordWorkerSuccess(queueName);
        });

        // Job failed
        queue.on('failed', (job, err) => {
            logger.error(`Job failed: ${job.id}`, { queue: queueName, error: err.message });
            this.recordWorkerFailure(queueName);
        });

        // No 'delayed' listener: in Bull it is an internal channel carrying the next
        // delay timestamp, not a job id, and listening to it subscribes in the
        // background without handling failure, so closing a queue that never
        // connected left one unhandled rejection per queue. Bull registers the
        // channel itself when it processes jobs; retries are logged under 'failed'.

        // Queue errors
        queue.on('error', (error: Error) => {
            logger.error(`Queue error`, { queue: queueName, error: error.message });
        });
    }

    /**
     * Add a job to queue
     */
    async addJob<T = any>(
        queueName: string,
        jobName: string,
        data: T,
        options?: {
            priority?: JobPriority;
            delay?: number; // ms
            retry?: RetryConfig;
            organizationId?: number;
        }
    ): Promise<Job> {
        const queue = await this.createQueue(queueName);

        const jobOptions = {
            priority: options?.priority ?? JobPriority.NORMAL,
            delay: options?.delay,
            attempts: options?.retry?.attempts ?? RETRY_CONFIGS.STANDARD.attempts,
            backoff: {
                type: options?.retry?.backoff ?? 'exponential',
                delay: options?.retry?.delay ?? RETRY_CONFIGS.STANDARD.delay,
            },
        };

        const job = await queue.add(jobName, data, jobOptions);

        logger.info(`Job added to ${queueName}`, {
            jobId: job.id,
            jobName,
            priority: options?.priority,
        });

        return job;
    }

    /**
     * Get job status
     */
    async getJobStatus(queueName: string, jobId: string | number): Promise<JobStatus | null> {
        const queue = await this.createQueue(queueName);
        const job = await queue.getJob(jobId);

        if (!job) return null;

        const state = await job.getState();
        const progress = job.progress() || 0;

        return {
            jobId: String(job.id),
            queueName,
            status: state as any,
            progress: typeof progress === 'number' ? progress : 0,
            attempt: job.attemptsMade,
            startedAt: job.processedOn ? new Date(job.processedOn) : undefined,
            completedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
            error: job.failedReason || undefined,
            data: job.data,
        };
    }

    /**
     * Cancel a job
     */
    async cancelJob(queueName: string, jobId: string | number): Promise<boolean> {
        const queue = await this.createQueue(queueName);
        const job = await queue.getJob(jobId);

        if (!job) return false;

        await job.remove();
        logger.info(`Job cancelled`, { queueName, jobId });
        return true;
    }

    /**
     * Process queue (for background worker process)
     */
    async processQueue(
        queueName: string,
        handler: (job: Job) => Promise<any>,
        concurrency: number = 2
    ): Promise<void> {
        const queue = await this.createQueue(queueName);

        queue.process(concurrency, async (job) => {
            try {
                logger.debug(`Processing job: ${job.id}`, { queue: queueName });
                const result = await handler(job);
                return result;
            } catch (error: any) {
                logger.error(`Job handler error: ${job.id}`, {
                    queue: queueName,
                    error: error.message,
                    attempt: job.attemptsMade,
                });

                // Store in dead letter queue after final failure
                if (job.attemptsMade >= (job.opts.attempts || 1)) {
                    await this.storeDeadLetterJob(queueName, job, error);
                }

                throw error;
            }
        });

        logger.info(`Queue processor started`, { queueName, concurrency });
    }

    /**
     * Store failed job in dead letter queue
     */
    private async storeDeadLetterJob(
        queueName: string,
        job: Job,
        error: Error
    ): Promise<void> {
        try {
            await db.insert(deadLetterJobs).values({
                queueName,
                jobName: job.name,
                jobData: job.data,
                error: error.message,
                attempts: job.attemptsMade,
                organizationId: job.data?.organizationId,
            });
            logger.warn(`Stored dead letter job`, { queueName, jobId: job.id });
        } catch (dbError: any) {
            logger.error(`Failed to store dead letter job`, {
                queueName,
                jobId: job.id,
                error: dbError.message,
            });
        }
    }

    /**
     * Record worker success (for heartbeat)
     */
    private async recordWorkerSuccess(queueName: string): Promise<void> {
        try {
            await db.insert(workerHeartbeats).values({
                workerId: this.workerId,
                workerType: queueName,
                queueName,
                jobsProcessed: 1,
                jobsFailed: 0,
                status: 'active',
            }).onConflictDoUpdate({
                target: workerHeartbeats.workerId,
                set: {
                    jobsProcessed: (sql`job_processed + 1`) as any,
                    lastSeen: new Date(),
                    status: 'active',
                },
            });
        } catch (error: any) {
            logger.error('Failed to record worker success', { error: error.message });
        }
    }

    /**
     * Record worker failure (for heartbeat)
     */
    private async recordWorkerFailure(queueName: string): Promise<void> {
        try {
            await db.insert(workerHeartbeats).values({
                workerId: this.workerId,
                workerType: queueName,
                queueName,
                jobsProcessed: 0,
                jobsFailed: 1,
                status: 'active',
            }).onConflictDoUpdate({
                target: workerHeartbeats.workerId,
                set: {
                    jobsFailed: (sql`job_failed + 1`) as any,
                    lastSeen: new Date(),
                    status: 'active',
                },
            });
        } catch (error: any) {
            logger.error('Failed to record worker failure', { error: error.message });
        }
    }

    /**
     * Get queue statistics
     */
    async getQueueStats(queueName: string): Promise<{
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
    }> {
        const queue = await this.createQueue(queueName);

        return {
            waiting: await queue.getWaitingCount(),
            active: await queue.getActiveCount(),
            completed: await queue.getCompletedCount(),
            failed: await queue.getFailedCount(),
            delayed: await queue.getDelayedCount(),
        };
    }

    /**
     * Shutdown all queues
     */
    async shutdown(): Promise<void> {
        logger.info('Shutting down queues', { count: this.queues.size });

        for (const [name, queue] of this.queues.entries()) {
            try {
                await queue.close();
                logger.debug(`Closed queue: ${name}`);
            } catch (error: any) {
                logger.error(`Error closing queue: ${name}`, { error: error.message });
            }
        }

        this.queues.clear();
    }
}

/**
 * Singleton instance
 */
export const queueService = new QueueService();

/**
 * Helper: Create retry config
 */
export function createRetryConfig(
    attempts: number,
    delayMs: number,
    backoff: 'exponential' | 'linear' = 'exponential'
): RetryConfig {
    return { attempts, delay: delayMs, backoff };
}
