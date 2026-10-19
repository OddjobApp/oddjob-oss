/**
 * Mission Maintenance Service
 *
 * Handles periodic maintenance for mission-related concerns:
 * - Zombie Reaper: Finds 'active' runs with no updates for >10m and marks them as failed.
 */

import { db } from "@server/database_service.js";
import { missionRuns } from "@shared/schema/index.js";
import { eq, and, lt, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { workflowHealingService } from "../core/workflow-healing.service.js";

const logger = createLogger("MissionMaintenance");

// Configuration
const ZOMBIE_REAP_INTERVAL_MS = 10 * 60 * 1000; // Check every 10 minutes
const STALE_THRESHOLD_MINUTES = 60; // Allow 1 hour of inactivity for complex AI planning

let zombieReapInterval: NodeJS.Timeout | null = null;

// ============================================================================
// SERVICE LIFECYCLE
// ============================================================================

export function startMissionMaintenance(): void {
    logger.info("Starting mission maintenance service");

    // Schedule periodic maintenance
    zombieReapInterval = setInterval(async () => {
        /*
         * Reap before healing, and await each phase. These used to run concurrently
         * with healing first. The healer refreshes `updated_at` while attempting a
         * wake-up, so it could make hours-old orphaned runs look healthy immediately
         * before the reaper inspected them. In the worst race, the reaper marked a
         * run failed and the healer resumed it back to active. Those zombie rows then
         * occupied every organization concurrency slot indefinitely.
         */
        try {
            await reapZombies();
        } catch (err: any) {
            logger.error(`Zombie reaping failed: ${err.message}`);
        }

        try {
            await workflowHealingService.scanForStaleMissions();
        } catch (err: any) {
            logger.error(`Stale mission healing failed: ${err.message}`);
        }
    }, ZOMBIE_REAP_INTERVAL_MS);

    // Initial check on startup
    setTimeout(() => {
        reapZombies().catch(err =>
            logger.error(`Initial zombie reaping failed: ${err.message}`)
        );
    }, 15000); // 15 second delay

    logger.info(`Scheduled zombie reaping every ${ZOMBIE_REAP_INTERVAL_MS / 1000 / 60} minutes`);
}

export function stopMissionMaintenance(): void {
    if (zombieReapInterval) {
        clearInterval(zombieReapInterval);
        zombieReapInterval = null;
    }
    logger.info("Stopped mission maintenance service");
}

// ============================================================================
// ZOMBIE REAPER
// ============================================================================

/**
 * Reap "zombie" mission runs: rows still marked `active` whose `updatedAt`
 * heartbeat has gone stale (no wave pulse touched them for `staleMinutes`).
 * A healthy run is heartbeated on every pulse, so staleness reliably signals an
 * orphaned run whose repeating wave job is gone. Such rows never terminate on
 * their own and — because the rolling-wave concurrency gate counts `active`
 * runs — a single one can permanently block an org's mission processing.
 *
 * Scopeable so the concurrency gate can self-heal inline (org + belowRunId)
 * without waiting for the periodic sweep. Returns the ids it reaped.
 */
export async function reapStaleActiveRuns(opts: {
    orgId?: number;
    staleMinutes?: number;
    /** Only reap runs with an id below this (used by the concurrency gate). */
    belowRunId?: number;
} = {}): Promise<{ reapedIds: number[] }> {
    const staleMinutes = opts.staleMinutes && opts.staleMinutes > 0 ? opts.staleMinutes : STALE_THRESHOLD_MINUTES;

    const conditions = [
        eq(missionRuns.status, 'active'),
        // make_interval keeps the threshold a bound parameter (no string interpolation).
        sql`${missionRuns.updatedAt} < NOW() - make_interval(mins => ${staleMinutes})`,
    ];
    if (opts.orgId != null) conditions.push(eq(missionRuns.organizationId, opts.orgId));
    if (opts.belowRunId != null) conditions.push(lt(missionRuns.id, opts.belowRunId));

    const result = await db.update(missionRuns)
        .set({
            status: 'failed',
            failureReason: `Stale job reaped by system (Inactivity > ${staleMinutes}m)`,
            // COALESCE guards against a null mission_context (|| with NULL is NULL).
            missionContext: sql`COALESCE(mission_context, '{}'::jsonb) || jsonb_build_object('last_error', jsonb_build_object('message', 'JOB_STALE_TIMEOUT', 'timestamp', NOW()))`,
            updatedAt: new Date()
        } as any)
        .where(and(...conditions))
        .returning({ id: missionRuns.id });

    return { reapedIds: result.map(r => r.id) };
}

export async function reapZombies(): Promise<{ reapedCount: number }> {
    try {
        const { reapedIds } = await reapStaleActiveRuns();
        if (reapedIds.length > 0) {
            logger.warn(`Reaped ${reapedIds.length} zombie mission runs: ${reapedIds.join(", ")}`);
        } else {
            logger.info("Zombie check complete. No stale runs found.");
        }
        return { reapedCount: reapedIds.length };
    } catch (error: any) {
        logger.error(`Failed to reap zombies: ${error.message}`);
        throw error;
    }
}
