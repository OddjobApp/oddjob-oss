/**
 * Dynamic Mission Queue
 * 
 * Replaces monolithic polling loops with a distributed BullMQ task queue.
 * Enables horizontal scaling of mission orchestrators and AI reasoning.
 */

import { Queue, Job } from 'bullmq';
import { createLogger } from "@server/utils/logger.js";
import { BaseWorker } from "@server/workers/base-worker.js";
import { getRedisOptions } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("DynamicMissionQueue");
const QUEUE_NAME = 'oddjob-dynamic-mission';

export interface MissionCycleJobData {
    missionRunId: number;
    userId: string;
    orgId: number | null;
    /**
     * How many times this cycle has been re-queued purely because the org was at
     * its concurrency limit (or the system was overloaded) — i.e. it never got to
     * run. Bounded so a permanently saturated org still terminates instead of
     * re-queueing forever. Not incremented for real execution failures.
     */
    admissionYields?: number;
}

const connectionOpts = {
    ...getRedisOptions(),
    maxRetriesPerRequest: null,
};

// --- Producer ---

export const dynamicMissionQueue = new Queue(QUEUE_NAME, {
    connection: connectionOpts,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
    }
});

/**
 * Enqueue a new cycle for a dynamic mission.
 */
export async function queueMissionCycle(data: MissionCycleJobData, delayMs: number = 0) {
    console.log(`[Queue] Queueing cycle for run ${data.missionRunId} (delay: ${delayMs}ms)`);
    logger.debug(`Queueing cycle for run ${data.missionRunId} (delay: ${delayMs}ms)`);
    return await dynamicMissionQueue.add('cycle', data, {
        delay: delayMs,
        jobId: `mission-${data.missionRunId}-${Date.now()}` // Allow multiple cycles over time
    });
}

// Worker moved to dynamic-mission-worker.ts
