/**
 * Rolling Wave Queue
 *
 * Replaces the synchronous setInterval heartbeat in rollingWaveOrchestratorService
 * with isolated BullMQ jobs — one repeating job per active mission run.
 *
 * Benefits:
 * - One hung mission cycle can't block any other mission
 * - Natural retry/backoff on transient failures
 * - Survives server restarts (repeatable jobs persist in Redis)
 * - Follows the existing QueueService / Worker pattern
 */

import { Queue, Worker, type Job } from "bullmq";
import { createLogger } from "@server/utils/logger.js";
import { getRedisOptions } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("RollingWaveQueue");

const QUEUE_NAME = "oddjob-rolling-wave";
const WAVE_INTERVAL_MS = 5000;

// Track consecutive empty/idle cycles per mission run to reduce polling frequency
const idleCounts = new Map<number, number>();
const IDLE_THRESHOLD = 3;       // After 3 empty cycles, slow down
const IDLE_INTERVAL_MS = 30000; // 30s between pulses when idle

// ─── Queue (producer) ─────────────────────────────────────────────────────────

const connectionOpts = {
    ...getRedisOptions(),
    maxRetriesPerRequest: null,
};

export const rollingWaveQueue = new Queue(QUEUE_NAME, {
    connection: connectionOpts,
    defaultJobOptions: {
        attempts: 1,           // Don't retry — next pulse will pick up
        removeOnComplete: 10,
        removeOnFail: 50,
    },
});

export interface WaveCycleJobData {
    missionRunId: number;
    userId: string;
    orgId: number | null;
    priority?: number;
}

/**
 * Schedule a repeating wave cycle for a mission run.
 * Safe to call multiple times — upserts by jobId.
 */
export async function scheduleMissionWave(data: WaveCycleJobData): Promise<void> {
    const jobId = `wave-${data.missionRunId}`;
    await rollingWaveQueue.add(
        "wave-cycle",
        data,
        {
            jobId,
            repeat: { every: WAVE_INTERVAL_MS },
            priority: data.priority,
            removeOnComplete: 10,
            removeOnFail: 50,
        }
    );
    logger.info(`[RollingWaveQueue] Scheduled wave cycle for run ${data.missionRunId}`);
}

/**
 * Remove the repeating wave job for a completed/stopped mission run.
 */
export async function cancelMissionWave(missionRunId: number): Promise<void> {
    const jobId = `wave-${missionRunId}`;
    // Remove both potential repeat intervals
    await rollingWaveQueue.removeRepeatable("wave-cycle", { every: WAVE_INTERVAL_MS }, jobId).catch(() => {});
    await rollingWaveQueue.removeRepeatable("wave-cycle", { every: IDLE_INTERVAL_MS }, jobId).catch(() => {});
    
    logger.info(`[RollingWaveQueue] Cancelled all wave cycles for run ${missionRunId}`);
}

// Worker moved to rolling-wave-worker.ts
