import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ForgeExecutorHealth");

/**
 * Whether anything is actually able to run a forge build right now.
 *
 * A forge request is accepted by the API process and executed by a BullMQ
 * worker, which in most deployments lives somewhere else entirely. So accepting
 * a build proves nothing about whether it will ever run: with SKIP_WORKERS set
 * and no worker fleet up, a request is queued, a draft is written as "queued",
 * and it sits there forever with nobody to pick it up.
 *
 * The check therefore asks Redis who is listening rather than reading this
 * process's own environment. `getWorkers()` returns the workers BullMQ has
 * registered against the queue across every process, which is the only answer
 * that means anything to a request being accepted here.
 */

/** How long an availability answer is reused. Long enough to spare a round trip per request, short enough to notice a fleet going down. */
const CACHE_MS = 5_000;

export interface ExecutorHealth {
    available: boolean;
    /** Where the executor is, when there is one. */
    location: "in-process" | "queue" | "none";
    reason: string;
    workerCount: number;
}

let cached: { at: number; health: ExecutorHealth } | null = null;

/** True when THIS process starts the forge worker, per worker-manager's rules. */
export function runsForgeWorkerInProcess(env: NodeJS.ProcessEnv = process.env): boolean {
    if (env.SKIP_WORKERS !== "true") return true;
    // SKIP_WORKERS means a dedicated fleet runs the workers — unless this
    // deployment names forge outright, which is how a single-process
    // deployment asks for its own worker.
    const enabled = (env.ENABLED_WORKERS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return enabled.includes("forge");
}

export async function getForgeExecutorHealth(force = false): Promise<ExecutorHealth> {
    if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.health;

    let health: ExecutorHealth;

    if (runsForgeWorkerInProcess()) {
        health = {
            available: true,
            location: "in-process",
            reason: "This process runs the App Forge worker.",
            workerCount: 1,
        };
    } else {
        try {
            const { forgeQueue } = await import("../infrastructure/forge-queue.js");
            const workers = await forgeQueue.getWorkers();
            const count = Array.isArray(workers) ? workers.length : 0;
            health = count > 0
                ? {
                      available: true,
                      location: "queue",
                      reason: `${count} App Forge worker(s) connected to the queue.`,
                      workerCount: count,
                  }
                : {
                      available: false,
                      location: "none",
                      reason:
                          "No App Forge worker is connected to the queue. This process has SKIP_WORKERS set, so builds " +
                          "are executed by a separate worker fleet, and none is running. Start the worker fleet, or set " +
                          "ENABLED_WORKERS=forge on this process.",
                      workerCount: 0,
                  };
        } catch (err: any) {
            /*
             * A queue that cannot be reached is not an executor. Treating an
             * unreachable Redis as "probably fine" is how a build gets accepted
             * into a queue nobody can read.
             */
            health = {
                available: false,
                location: "none",
                reason: `The App Forge queue could not be reached: ${err?.message ?? err}`,
                workerCount: 0,
            };
        }
    }

    cached = { at: Date.now(), health };
    if (!health.available) logger.warn(`[ForgeExecutor] ${health.reason}`);
    return health;
}

/** Drops the cached answer, so the next check asks again. For tests and for a fleet that just came up. */
export function resetForgeExecutorHealthCache(): void {
    cached = null;
}

/**
 * Forge drafts that claim to be running with nothing running them.
 *
 * A draft is written before the job is queued and updated by the worker as it
 * progresses, so a worker that dies mid-build leaves a draft saying "running"
 * for good. Nothing then distinguishes it from a build that is genuinely still
 * going, and the studio shows a progress row that will never advance.
 *
 * Staleness is decided by age plus the absence of the job from the queue,
 * because either alone is wrong: a long build is not stale, and a job briefly
 * between states is not gone.
 */
const ACTIVE_STATUSES = new Set(["queued", "running", "building"]);

export interface StaleDraft {
    jobId: string;
    slug: string;
    name?: string;
    status: string;
    updatedAt: string;
    ageMinutes: number;
}

export async function findStaleForgeDrafts(
    orgId: number,
    stallMinutes = 30,
): Promise<StaleDraft[]> {
    const { forgeDraftService } = await import("./forge-draft.service.js");

    let drafts: any[];
    try {
        drafts = await forgeDraftService.listDrafts(orgId, 50);
    } catch {
        return [];
    }

    const now = Date.now();
    const candidates = drafts.filter((d) => {
        if (!ACTIVE_STATUSES.has(d.status)) return false;
        const updated = Date.parse(d.updatedAt ?? "");
        if (!Number.isFinite(updated)) return false;
        return now - updated > stallMinutes * 60_000;
    });
    if (candidates.length === 0) return [];

    // Only now pay for the queue read, and only to confirm what age suggests.
    let liveJobIds = new Set<string>();
    try {
        const { forgeQueue } = await import("../infrastructure/forge-queue.js");
        const jobs = await forgeQueue.getJobs(["active", "waiting", "delayed"]);
        liveJobIds = new Set(
            jobs.map((j: any) => j?.data?.jobId).filter((id: unknown): id is string => typeof id === "string"),
        );
    } catch {
        /*
         * Unreadable queue: report the age-based candidates rather than none.
         * A draft stalled for half an hour is worth surfacing even when the
         * confirmation is unavailable, and the caller offers Resume rather than
         * acting on it.
         */
    }

    return candidates
        .filter((d) => !liveJobIds.has(d.jobId))
        .map((d) => ({
            jobId: d.jobId,
            slug: d.slug,
            name: d.name,
            status: d.status,
            updatedAt: d.updatedAt,
            ageMinutes: Math.round((now - Date.parse(d.updatedAt)) / 60_000),
        }));
}

/**
 * Mark stale drafts so they stop claiming to be running.
 *
 * Deliberately does NOT restart them. A build that died halfway has already
 * written files and may hold a container; re-running it unattended can produce
 * a second one. The spec's own instruction is to surface Resume or Retry when
 * automatic recovery is unsafe, and it is unsafe here — so this reports, and a
 * person decides.
 */
export async function markStaleForgeDrafts(orgId: number, stallMinutes = 30): Promise<StaleDraft[]> {
    const stale = await findStaleForgeDrafts(orgId, stallMinutes);
    if (stale.length === 0) return [];

    const { forgeDraftService } = await import("./forge-draft.service.js");
    for (const draft of stale) {
        try {
            await forgeDraftService.updateDraft(draft.jobId, {
                status: "failed",
                error: `No executor claimed this build; it stopped responding ${draft.ageMinutes} minutes ago.`,
                message: "Build interrupted — resume or retry it from App Forge.",
            });
        } catch (err: any) {
            logger.warn(`[ForgeExecutor] Could not mark draft ${draft.jobId} stale: ${err?.message ?? err}`);
        }
    }

    logger.warn(`[ForgeExecutor] Marked ${stale.length} stalled forge draft(s) for org ${orgId}.`);
    return stale;
}

/**
 * Sweep every organization's drafts, for a worker that has just come up.
 *
 * Complements cleanupStagnantJobs, which expires the `forge:job:*` status keys.
 * Those are not what the studio reads: a draft is the record a room and the
 * Forge page both resume from, and one left saying "running" outlives the
 * status key that agreed with it.
 *
 * Returns the drafts it marked, so a caller can log or surface them.
 */
export async function reconcileForgeDrafts(stallMinutes = 30): Promise<StaleDraft[]> {
    const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");

    let keys: string[];
    try {
        // One key per organization, so the key space is small — the same
        // approach cleanupStagnantJobs already takes over forge:job:*.
        keys = await redis.keys("forge:drafts:org:*");
    } catch (err: any) {
        logger.warn(`[ForgeExecutor] Could not scan draft keys: ${err?.message ?? err}`);
        return [];
    }

    const marked: StaleDraft[] = [];
    for (const key of keys) {
        const orgId = Number(key.split(":").pop());
        if (!Number.isInteger(orgId) || orgId <= 0) continue;
        try {
            marked.push(...(await markStaleForgeDrafts(orgId, stallMinutes)));
        } catch (err: any) {
            // One organization's bad data must not stop the sweep.
            logger.warn(`[ForgeExecutor] Reconcile failed for org ${orgId}: ${err?.message ?? err}`);
        }
    }

    if (marked.length > 0) {
        logger.warn(
            `[ForgeExecutor] Reconciled ${marked.length} stalled draft(s) across ${keys.length} organization(s): ` +
            marked.map((d) => `${d.slug} (${d.jobId})`).join(", "),
        );
    } else {
        logger.info(`[ForgeExecutor] No stalled forge drafts across ${keys.length} organization(s).`);
    }
    return marked;
}
