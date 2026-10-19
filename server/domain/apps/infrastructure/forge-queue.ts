import { Queue, Job } from 'bullmq';
import { createLogger } from "@server/utils/logger.js";
import { BaseWorker } from "@server/workers/base-worker.js";
import { crossAppEventBus, CrossAppEventType } from "@server/domain/org/core/event-bus.service.js";
import { forgeDraftService } from "../core/forge-draft.service.js";
import { redisConnectionOptions } from "@domain/core/infrastructure/redis/connection-options.js";

const logger = createLogger("ForgeQueue");
const QUEUE_NAME = process.env.E2E_FAST_MOCK === 'true' ? 'app-forge-e2e' : 'app-forge';

const redisOptions = redisConnectionOptions();

export const forgeQueue = new Queue(QUEUE_NAME, {
    connection: redisOptions,
    defaultJobOptions: {
        attempts: 5,
        backoff: {
            type: 'exponential',
            delay: 10000,
        },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
    }
});

export interface ForgeJobData {
    blueprintSlug: string;
    options: {
        name: string;
        slug: string;
        description: string;
        theme?: string;
        oddjobMissionId: number;
        organizationId?: number;
        systemPrompt?: string;
        blackboard?: any;
        apiInstructions?: string;
    };
    jobId: string;
}

export class ForgeWorker extends BaseWorker<ForgeJobData> {
    constructor() {
        super(QUEUE_NAME, {
            concurrency: 1,
            lockDuration: 1800000,
        });

        // execute() reconciles the draft in its own try/catch, which covers every
        // way a build can fail while this worker is running it. It does not cover
        // the ways a build dies without execute() ever returning: the process is
        // restarted mid-build, or another worker's stalled-checker fails the job
        // from outside. Nothing then writes a terminal status, so the draft reads
        // "building" forever and the UI shows a job that has not existed for weeks.
        // One such draft sat at stage 3 / 40% for twenty-three days.
        this.worker.on("failed", (job, err) => {
            void this.reconcileAbandonedDraft(job, err?.message || "Job failed without reporting a reason.");
        });
    }

    /**
     * Write a terminal status to a draft whose job died outside execute().
     * Terminal drafts are left alone: a late 'failed' for an already-completed job
     * must not overwrite the completion.
     */
    private async reconcileAbandonedDraft(job: Job<ForgeJobData> | undefined, reason: string): Promise<void> {
        try {
            // A stalled job can arrive without its data, so fall back to the id,
            // which is minted as `forge-<draftJobId>-<timestamp>`.
            const jobId = job?.data?.jobId
                || String(job?.id || "").replace(/^forge-/, "").replace(/-\d+$/, "");
            if (!jobId) return;

            const draft = await forgeDraftService.getDraft(jobId);
            if (!draft) return;
            if (["completed", "failed", "cancelled"].includes(draft.status)) return;

            await forgeDraftService.updateDraft(jobId, {
                status: "failed",
                error: reason,
                message: `Forge job ended without completing: ${reason}`,
            });
            logger.warn(`[ForgeWorker] Reconciled abandoned draft ${jobId} (was "${draft.status}"): ${reason}`);
        } catch (reconcileErr: any) {
            logger.warn(`[ForgeWorker] Could not reconcile abandoned draft: ${reconcileErr.message}`);
        }
    }

    protected async execute(job: Job<ForgeJobData>): Promise<any> {
        if (job.name === 'shadow-audit') {
            const { forgeShadowService } = await import("../core/forge-shadow.service.js");
            await forgeShadowService.auditAll(5);
            return { success: true };
        }

        if (job.name === 'shadow-challenger') {
            const { liveAppSlug, options, generatedFiles, blueprintSlug, traceContext } = job.data as any;
            const { forgeShadowService } = await import("../core/forge-shadow.service.js");
            await forgeShadowService.runChallengerShadow(
                liveAppSlug,
                options,
                generatedFiles,
                blueprintSlug,
                traceContext
            );
            return { success: true };
        }

        const { blueprintSlug, options, jobId } = job.data;
        const { appForgeService } = await import("../app-forge.service.js");

        this.logger.info(`[Mach 3] Starting Forge Job ${jobId} for ${options.slug}`);

        try {
            // Update redis status to 'building'
            const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
            await redis.set(`forge:job:${jobId}`, JSON.stringify({
                status: 'building',
                progress: 10,
                message: 'Forge worker identified. Ignition sequence started.',
                updatedAt: new Date().toISOString(),
                jobId,
                slug: options.slug,
                blueprintSlug
            }), 'EX', 86400);
            await forgeDraftService.createOrUpdateDraft({
                jobId,
                blueprintSlug,
                options: options as any,
                status: 'building',
                progress: 10,
                message: 'Forge worker identified. Ignition sequence started.',
            });

            const result = await appForgeService.forgeAppInternal(blueprintSlug, options, jobId);
            
            if (result.success) {
                // If the job was suspended (awaiting HIL/approval), do NOT set status to completed.
                // The service itself has already set the correct status (e.g. 'awaiting_approval').
                if ((result as any).suspended) {
                    logger.info(`[ForgeWorker] Job ${jobId} suspended/awaiting intervention. Skipping 'completed' status update.`);
                    return result;
                }

                await redis.set(`forge:job:${jobId}`, JSON.stringify({
                    status: 'completed',
                    progress: 100,
                    appId: result.appId,
                    message: 'App successfully forged and registered.',
                    updatedAt: new Date().toISOString(),
                    jobId,
                    slug: options.slug,
                    blueprintSlug,
                    readiness: (result as any).readiness
                }), 'EX', 86400);
                await forgeDraftService.updateDraft(jobId, {
                    status: 'completed',
                    progress: 100,
                    appId: result.appId,
                    message: 'App successfully forged and registered.',
                    readiness: (result as any).readiness,
                });
                await redis.del(`forge:active:${options.slug}`).catch(() => {});

                // Publish real-time Global Event
                crossAppEventBus.publish({
                    type: CrossAppEventType.DEPLOYMENT_COMPLETED,
                    organizationId: options.organizationId || 0,
                    sourceApp: "app-forge",
                    payload: {
                        appId: result.appId,
                        slug: options.slug,
                        name: options.name,
                        message: `App ${options.name} has finished hydrating and is ready to use.`
                    }
                }).catch(err => {
                    this.logger.warn(`Failed to publish DEPLOYMENT_COMPLETED event: ${err.message}`);
                });
            } else {
                throw new Error("Forge job returned an unsuccessful result.");
            }

            return result;
        } catch (err: any) {
            // A cancelled build is not a failed one. Without this the pipeline's
            // own abort would land here and rewrite the status the operator just
            // set, so a cancel would read as a failure a moment later.
            if (err?.forgeCancelled || await isForgeCancelled(jobId)) {
                this.logger.info(`Forge Job ${jobId} stopped: cancelled.`);
                throw err;
            }

            this.logger.error(`Forge Job ${jobId} failed: ${err.message}`);
            const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
            await redis.set(`forge:job:${jobId}`, JSON.stringify({
                status: 'failed',
                error: err.message,
                updatedAt: new Date().toISOString(),
                jobId,
                slug: options.slug,
                blueprintSlug
            }), 'EX', 3600 * 24);
            await forgeDraftService.updateDraft(jobId, {
                status: 'failed',
                error: err.message,
                message: `Forge job failed: ${err.message}`,
            });
            await redis.del(`forge:active:${options.slug}`).catch(() => {});

            // --- NEW: Automated Triage & Incident Management ---
            try {
                const { errorDiagnosisEngine } = await import("@domain/diagnostics/core/error-diagnosis.engine.js");
                const { adaptiveLearningService } = await import("@domain/learning/core/adaptive-learning.service.js");

                // 1. Trigger AI-driven Diagnosis
                await errorDiagnosisEngine.diagnose({
                    error: err,
                    jobType: 'app-forge',
                    organizationId: options.organizationId,
                    jobConfig: {
                        blueprintSlug,
                        appSlug: options.slug,
                        appName: options.name
                    }
                }, { includeAI: true }).catch(diagErr => {
                    this.logger.warn(`Failed to auto-diagnose forge error: ${diagErr.message}`);
                });

                // 2. Record Failure for Adaptive Learning (Pattern Discovery)
                await adaptiveLearningService.recordFailure({
                    organizationId: options.organizationId || 0,
                    domain: "app-forge",
                    subcategory: "build-failure",
                    severity: "high",
                    appId: 0, // App not yet registered if build fails
                    errorMessage: err.message,
                    errorStack: err.stack,
                } as any).catch(learnErr => {
                    this.logger.warn(`Failed to record forge failure for learning: ${learnErr.message}`);
                });

            } catch (triageErr: any) {
                this.logger.warn(`Failure triage system unavailable: ${triageErr.message}`);
            }

            throw err;
        }
    }
}

let workerInstance: ForgeWorker | null = null;


/**
 * The key a running build watches. Set by cancelForgeJob, checked by the forge
 * pipeline at each stage boundary — a build is a long chain of AI calls and
 * container work, so cancellation has to be cooperative: there is no safe way to
 * tear one down mid-step from outside.
 */
export function forgeCancelKey(jobId: string): string {
    return `forge:cancelled:${jobId}`;
}

const CANCEL_FLAG_TTL_SECONDS = 60 * 60 * 24;

export async function isForgeCancelled(jobId: string): Promise<boolean> {
    const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
    return (await redis.get(forgeCancelKey(jobId))) !== null;
}

export interface ForgeCancelResult {
    jobId: string;
    /** Queue entries removed outright, so nothing will start or retry. */
    removedFromQueue: number;
    /**
     * True when an attempt was already executing. Its worker stops at the next
     * stage boundary rather than instantly, and the caller should say so.
     */
    wasRunning: boolean;
}

/**
 * End a forge job.
 *
 * Cancelling by hand is unreliable because the state lives in four places, and
 * the one that decides what the UI shows is the least obvious: getDraft overlays
 * `forge:job:<id>` on top of the draft record and the overlay WINS for status.
 * Writing only the draft leaves a cancelled job still reading "building"
 * everywhere. So this writes both, removes the queue entries so the job cannot
 * be retried into life again, frees the per-slug lock that otherwise refuses the
 * next forge for that app, and raises the cooperative flag for any attempt
 * already in flight.
 */
export async function cancelForgeJob(jobId: string, reason = "Cancelled by operator"): Promise<ForgeCancelResult> {
    const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");

    await redis.set(forgeCancelKey(jobId), reason, "EX", CANCEL_FLAG_TTL_SECONDS);

    let removedFromQueue = 0;
    let wasRunning = false;

    const jobs = await forgeQueue.getJobs(["active", "waiting", "delayed", "paused", "failed"]);
    for (const job of jobs) {
        if (!job || (job.data as any)?.jobId !== jobId) continue;
        const state = await job.getState();
        if (state === "active") wasRunning = true;
        try {
            await job.remove();
            removedFromQueue++;
        } catch (err: any) {
            // An active job still holding its lock cannot be removed. The flag
            // above is what stops it; say so rather than claiming it is gone.
            logger.warn(`[Forge] Could not remove ${state} queue entry for ${jobId}: ${err.message}`);
        }
    }

    const draft = await forgeDraftService.getDraft(jobId);
    const slug = draft?.slug;

    // The overlay the UI actually reads.
    await redis.set(`forge:job:${jobId}`, JSON.stringify({
        status: "cancelled",
        progress: draft?.progress ?? 0,
        stage: draft?.stage,
        message: reason,
        error: reason,
        updatedAt: new Date().toISOString(),
        jobId,
        slug,
    }), "EX", CANCEL_FLAG_TTL_SECONDS);

    await forgeDraftService.updateDraft(jobId, {
        status: "cancelled",
        message: reason,
        error: reason,
    });

    if (slug) {
        // Otherwise the next forge for this app is refused with "a forge is
        // already running".
        await redis.del(`forge:active:${slug}`).catch(() => {});
    } else {
        // No draft to name the slug — it may have expired, or the job may predate
        // drafts entirely. The lock still has to go, or that app can never be
        // forged again, so find it by the value it holds: this job's id.
        try {
            const locks = await redis.keys("forge:active:*");
            for (const key of locks) {
                if ((await redis.get(key)) === jobId) await redis.del(key);
            }
        } catch (err: any) {
            logger.warn(`[Forge] Could not sweep slug locks for ${jobId}: ${err.message}`);
        }
    }

    logger.info(`[Forge] Cancelled ${jobId} (${slug ?? "unknown slug"}): removed ${removedFromQueue} queue entr${removedFromQueue === 1 ? "y" : "ies"}, wasRunning=${wasRunning}`);
    return { jobId, removedFromQueue, wasRunning };
}

export function startRollingForgeWorker() {
    if (!workerInstance) {
        workerInstance = new ForgeWorker();
        logger.info("[Mach 3] App Forge Worker started");

        // Initialize Warm Pool (Pre-emptive strike)
        import("../app-forge.service.js").then(({ appForgeService }) => {
            logger.info("[Mach 3] Warming up industrial pool...");
            appForgeService.ensureWarmPool(2).catch(err => {
                logger.error(`[WarmPool] Failed to initialize: ${err.message}`);
            });

            // Set up periodic integrity check (Every 30 minutes)
            setInterval(() => {
                logger.info("[Mach 3] Triggering periodic integrity check & job cleanup...");
                appForgeService.verifyPoolIntegrity().catch((err: any) => {
                    logger.error(`[WarmPool] Periodic integrity check failed: ${err.message}`);
                });
                appForgeService.cleanupStagnantJobs().catch((err: any) => {
                    logger.error(`[Forge] Stagnant job cleanup failed: ${err.message}`);
                });
                reconcileForgeDraftsSafely();
            }, 30 * 60 * 1000);
        }).catch(err => {
            logger.error(`[WarmPool] Failed to load service: ${err.message}`);
        });

        /*
         * Reconcile drafts stranded by a previous life of this worker.
         *
         * A draft is written before the job is queued and updated by the worker
         * as it runs, so a worker killed mid-build leaves one saying "running"
         * with nothing running it — and the studio shows a progress row that
         * never advances. This is the "do not leave a draft permanently marked
         * running without an executor" half of recovery.
         *
         * Delayed rather than immediate: a fleet coming up together should have
         * its members register and re-claim their jobs before anything judges
         * what looks abandoned. The staleness test still requires the job to be
         * absent from the queue, so this is belt and braces.
         */
        setTimeout(reconcileForgeDraftsSafely, 30_000).unref?.();

        // ── NEW: Shadow Run Scheduler ──────────────────────────────
        // Schedules a background audit every 6 hours to detect regressions
        // in forged applications.
        forgeQueue.add('shadow-audit', {}, {
            repeat: { pattern: '0 */6 * * *' }, // Every 6 hours
            jobId: 'shadow-audit-scheduler'
        }).then(() => {
            logger.info("[ShadowRun] Shadow Audit scheduler initialized (Every 6h)");
        }).catch(err => {
            logger.error(`[ShadowRun] Failed to initialize scheduler: ${err.message}`);
        });
    }
    // Returned so worker-manager can register it for shutdown; without it the
    // forge worker is never closed when the fleet stops.
    return workerInstance;
}

/**
 * Reconciliation must never take the worker down with it.
 *
 * It is a recovery aid, not part of executing a build, so a failure here is
 * logged and the worker carries on running jobs.
 */
function reconcileForgeDraftsSafely(): void {
    void import("../core/forge-executor-health.service.js")
        .then(({ reconcileForgeDrafts }) => reconcileForgeDrafts())
        .catch((err: any) => {
            logger.error(`[Forge] Draft reconciliation failed: ${err?.message ?? err}`);
        });
}

export async function queueForgeJob(data: ForgeJobData) {
    // Unique jobId per attempt ensures BullMQ doesn't ignore re-queued jobs
    const bullmqId = `forge-${data.jobId}-${Date.now()}`;
    return await forgeQueue.add('forge-app', data, {
        jobId: bullmqId,
    });
}
