import { Job, Queue } from "bullmq";
import { db } from "@server/database_service.js";
import { scheduleTriggers, scheduledJobs, schedules } from "@shared/schema/index.js";
import { eq, lte } from "drizzle-orm";
import { calculateNextRun } from "./schedule-calculator.js";
import { scheduleExecutor } from "./schedule-executor.js";
import { BaseWorker } from "@server/workers/base-worker.js";
import { getRedisOptions } from "@domain/core/infrastructure/redis/redis-client.js";

const SCHEDULER_QUEUE = "oddjob-scheduler";
const SCHEDULED_JOBS_QUEUE = "oddjob-scheduled-jobs";

export const schedulerQueue = new Queue(SCHEDULER_QUEUE, {
    connection: getRedisOptions(),
});

export const scheduledJobQueue = new Queue(SCHEDULED_JOBS_QUEUE, {
    connection: getRedisOptions(),
});

/**
 * Scheduler Worker - Polls for due triggers
 */
export class SchedulerWorker extends BaseWorker<void, { checked: boolean, triggersFound: number }> {
    constructor() {
        super(SCHEDULER_QUEUE, {
            concurrency: 1, // Only one poll at a time
            lockDuration: 60000,
        });
    }

    protected async execute(job: Job): Promise<{ checked: boolean, triggersFound: number }> {
        if (job.name === "scheduled-crew-meeting-launch") {
            const { scheduleId } = (job.data || {}) as { scheduleId: number };
            this.logger.info(`[SchedulerWorker] Launching scheduled crew meeting #${scheduleId}`);
            try {
                const { crewMeetingSchedulerService } = await import("@server/domain/crew/core/crew-meeting-scheduler.service.js");
                await crewMeetingSchedulerService.launchScheduledMeeting(scheduleId);
            } catch (launchErr) {
                this.logger.error(`[SchedulerWorker] Failed to launch scheduled meeting #${scheduleId}: ${launchErr}`);
            }
            return { checked: true, triggersFound: 1 };
        }

        this.logger.debug("[SchedulerWorker] Checking for due triggers...");

        const now = new Date();
        const triggers = await db.select()
            .from(scheduleTriggers)
            .where(lte(scheduleTriggers.nextFireAt, now));

        if (triggers.length === 0) {
            return { checked: true, triggersFound: 0 };
        }

        this.logger.info(`[SchedulerWorker] Found ${triggers.length} due triggers`);

        for (const trigger of triggers) {
            await scheduledJobQueue.add('execute-trigger', {
                triggerId: trigger.id,
                scheduledJobId: trigger.scheduledJobId,
                scheduledFor: trigger.nextFireAt,
            }, {
                jobId: `trigger-${trigger.id}-${Date.now()}`,
            });
        }

        return { checked: true, triggersFound: triggers.length };
    }
}

interface ScheduledJobData {
    triggerId: number;
    scheduledJobId: number;
    scheduledFor: Date | string;
}

/**
 * Scheduled Job Executor Worker - Executes individual scheduled jobs
 */
export class ScheduledJobExecutor extends BaseWorker<ScheduledJobData, { success: boolean }> {
    constructor() {
        super(SCHEDULED_JOBS_QUEUE, {
            concurrency: 5,
            lockDuration: 300000, // 5 mins
        });
    }

    protected async execute(job: Job<ScheduledJobData>): Promise<{ success: boolean }> {
        const { triggerId, scheduledJobId, scheduledFor } = job.data;

        this.logger.info(`[ScheduledJobWorker] Processing trigger ${triggerId} for job ${scheduledJobId}`);

        const [scheduledJob] = await db.select()
            .from(scheduledJobs)
            .where(eq(scheduledJobs.id, scheduledJobId));

        if (!scheduledJob || !scheduledJob.isActive) {
            this.logger.warn(`[ScheduledJobWorker] Scheduled job ${scheduledJobId} not found or inactive`);
            if (triggerId > 0) {
                await db.delete(scheduleTriggers).where(eq(scheduleTriggers.id, triggerId));
            }
            return { success: false };
        }

        // Use the polymorphic ScheduleExecutor
        await scheduleExecutor.executeScheduledItem(
            scheduledJob, 
            { id: triggerId, nextFireAt: new Date(scheduledFor) },
            job.attemptsMade
        );

        // Reschedule trigger
        await this.rescheduleTrigger(triggerId, scheduledJob);

        return { success: true };
    }

    private async rescheduleTrigger(triggerId: number, scheduledJob: typeof scheduledJobs.$inferSelect) {
        if (triggerId <= 0 || !scheduledJob.scheduleId) {
            return; 
        }

        const [schedule] = await db.select().from(schedules).where(eq(schedules.id, scheduledJob.scheduleId));
        if (!schedule || !schedule.isActive) {
            await db.delete(scheduleTriggers).where(eq(scheduleTriggers.id, triggerId));
            return;
        }

        const nextRun = calculateNextRun(schedule);
        if (nextRun) {
            await db.update(scheduleTriggers)
                .set({ nextFireAt: nextRun })
                .where(eq(scheduleTriggers.id, triggerId));
        } else {
            await db.delete(scheduleTriggers).where(eq(scheduleTriggers.id, triggerId));
        }
    }
}

// Singletons
let schedulerWorker: SchedulerWorker | null = null;
let scheduledJobExecutor: ScheduledJobExecutor | null = null;

export function startSchedulerWorker() {
    if (!schedulerWorker) {
        schedulerWorker = new SchedulerWorker();
    }
    return schedulerWorker;
}

export function startScheduledJobExecutor() {
    if (!scheduledJobExecutor) {
        scheduledJobExecutor = new ScheduledJobExecutor();
    }
    return scheduledJobExecutor;
}

export async function initScheduler() {
    await schedulerQueue.add('poll-schedules', {}, {
        repeat: {
            every: 60000,
        },
        jobId: 'scheduler-poll',
    });
}
