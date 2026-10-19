import { Worker, type Job } from "bullmq";
import { createLogger } from "@server/utils/logger.js";
import { getRedisOptions, redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { WaveCycleJobData, cancelMissionWave } from "./rolling-wave-queue.js";
import { missionTimeoutService } from "../core/mission-timeout.service.js";
import { registerWorker, ensureShutdownHandlers } from "@server/utils/graceful-shutdown.js";
ensureShutdownHandlers();

const logger = createLogger("RollingWaveWorker");
const QUEUE_NAME = "oddjob-rolling-wave";

// Track consecutive empty/idle cycles per mission run to reduce polling frequency
const idleCounts = new Map<number, number>();
const IDLE_THRESHOLD = 3;       // After 3 empty cycles, slow down
const IDLE_INTERVAL_MS = 30000; // 30s between pulses when idle

// A lower-id 'active' run that hasn't heartbeated for this long is treated as a
// zombie and reaped before the concurrency gate counts it — so an orphaned run
// can't hold an org's concurrency slot forever (independent of the periodic
// maintenance sweep, which may be disabled via SKIP_WORKERS). Shorter than the
// 60m global sweep because this is the sensitive chokepoint; still far above a
// healthy run's per-pulse heartbeat cadence, so live long-planning runs are safe.
const STALE_BLOCKER_MINUTES = Number(process.env.MISSION_STALE_BLOCKER_MINUTES) > 0
    ? Number(process.env.MISSION_STALE_BLOCKER_MINUTES)
    : 30;

const connectionOpts = {
    ...getRedisOptions(),
    maxRetriesPerRequest: null,
};

let worker: Worker | null = null;

export function startRollingWaveWorker(): void {
    if (worker) return;

    worker = new Worker(
        QUEUE_NAME,
        async (job: Job<WaveCycleJobData>) => {
            const { missionRunId, userId, orgId } = job.data;
            
            // 0. Prevent concurrent processing of the SAME mission run ID across worker fleet
            const lockKey = `lock:wave-cycle:${missionRunId}`;
            const lock = await redis.set(lockKey, 'locked', 'PX', 300000, 'NX');
            if (!lock) {
                logger.info(`[RollingWaveWorker] Run ${missionRunId} is already being processed by another worker/job. Skipping this pulse.`);
                return { status: 'skipped', reason: 'concurrency_lock' };
            }

            try {
                logger.debug(`[RollingWaveWorker] Processing cycle for run ${missionRunId}`);

                // 0. System Admission Control (Governor)
                const { ResourceGovernor } = await import("../../governance/core/resource-governor.js");
                const health = ResourceGovernor.getSystemHealth();
                if (health.status === 'critical') {
                    logger.warn(`[RollingWaveWorker] Run ${missionRunId} yielding: System is in CRITICAL state (CPU ${Math.round(health.cpuLoad * 100)}%).`);
                    throw new Error("SYSTEM_OVERLOAD: Resource limit reached.");
                }

                // 0. Enforce Organizational Concurrency Limit
                if (orgId) {
                    try {
                        const { deploymentProfileService } = await import("../../ai/core/deployment-profile.service.js");
                        const limit = await deploymentProfileService.getMissionConcurrency(orgId);

                        const { db } = await import("../../../database_service.js");
                        const { missionRuns } = await import("@shared/schema/index.js");
                        const { eq, and, sql } = await import("drizzle-orm");

                        // Self-heal: reap any stale/orphaned lower-id 'active' runs in this
                        // org BEFORE counting, so a zombie (no heartbeat, wave job gone)
                        // can't hold the concurrency slot and starve every later mission.
                        const { reapStaleActiveRuns } = await import("./mission-maintenance.js");
                        const { reapedIds } = await reapStaleActiveRuns({
                            orgId,
                            belowRunId: missionRunId,
                            staleMinutes: STALE_BLOCKER_MINUTES,
                        });
                        if (reapedIds.length > 0) {
                            logger.warn(`[RollingWaveWorker] Run ${missionRunId}: reaped ${reapedIds.length} stale blocker run(s) in org ${orgId}: ${reapedIds.join(', ')}`);
                        }

                        // Count other (live) active runs in this org
                        const activeRuns = await db.select({ count: sql`count(*)` })
                            .from(missionRuns)
                            .where(and(
                                eq(missionRuns.organizationId, orgId),
                                eq(missionRuns.status, 'active'),
                                sql`${missionRuns.id} < ${missionRunId}` // Only yield to LOWER IDs (earlier missions)
                            ));
                        
                        const activeCount = Number(activeRuns[0]?.count || 0);

                        if (activeCount >= limit) {
                            logger.info(`[RollingWaveWorker] Run ${missionRunId} yielding: Org ${orgId} has ${activeCount} active missions (Limit: ${limit}).`);
                            // Throw to trigger BullMQ retry (sequential processing)
                            throw new Error(`CONCURRENCY_LIMIT_REACHED: Org ${orgId} is busy.`);
                        }
                    } catch (err: any) {
                        if (err.message.includes('CONCURRENCY_LIMIT_REACHED')) throw err;
                        logger.error(`[RollingWaveWorker] Concurrency check failed for run ${missionRunId}: ${err.message}`);
                    }
                }

                // 1. Check for timeout before processing
                const wasTerminated = await missionTimeoutService.checkAndEnforceTimeout(missionRunId);
                if (wasTerminated) {
                    logger.info(`[RollingWaveWorker] Run ${missionRunId} terminated due to timeout, skipping cycle`);
                    idleCounts.delete(missionRunId);
                    return { status: 'terminated', reason: 'timeout' };
                }

                const { rollingWaveOrchestratorService } = await import(
                    "../core/rolling-wave-orchestrator.service.js"
                );

                await rollingWaveOrchestratorService.processMissionCycle(missionRunId, userId, orgId);

                // Idle detection: if the mission is in WAITING_FOR_ORDERS phase, increment idle count
                // and reschedule at the slower interval to avoid busy-polling a paused mission
                const { db } = await import("../../../database_service.js");
                const { missionRuns } = await import("@shared/schema/index.js");
                const { eq } = await import("drizzle-orm");
                const [run] = await db.select({ missionContext: missionRuns.missionContext })
                    .from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);

                const phase = (run?.missionContext as any)?.phase;
                if (phase === 'WAITING_FOR_ORDERS') {
                    const count = (idleCounts.get(missionRunId) ?? 0) + 1;
                    idleCounts.set(missionRunId, count);
                    if (count === IDLE_THRESHOLD) {
                        logger.info(`[RollingWaveWorker] Run ${missionRunId} idle after ${count} cycles — throttling to ${IDLE_INTERVAL_MS}ms`);
                        const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
                        eventStream.publish('mission.idle', { missionRunId }, { subject: `mission-run:${missionRunId}` }, 'rolling-wave').catch(() => {});
                        
                        // 1. Add slow interval first (Safety: ensure we have a pulse)
                        const slowQueue = new (await import("bullmq")).Queue(QUEUE_NAME, { connection: connectionOpts });
                        await slowQueue.add('wave-cycle', { missionRunId, userId, orgId }, {
                            jobId: `wave-${missionRunId}`,
                            repeat: { every: IDLE_INTERVAL_MS },
                            removeOnComplete: 10,
                            removeOnFail: 50,
                        });
                        await slowQueue.close();

                        // 2. Then remove the fast interval
                        await cancelMissionWave(missionRunId).catch(err => {
                            logger.warn(`[RollingWaveWorker] Failed to cancel fast interval for run ${missionRunId} (New interval is already active): ${err.message}`);
                        });
                    }
                } else {
                    // Reset idle count on any active phase transition
                    idleCounts.delete(missionRunId);
                }
            } finally {
                // Release lock
                await redis.del(lockKey);
            }
        },
        {
            connection: connectionOpts,
            concurrency: 10, // 10 missions can process simultaneously
        }
    );

    worker.on("failed", (job, err) => {
        logger.error(`[RollingWaveWorker] Job ${job?.id} failed: ${err.message}`);
    });

    logger.info("[RollingWaveWorker] Worker started (concurrency: 10)");
    registerWorker({ close: () => worker?.close() ?? Promise.resolve() }, "RollingWaveWorker");
}

export function stopRollingWaveWorker(): Promise<void> {
    return worker?.close() ?? Promise.resolve();
}
