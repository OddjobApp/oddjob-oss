
import { db } from "@server/database_service.js";
import { operationalCycles, missionRuns } from "@shared/schema/index.js";
import { eq, and, lte, isNull, sql, or } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { CycleManagerService } from "./cycle-manager.service.js";
import { normalizeCycleSchedule, type CycleScheduleConfig } from "@shared/cycle-scheduling.js";
import { calculateNextRun } from "@domain/schedules/infrastructure/schedule-calculator.js";

const logger = createLogger("CycleScheduler");

function scheduleTime(anchorAt?: string | null) {
    const anchor = anchorAt ? new Date(anchorAt) : new Date();
    if (Number.isNaN(anchor.getTime())) return "09:00";
    return `${String(anchor.getHours()).padStart(2, "0")}:${String(anchor.getMinutes()).padStart(2, "0")}`;
}

function cycleScheduleToExistingSchedule(schedule: CycleScheduleConfig): any | null {
    const anchor = schedule.anchorAt ? new Date(schedule.anchorAt) : new Date();
    const time = scheduleTime(schedule.anchorAt);
    const dayOfWeek = Number.isNaN(anchor.getTime()) ? 1 : anchor.getDay();
    const dayOfMonth = Number.isNaN(anchor.getTime()) ? 1 : anchor.getDate();
    const month = Number.isNaN(anchor.getTime()) ? 1 : anchor.getMonth() + 1;
    const [hour, minute] = time.split(":").map(Number);

    switch (schedule.mode) {
        case "hourly":
            return { pattern: 4, patternString: { cron: `${minute} * * * *` }, timezone: schedule.timezone };
        case "daily":
            return { pattern: 4, patternString: { cron: `${minute} ${hour} * * *` }, timezone: schedule.timezone };
        case "weekly":
            return { pattern: 4, patternString: { cron: `${minute} ${hour} * * ${dayOfWeek}` }, timezone: schedule.timezone };
        case "monthly":
            return { pattern: 4, patternString: { cron: `${minute} ${hour} ${dayOfMonth} * *` }, timezone: schedule.timezone };
        case "yearly":
            return { pattern: 4, patternString: { cron: `${minute} ${hour} ${dayOfMonth} ${month} *` }, timezone: schedule.timezone };
        default:
            return null;
    }
}

function calculateNextCycleRunFromExistingScheduler(schedule: CycleScheduleConfig): Date | null {
    const existingSchedule = cycleScheduleToExistingSchedule(schedule);
    return existingSchedule ? calculateNextRun(existingSchedule) : null;
}

export class CycleSchedulerService {
    /**
     * Checks active cycles for strategic drift every 5 minutes.
     * Runs on every 5th heartbeat tick.
     */
    static async checkDrift(tickCount: number) {
        if (tickCount % 5 !== 0) return; // Only every 5 minutes
        try {
            const activeCycles = await db.select({ id: operationalCycles.id, organizationId: operationalCycles.organizationId })
                .from(operationalCycles)
                .where(and(eq(operationalCycles.status, 'active'), isNull(operationalCycles.deletedAt)));

            for (const cycle of activeCycles) {
                await CycleManagerService.detectStrategicDrift(cycle.id).catch(err =>
                    logger.warn(`[Scheduler] Drift check failed for cycle ${cycle.id}: ${err.message}`)
                );
            }
        } catch (err: any) {
            logger.error(`[Scheduler] Drift check run failed: ${err.message}`);
        }
    }

    /**
     * Periodically checks for cycles that need to be triggered.
     * Called by a background heartbeat worker.
     */
    static async checkAndTriggerCycles() {
        try {
            const now = new Date();
            
            // Find active schedules due now. nextRunAt is the trigger cursor; startDate is only
            // used as a legacy fallback for cycles created before schedule metadata existed.
            const pendingCycles = await db.select()
                .from(operationalCycles)
                .where(
                    and(
                        eq(operationalCycles.status, 'active'),
                        isNull(operationalCycles.deletedAt),
                        sql`${operationalCycles.recurrence} != 'once'`,
                        or(
                            lte(operationalCycles.nextRunAt, now),
                            and(sql`${operationalCycles.nextRunAt} IS NULL`, lte(operationalCycles.startDate, now))
                        )
                    )
                );

            for (const cycle of pendingCycles) {
                await this.triggerCycleExecution(cycle);
            }
        } catch (err: any) {
            logger.error(`[Scheduler] Check failed: ${err.message}`);
        }
    }

    /**
     * Executes a single instance of a scheduled cycle.
     */
    private static async triggerCycleExecution(cycle: any) {
        logger.info(`[Scheduler] Triggering recurrence for cycle: ${cycle.name} (ID: ${cycle.id})`);

        const now = new Date();
        const metadata = (cycle.metadata as any) || {};
        const schedule = normalizeCycleSchedule(metadata, cycle.recurrence, cycle.timezone);
        const scheduledFor = cycle.nextRunAt ? new Date(cycle.nextRunAt) : new Date(cycle.startDate ?? now);
        const activeRun = await this.findActiveRun(cycle.id);
        const nextRun = calculateNextCycleRunFromExistingScheduler(schedule);

        if (activeRun && schedule.overlapPolicy !== "allow_all") {
            const bufferedRunAt = schedule.overlapPolicy === "buffer_one" ? scheduledFor.toISOString() : undefined;
            await this.recordScheduleEvent(cycle, "skipped_overlap", {
                scheduledFor: scheduledFor.toISOString(),
                activeRunId: activeRun.id,
                nextRunAt: nextRun?.toISOString() ?? null,
                ...(bufferedRunAt ? { bufferedRunAt } : {}),
            }, nextRun, bufferedRunAt);
            logger.info(`[Scheduler] Skipped cycle ${cycle.id}; run ${activeRun.id} is still active`);
            return;
        }

        const durationDays = Number((cycle.metadata as any)?.durationDays ?? (cycle.metadata as any)?.duration_days ?? 5);
        const currentAnchor = scheduledFor.getTime() <= now.getTime() ? now : scheduledFor;
        const newEndDate = new Date(currentAnchor.getTime() + durationDays * 24 * 60 * 60 * 1000);
        const updatedMetadata = {
            ...metadata,
            scheduling: {
                ...(metadata.scheduling || {}),
                mode: schedule.mode,
                type: schedule.mode,
                nextRunAt: nextRun?.toISOString() ?? null,
                lastRunAt: now.toISOString(),
                scheduleEvents: [
                    { at: now.toISOString(), type: "started", scheduledFor: scheduledFor.toISOString(), nextRunAt: nextRun?.toISOString() ?? null },
                    ...((metadata.scheduling?.scheduleEvents || []) as any[]),
                ].slice(0, 25),
            },
        };

        await db.update(operationalCycles)
            .set({
                startDate: currentAnchor,
                endDate: newEndDate,
                nextRunAt: nextRun,
                lastRunAt: now,
                metadata: updatedMetadata,
                updatedAt: now
            })
            .where(eq(operationalCycles.id, cycle.id));

        const blueprints = cycle.metadata?.blueprints || [];
        if (blueprints.length > 0) {
            await CycleManagerService.spawnBlueprintsWithDeps(
                cycle.id,
                blueprints,
                cycle.createdBy,
                cycle.organizationId,
                cycle.priority ?? 5
            ).catch(err => {
                logger.error(`[Scheduler] Spawn failed for cycle ${cycle.id}: ${err.message}`);
            });
        }

        logger.info(`[Scheduler] Cycle ${cycle.id} rescheduled for ${nextRun?.toISOString() ?? "manual completion"}`);
    }

    static async handleCycleCompleted(cycleId: number, result: any) {
        const [cycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
        if (!cycle) return;
        const metadata = (cycle.metadata as any) || {};
        const schedule = normalizeCycleSchedule(metadata, cycle.recurrence, cycle.timezone);
        if (!schedule.enabled) return;

        const now = new Date();
        const bufferedRunAt = metadata.scheduling?.bufferedRunAt;
        if (bufferedRunAt && schedule.mode !== "on_complete") {
            await db.update(operationalCycles)
                .set({
                    status: "active",
                    startDate: now,
                    nextRunAt: now,
                    metadata: {
                        ...metadata,
                        scheduling: {
                            ...(metadata.scheduling || {}),
                            bufferedRunAt: null,
                            nextRunAt: now.toISOString(),
                            lastCompletionResult: result,
                            scheduleEvents: [
                                { at: now.toISOString(), type: "buffer_released", bufferedRunAt },
                                ...((metadata.scheduling?.scheduleEvents || []) as any[]),
                            ].slice(0, 25),
                        },
                    },
                    updatedAt: now,
                })
                .where(eq(operationalCycles.id, cycleId));
            return;
        }

        if (schedule.mode !== "on_complete") return;

        if (schedule.pauseOnFailure && result?.finalStatus !== "closed") {
            await db.update(operationalCycles)
                .set({
                    status: "paused",
                    metadata: {
                        ...metadata,
                        scheduling: {
                            ...(metadata.scheduling || {}),
                            pausedReason: "cycle_completion_not_closed",
                            lastCompletionResult: result,
                            scheduleEvents: [
                                { at: now.toISOString(), type: "paused_on_failure", finalStatus: result?.finalStatus ?? null },
                                ...((metadata.scheduling?.scheduleEvents || []) as any[]),
                            ].slice(0, 25),
                        },
                    },
                    updatedAt: now,
                })
                .where(eq(operationalCycles.id, cycleId));
            return;
        }

        const nextRun = new Date(now.getTime() + schedule.cooldownMinutes * 60_000);
        await db.update(operationalCycles)
            .set({
                status: "active",
                startDate: now,
                nextRunAt: nextRun,
                lastRunAt: now,
                metadata: {
                    ...metadata,
                    scheduling: {
                        ...(metadata.scheduling || {}),
                        mode: "on_complete",
                        type: "on_complete",
                        nextRunAt: nextRun.toISOString(),
                        lastCompletionResult: result,
                        ganttResetAt: now.toISOString(),
                        scheduleEvents: [
                            { at: now.toISOString(), type: "completed_rescheduled", nextRunAt: nextRun.toISOString(), finalStatus: result?.finalStatus ?? null },
                            ...((metadata.scheduling?.scheduleEvents || []) as any[]),
                        ].slice(0, 25),
                    },
                },
                updatedAt: now,
            })
            .where(eq(operationalCycles.id, cycleId));
    }

    private static async findActiveRun(cycleId: number) {
        const [run] = await db.select({ id: missionRuns.id })
            .from(missionRuns)
            .where(and(
                eq(missionRuns.cycleId, cycleId),
                isNull(missionRuns.deletedAt),
                sql`${missionRuns.status} IN ('active', 'running', 'pending', 'waiting_on_human', 'waiting_on_file')`
            ))
            .limit(1);
        return run;
    }

    private static async recordScheduleEvent(cycle: any, type: string, event: Record<string, unknown>, nextRun: Date | null, bufferedRunAt?: string) {
        const metadata = (cycle.metadata as any) || {};
        await db.update(operationalCycles)
            .set({
                nextRunAt: nextRun,
                metadata: {
                    ...metadata,
                    scheduling: {
                        ...(metadata.scheduling || {}),
                        nextRunAt: nextRun?.toISOString() ?? null,
                        ...(bufferedRunAt ? { bufferedRunAt } : {}),
                        scheduleEvents: [
                            { at: new Date().toISOString(), type, ...event },
                            ...((metadata.scheduling?.scheduleEvents || []) as any[]),
                        ].slice(0, 25),
                    },
                },
                updatedAt: new Date(),
            })
            .where(eq(operationalCycles.id, cycle.id));
    }
}
