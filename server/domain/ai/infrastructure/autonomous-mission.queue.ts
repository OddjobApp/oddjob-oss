/**
 * Autonomous Mission Queue
 * 
 * Distributed BullMQ task queue for executing long-horizon autonomous agent missions.
 * Decouples agent reasoning and multi-step execution DAGs from foreground HTTP requests.
 */

import { Queue, Job } from "bullmq";
import { createLogger } from "@server/utils/logger.js";
import { getRedisOptions } from "@domain/core/infrastructure/redis/redis-client.js";
import type { TaskManifest } from "../core/autonomous-lifecycle.service.js";

const logger = createLogger("AutonomousMissionQueue");
export const AUTONOMOUS_MISSION_QUEUE_NAME = "oddjob-autonomous-mission";

export interface AutonomousMissionJobData {
    missionId: string;
    sessionId: string;
    agentId: number;
    organizationId: number;
    manifest: TaskManifest;
    tokenBudget?: number;
    resumeFromCheckpoint?: boolean;
    contextSnapshot?: Record<string, any>;
}

const connectionOpts = {
    ...getRedisOptions(),
    maxRetriesPerRequest: null,
};

export const autonomousMissionQueue = new Queue<AutonomousMissionJobData>(AUTONOMOUS_MISSION_QUEUE_NAME, {
    connection: connectionOpts,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 5000,
        },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
    },
});

/**
 * Dispatches an autonomous agent mission to the background execution queue.
 */
export async function dispatchAutonomousMission(
    data: AutonomousMissionJobData,
    delayMs: number = 0
): Promise<Job<AutonomousMissionJobData>> {
    const jobId = `mission-${data.missionId}-${Date.now()}`;
    logger.info(`[AutonomousMissionQueue] Enqueueing mission ${data.missionId} (Session: ${data.sessionId}, Resume: ${Boolean(data.resumeFromCheckpoint)})`);

    return await autonomousMissionQueue.add("execute_mission", data, {
        delay: delayMs,
        jobId,
    });
}

/**
 * Inspects the status of an autonomous mission job.
 */
export async function getAutonomousMissionJob(jobId: string): Promise<Job<AutonomousMissionJobData> | undefined> {
    return await autonomousMissionQueue.getJob(jobId);
}
