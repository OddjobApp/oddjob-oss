import { Job } from 'bullmq';
import { createLogger } from "@server/utils/logger.js";
import { BaseWorker } from "@server/workers/base-worker.js";
import { MissionCycleJobData } from "./dynamic-mission-queue.js";
import { dynamicOrchestratorService } from "../core/dynamic-orchestrator.service.js";
import { missionTimeoutService } from "../core/mission-timeout.service.js";
import { db } from "@server/database_service.js";
import { missionRuns } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";

const logger = createLogger("DynamicMissionWorker");
const QUEUE_NAME = 'oddjob-dynamic-mission';

/**
 * Errors raised by the admission checks in `execute` before any mission work
 * happens. They mean "not now", not "this run is broken", so they are re-queued
 * rather than counted against the run.
 */
const ADMISSION_YIELD_MARKERS = ["CONCURRENCY_LIMIT_REACHED", "SYSTEM_OVERLOAD"];
const MAX_ADMISSION_YIELDS = 20;

/**
 * How long an 'active' run may go without a heartbeat before the admission gate
 * treats it as a dead blocker and reaps it inline. Mirrors the rolling-wave
 * worker: shorter than the 60m global sweep because this is the chokepoint, but
 * far above a healthy run's pulse cadence so live long-planning runs are safe.
 */
const STALE_BLOCKER_MINUTES = Number(process.env.MISSION_STALE_BLOCKER_MINUTES) > 0
    ? Number(process.env.MISSION_STALE_BLOCKER_MINUTES)
    : 30;
const ADMISSION_RETRY_BASE_MS = 15_000;
const ADMISSION_RETRY_MAX_MS = 5 * 60_000;

function isAdmissionYield(message: string | undefined): boolean {
    return !!message && ADMISSION_YIELD_MARKERS.some(marker => message.includes(marker));
}

export class DynamicMissionWorker extends BaseWorker<MissionCycleJobData> {
    constructor() {
        super(QUEUE_NAME, {
            concurrency: 10, // Increase global concurrency to allow multiple orgs, but soft-limit per org
        });
    }

    protected async execute(job: Job<MissionCycleJobData>): Promise<any> {
        const { missionRunId, userId, orgId } = job.data;
        this.logger.info(`Starting cycle for mission run ${missionRunId}`);

        // 0. System Admission Control (Governor)
        const { ResourceGovernor } = await import("../../governance/core/resource-governor.js");
        const health = ResourceGovernor.getSystemHealth();
        if (health.status === 'critical') {
            this.logger.warn(`Mission run ${missionRunId} yielding: System is in CRITICAL state (CPU ${Math.round(health.cpuLoad * 100)}%).`);
            throw new Error("SYSTEM_OVERLOAD: Resource limit reached.");
        }

        // 1. Enforce Organizational Concurrency Limit
        if (orgId) {
            try {
                const { deploymentProfileService } = await import("../../ai/core/deployment-profile.service.js");
                const limit = await deploymentProfileService.getMissionConcurrency(orgId);

                // Self-heal: reap stale/orphaned lower-id 'active' runs in this org
                // BEFORE counting, so a zombie (no heartbeat, its job gone) can't hold
                // the concurrency slot and starve every later mission. The rolling-wave
                // worker has done this for a while; this gate never learned to, so a
                // killed worker's rows blocked the org until the 60m periodic sweep.
                const { reapStaleActiveRuns } = await import("./mission-maintenance.js");
                const { reapedIds } = await reapStaleActiveRuns({
                    orgId,
                    belowRunId: missionRunId,
                    staleMinutes: STALE_BLOCKER_MINUTES,
                });
                if (reapedIds.length > 0) {
                    this.logger.warn(`Run ${missionRunId}: reaped ${reapedIds.length} stale blocker run(s) in org ${orgId}: ${reapedIds.join(', ')}`);
                }

                // Count only EARLIER (lower-id) active runs.
                //
                // This was `!=`, which counted later runs too — so with a limit of 1,
                // runs 86/87/88 each saw the others as blockers and every one of them
                // yielded. Nothing could ever start: a mutual standoff that burned all
                // 20 admission yields and then failed the run. Yielding only to earlier
                // missions makes the ordering a total order, so exactly one run at the
                // front is always admitted. Matches the rolling-wave worker.
                const activeRuns = await db.select({ count: sql`count(*)` })
                    .from(missionRuns)
                    .where(and(
                        eq(missionRuns.organizationId, orgId),
                        eq(missionRuns.status, 'active'),
                        sql`${missionRuns.id} < ${missionRunId}`
                    ));

                const activeCount = Number(activeRuns[0]?.count || 0);

                if (activeCount >= limit) {
                    this.logger.info(`Mission run ${missionRunId} delayed: Org ${orgId} reached concurrency limit (${activeCount}/${limit}).`);
                    await db.update(missionRuns).set({
                        missionContext: sql`COALESCE(${missionRuns.missionContext}, '{}'::jsonb) || jsonb_build_object('admissionControl', jsonb_build_object('state', 'queued', 'reason', 'organization_concurrency', 'activeCount', ${activeCount}, 'limit', ${limit}, 'checkedAt', NOW()))`,
                    }).where(eq(missionRuns.id, missionRunId));
                    await job.updateProgress(0);
                    throw new Error(`CONCURRENCY_LIMIT_REACHED: Org ${orgId} is at ${activeCount}/${limit} active runs.`);
                }

                // The run owns a slot now; remove stale queue state so the UI does
                // not continue reporting an admission blocker during execution.
                await db.update(missionRuns).set({
                    missionContext: sql`COALESCE(${missionRuns.missionContext}, '{}'::jsonb) - 'admissionControl'`,
                }).where(eq(missionRuns.id, missionRunId));
            } catch (err: any) {
                if (err.message.includes('CONCURRENCY_LIMIT_REACHED')) throw err;
                this.logger.error(`Failed to verify concurrency for run ${missionRunId}: ${err.message}`);
            }
        }

        // 2. Check for timeout before processing
        const wasTerminated = await missionTimeoutService.checkAndEnforceTimeout(missionRunId);
        if (wasTerminated) {
            this.logger.info(`Mission run ${missionRunId} terminated due to timeout, skipping cycle`);
            return { status: 'terminated', reason: 'timeout' };
        }

        try {
            // Route to the correct orchestrator based on executionStrategy in context
            const [run] = await db.select({ missionContext: missionRuns.missionContext })
                .from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
            const strategy = (run?.missionContext as any)?.executionStrategy;

            if (strategy === 'parallel_fan_out') {
                const { parallelFanOutOrchestratorService } = await import("../core/parallel-fan-out-orchestrator.service.js");
                return await parallelFanOutOrchestratorService.processFanOutCycle(missionRunId, userId, orgId);
            }

            const result = await dynamicOrchestratorService.processMissionCycle(missionRunId, userId, orgId);

            // If this was a reactive mission, return to listening after cycle
            if (strategy === 'reactive') {
                const { reactiveOrchestratorService } = await import("../core/reactive-orchestrator.service.js");
                await reactiveOrchestratorService.returnToListening(missionRunId);
            }

            return result;
        } catch (err: any) {
            this.logger.error(`Cycle for run ${missionRunId} failed: ${err.message}`);
            throw err;
        }
    }

    protected setupListeners() {
        super.setupListeners();
        this.worker.on("failed", async (job, err) => {
            if (!job || job.attemptsMade < (job.opts.attempts || 1)) return;

            const { missionRunId, userId, orgId, admissionYields = 0 } =
                job.data as MissionCycleJobData;

            /*
              A cycle that never got to run because the org was at its concurrency
              limit (or the system was overloaded) has not failed — it queued. The
              admission checks above signal that by throwing, which spends a BullMQ
              attempt, so with attempts: 3 a mission that simply waited its turn
              three times was permanently marked failed:
              "Distributed cycle failed after 3 attempts: CONCURRENCY_LIMIT_REACHED".
              With a per-org limit of 1 that is the normal case, not an edge case.

              Re-queue those on a backoff instead, with a bounded yield count so a
              permanently saturated org still terminates rather than looping forever.
            */
            if (isAdmissionYield(err.message) && admissionYields < MAX_ADMISSION_YIELDS) {
                const delayMs = Math.min(
                    ADMISSION_RETRY_BASE_MS * 2 ** admissionYields,
                    ADMISSION_RETRY_MAX_MS,
                );
                this.logger.info(
                    `Mission run ${missionRunId} yielded on admission control ` +
                    `(${admissionYields + 1}/${MAX_ADMISSION_YIELDS}); re-queueing in ${delayMs}ms.`,
                );
                try {
                    const { queueMissionCycle } = await import("./dynamic-mission-queue.js");
                    await queueMissionCycle(
                        { missionRunId, userId, orgId, admissionYields: admissionYields + 1 },
                        delayMs,
                    );
                    return;
                } catch (requeueErr: any) {
                    // Fall through and mark failed — a run we can neither start nor
                    // re-queue must not be left silently pending.
                    this.logger.error(
                        `Failed to re-queue mission ${missionRunId} after admission yield: ${requeueErr.message}`,
                    );
                }
            }

            this.logger.error(`Mission run ${missionRunId} exhausted all ${job.opts.attempts} retries. Marking as failed.`);

            try {
                const { missionRunService } = await import("../core/mission-run.service.js");
                await missionRunService.update(missionRunId, {
                    status: "failed",
                    failureReason: `Distributed cycle failed after ${job.opts.attempts} attempts: ${err.message}`
                });
            } catch (failErr: any) {
                this.logger.error(`Failed to mark mission ${missionRunId} as failed: ${failErr.message}`);
            }
        });
    }
}

let workerInstance: DynamicMissionWorker | null = null;

export function startDynamicMissionWorker() {
    if (!workerInstance) {
        workerInstance = new DynamicMissionWorker();
        logger.info("[Distributed] Dynamic Mission Worker started");
    }
    return workerInstance;
}
if (process.argv[1] && (process.argv[1].endsWith('dynamic-mission-worker.ts') || process.argv[1].endsWith('dynamic-mission-worker.js'))) {
    startDynamicMissionWorker();
}
