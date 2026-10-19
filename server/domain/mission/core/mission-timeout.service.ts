/**
 * Mission Timeout Service
 * 
 * Monitors mission runs for timeout conditions and auto-terminates
 * missions that exceed their maximum allowed duration.
 */

import { db } from "@server/database_service.js";
import { missionRuns, missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { missionRunService } from "./mission-run.service.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { crisisOrchestrationService } from "./crisis-orchestration.service.js";

const logger = createLogger("MissionTimeout");

// Default timeout: 30 minutes
const DEFAULT_MAX_DURATION_MINUTES = 600; // 10 hours

export const missionTimeoutService = {
    /**
     * Check if a mission run has exceeded its timeout.
     * Returns true if the mission was terminated due to timeout.
     */
    async checkAndEnforceTimeout(missionRunId: number): Promise<boolean> {
        try {
            const [run] = await db.select()
                .from(missionRuns)
                .where(eq(missionRuns.id, missionRunId))
                .limit(1);

            if (!run) {
                logger.warn(`[Timeout] Run ${missionRunId} not found`);
                return false;
            }

            // Only check active or paused missions
            if (run.status !== 'active' && run.status !== 'paused' && run.status !== 'waiting_on_human') {
                return false;
            }

            // Calculate elapsed time
            const startedAt = run.createdAt;
            if (!startedAt) {
                logger.warn(`[Timeout] Run ${missionRunId} has no start time`);
                return false;
            }

            const elapsedMs = Date.now() - new Date(startedAt).getTime();
            const elapsedMinutes = elapsedMs / (1000 * 60);

            // Get timeout limit from mission context or use default
            const missionContext = (run.missionContext as Record<string, any>) || {};
            const maxDurationMinutes = missionContext.maxDurationMinutes || 
                                       missionContext.rulesOfEngagement?.maxDurationMinutes ||
                                       DEFAULT_MAX_DURATION_MINUTES;

            if (elapsedMinutes > maxDurationMinutes) {
                logger.info(`[Timeout] Mission run ${missionRunId} exceeded ${maxDurationMinutes}min limit (elapsed: ${elapsedMinutes.toFixed(1)}min). Terminating...`);

                // Terminate the mission
                await this.terminateDueToTimeout(missionRunId, run, elapsedMinutes, maxDurationMinutes);
                return true;
            }

            return false;
        } catch (err: any) {
            logger.error(`[Timeout] Error checking timeout for run ${missionRunId}: ${err.message}`);
            return false;
        }
    },

    /**
     * Terminate a mission run due to timeout.
     */
    async terminateDueToTimeout(
        missionRunId: number, 
        run: typeof missionRuns.$inferSelect, 
        elapsedMinutes: number,
        maxDurationMinutes: number
    ): Promise<void> {
        const timeoutMessage = `Mission terminated after ${elapsedMinutes.toFixed(1)} minutes (exceeded ${maxDurationMinutes} minute limit)`;

        // Update mission run status
        await (missionRunService.update as any)(missionRunId, {
            status: 'failed',
            result: {
                success: false,
                error: 'MISSION_TIMEOUT',
                message: timeoutMessage
            }
        });

        // Update mission context with timeout info
        const missionContext = (run.missionContext as Record<string, any>) || {};
        await missionRunService.update(missionRunId, {
            missionContext: {
                ...missionContext,
                terminatedDueToTimeout: true,
                terminatedAt: new Date().toISOString(),
                elapsedMinutes,
                maxDurationMinutes
            }
        });

        // Emit timeout event
        await eventStream.publish('mission.timeout', {
            missionRunId,
            missionId: run.missionId,
            elapsedMinutes,
            maxDurationMinutes,
            message: timeoutMessage
        }, {
            organizationId: run.organizationId ?? undefined,
            subject: `mission-run:${missionRunId}`,
        }, 'mission-timeout');

        logger.info(`[Timeout] Successfully terminated run ${missionRunId} due to timeout`);

        // Crisis Orchestration is now handled centrally by MissionLifecycleHooks via update status.
    },

    /**
     * Scan all active missions and enforce timeouts.
     * Should be called periodically by a background job.
     */
    async scanAndEnforceTimeouts(): Promise<{ checked: number; terminated: number }> {
        try {
            const activeRuns = await db.select()
                .from(missionRuns)
                .where(eq(missionRuns.status, 'active'))
                .limit(1000);

            let terminated = 0;
            for (const run of activeRuns) {
                const wasTerminated = await this.checkAndEnforceTimeout(run.id);
                if (wasTerminated) terminated++;
            }

            // Also check paused and waiting_on_human missions
            const otherRuns = await db.select()
                .from(missionRuns)
                .where(eq(missionRuns.status, 'paused'))
                .limit(500);

            for (const run of otherRuns) {
                const wasTerminated = await this.checkAndEnforceTimeout(run.id);
                if (wasTerminated) terminated++;
            }

            const waitingRuns = await db.select()
                .from(missionRuns)
                .where(eq(missionRuns.status, 'waiting_on_human'))
                .limit(500);

            for (const run of waitingRuns) {
                const wasTerminated = await this.checkAndEnforceTimeout(run.id);
                if (wasTerminated) terminated++;
            }

            const totalChecked = activeRuns.length + otherRuns.length + waitingRuns.length;
            
            if (terminated > 0 || totalChecked > 0) {
                logger.info(`[Timeout] Scan complete: ${totalChecked} missions checked, ${terminated} terminated due to timeout`);
            }

            return { checked: totalChecked, terminated };
        } catch (err: any) {
            logger.error(`[Timeout] Error scanning missions: ${err.message}`);
            return { checked: 0, terminated: 0 };
        }
    },

    /**
     * Get remaining time for a mission run in minutes.
     * Returns null if mission not found or not running.
     */
    async getRemainingTimeMinutes(missionRunId: number): Promise<number | null> {
        try {
            const [run] = await db.select()
                .from(missionRuns)
                .where(eq(missionRuns.id, missionRunId))
                .limit(1);

            if (!run) return null;
            if (!run.createdAt) return null;

            const startedAt = run.createdAt;
            const elapsedMs = Date.now() - new Date(startedAt!).getTime();
            const elapsedMinutes = elapsedMs / (1000 * 60);

            const missionContext = (run.missionContext as Record<string, any>) || {};
            const maxDurationMinutes = missionContext.maxDurationMinutes || 
                                       missionContext.rulesOfEngagement?.maxDurationMinutes ||
                                       DEFAULT_MAX_DURATION_MINUTES;

            return Math.max(0, maxDurationMinutes - elapsedMinutes);
        } catch (err: any) {
            logger.error(`[Timeout] Error getting remaining time: ${err.message}`);
            return null;
        }
    }
};
