/**
 * Unified Schedule Service
 * 
 * Central authority for schedule and scheduled job operations.
 * Consolidates fragmented logic from Mission and Pipeline domains.
 */

import { db } from "@server/database_service.js";
import {
    scheduledJobs,
    schedules,
    jobs,
    missions,
    users,
    scheduleExecutionHistory,
    credentials,
    type ScheduledJob,
    type Schedule,
} from "@shared/schema/index.js";
import { eq, and, desc, sql, type SQL, or } from "drizzle-orm";
import { NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { calculateNextRunTime } from "@server/utils/cron-utils.js";
import { format as formatDate } from "date-fns";

const logger = createLogger("ScheduleService");

// ============================================================================
// TYPES
// ============================================================================

export interface CreateScheduleInput {
    name: string;
    description?: string | null;
    pattern: number;
    timezone?: string | null;
    patternString: Record<string, any>;
    patternLabel?: string | null;
    isActive?: boolean;
    calendarId?: number | null;
    onHolidayBehavior?: string | null;
}

export interface UpdateScheduleInput extends Partial<CreateScheduleInput> { }

export interface ScheduleListOptions {
    isActive?: boolean;
    limit?: number;
}

export interface CreateScheduledJobInput {
    name: string;
    description?: string;
    jobId?: number | null;
    scheduleId?: number | null;
    pipelineId?: number | null;
    missionId?: number | null;
    triggerType?: string;
    triggerCredentialId?: number | null;
    priority?: number;
    isActive?: boolean;
    alertOnFailure?: boolean;
    alertOnSuccess?: boolean;
    parameterValues?: Record<string, any>;
    labels?: Record<string, any>;
    // Legacy mapping support
    inputData?: Record<string, any>;
    config?: Record<string, any>;
}

export interface UpdateScheduledJobInput extends Partial<CreateScheduledJobInput> { }

export interface ScheduledJobListOptions {
    isActive?: boolean;
    jobId?: number;
    limit?: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getOrgConditions(orgContext: OrgContext): SQL[] {
    return orgContext.organizationId !== null
        ? [eq(scheduledJobs.organizationId, orgContext.organizationId)]
        : [sql`${scheduledJobs.organizationId} IS NULL`];
}

function getScheduleOrgConditions(orgContext: OrgContext): SQL[] {
    return orgContext.organizationId !== null
        ? [eq(schedules.organizationId, orgContext.organizationId)]
        : [sql`${schedules.organizationId} IS NULL`];
}

async function getUser(userId: string) {
    if (!userId) return null;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return user || null;
}

// ============================================================================
// UNIFIED SCHEDULE SERVICE
// ============================================================================

export const scheduleService = {
    /**
     * The webhook credential a scheduled job is being pointed at.
     *
     * Org-scoped: the route looked this up by id alone, which let a job in one
     * org reference another tenant's webhook credential.
     */
    async getWebhookCredential(credentialId: number, organizationId: number) {
        const [credential] = await db
            .select()
            .from(credentials)
            .where(and(eq(credentials.id, credentialId), eq(credentials.organizationId, organizationId)))
            .limit(1);
        return credential;
    },

    // ========================================================================
    // SCHEDULE DEFINITIONS (schedules table)
    // ========================================================================

    async listSchedules(orgContext: OrgContext, options: ScheduleListOptions = {}): Promise<Schedule[]> {
        return withQueryTracking("scheduleService.listSchedules", async () => {
            const conditions: SQL[] = getScheduleOrgConditions(orgContext);

            if (options.isActive !== undefined) {
                conditions.push(eq(schedules.isActive, options.isActive));
            }

            let query = db
                .select()
                .from(schedules)
                .where(and(...conditions))
                .orderBy(desc(schedules.createdAt));

            if (options.limit) {
                query = query.limit(options.limit) as typeof query;
            }

            return await query;
        }, { table: "schedules", operation: "select" });
    },

    async getScheduleById(scheduleId: number, orgContext: OrgContext): Promise<Schedule> {
        return withQueryTracking("scheduleService.getScheduleById", async () => {
            const conditions = [eq(schedules.id, scheduleId), ...getScheduleOrgConditions(orgContext)];

            const [schedule] = await db.select().from(schedules).where(and(...conditions)).limit(1);
            if (!schedule) {
                throw new NotFoundError("Schedule not found");
            }

            return schedule;
        }, { table: "schedules", operation: "select" });
    },

    async createSchedule(input: CreateScheduleInput, orgContext: OrgContext): Promise<Schedule> {
        return withQueryTracking("scheduleService.createSchedule", async () => {
            const user = await getUser(orgContext.userId);
            const createdBy = user?.username || "system";

            const [schedule] = await db.insert(schedules).values({
                name: input.name,
                description: input.description,
                pattern: input.pattern,
                timezone: input.timezone,
                patternString: input.patternString,
                patternLabel: input.patternLabel,
                isActive: input.isActive ?? true,
                calendarId: input.calendarId,
                onHolidayBehavior: input.onHolidayBehavior,
                organizationId: orgContext.organizationId,
                createdBy: createdBy,
            }).returning();

            logger.info("Schedule created", { scheduleId: schedule.id, name: schedule.name });
            return schedule;
        }, { table: "schedules", operation: "insert" });
    },

    async updateSchedule(scheduleId: number, input: UpdateScheduleInput, orgContext: OrgContext): Promise<Schedule> {
        return withQueryTracking("scheduleService.updateSchedule", async () => {
            const conditions = [eq(schedules.id, scheduleId), ...getScheduleOrgConditions(orgContext)];

            const [existing] = await db.select().from(schedules).where(and(...conditions)).limit(1);
            if (!existing) {
                throw new NotFoundError("Schedule not found");
            }

            const [updated] = await db
                .update(schedules)
                .set(input)
                .where(and(...conditions))
                .returning();

            logger.info("Schedule updated", { scheduleId });
            return updated;
        }, { table: "schedules", operation: "update" });
    },

    async deleteSchedule(scheduleId: number, orgContext: OrgContext): Promise<void> {
        return withQueryTracking("scheduleService.deleteSchedule", async () => {
            const conditions = [eq(schedules.id, scheduleId), ...getScheduleOrgConditions(orgContext)];

            const [existing] = await db.select().from(schedules).where(and(...conditions)).limit(1);
            if (!existing) {
                throw new NotFoundError("Schedule not found");
            }

            await db.delete(schedules).where(and(...conditions));
            logger.info("Schedule deleted", { scheduleId });
        }, { table: "schedules", operation: "delete" });
    },


    // ========================================================================
    // SCHEDULED JOBS (scheduled_jobs table)
    // ========================================================================

    async list(orgContext: OrgContext, options: ScheduledJobListOptions = {}): Promise<ScheduledJob[]> {
        return withQueryTracking("scheduleService.list", async () => {
            const conditions: SQL[] = getOrgConditions(orgContext);

            if (options.isActive !== undefined) {
                conditions.push(eq(scheduledJobs.isActive, options.isActive));
            }

            if (options.jobId) {
                conditions.push(eq(scheduledJobs.jobId, options.jobId));
            }

            let query = db
                .select()
                .from(scheduledJobs)
                .where(and(...conditions))
                .orderBy(desc(scheduledJobs.createdAt));

            if (options.limit) {
                query = query.limit(options.limit) as typeof query;
            }

            return await query;
        }, { table: "scheduled_jobs", operation: "select" });
    },

    async getById(scheduledJobId: number, orgContext: OrgContext): Promise<ScheduledJob> {
        return withQueryTracking("scheduleService.getById", async () => {
            const conditions = [eq(scheduledJobs.id, scheduledJobId), ...getOrgConditions(orgContext)];

            const [scheduledJob] = await db.select().from(scheduledJobs).where(and(...conditions)).limit(1);
            if (!scheduledJob) {
                throw new NotFoundError("Scheduled job not found");
            }

            return scheduledJob;
        }, { table: "scheduled_jobs", operation: "select" });
    },

    async create(input: CreateScheduledJobInput, orgContext: OrgContext): Promise<ScheduledJob> {
        return withQueryTracking("scheduleService.create", async () => {
            const user = await getUser(orgContext.userId);

            const [scheduledJob] = await db.insert(scheduledJobs).values({
                name: input.name,
                jobId: input.jobId || null,
                pipelineId: input.pipelineId || null,
                missionId: input.missionId || null,
                scheduleId: input.scheduleId || null,
                triggerType: input.triggerType || "Schedule",
                triggerCredentialId: input.triggerCredentialId,
                priority: input.priority || 2,
                isActive: input.isActive ?? true,
                alertOnFailure: input.alertOnFailure ?? true,
                alertOnSuccess: input.alertOnSuccess ?? false,
                parameterValues: input.parameterValues || input.inputData || {},
                labels: input.labels || input.config || {},
                organizationId: orgContext.organizationId,
                createdBy: user?.username || "system",
            }).returning();

            logger.info("Scheduled job created", {
                scheduledJobId: scheduledJob.id,
                name: scheduledJob.name,
            });

            return scheduledJob;
        }, { table: "scheduled_jobs", operation: "insert" });
    },

    async update(scheduledJobId: number, input: UpdateScheduledJobInput, orgContext: OrgContext): Promise<ScheduledJob> {
        return withQueryTracking("scheduleService.update", async () => {
            const conditions = [eq(scheduledJobs.id, scheduledJobId), ...getOrgConditions(orgContext)];

            const [existing] = await db.select().from(scheduledJobs).where(and(...conditions)).limit(1);
            if (!existing) {
                throw new NotFoundError("Scheduled job not found");
            }

            const updateData: any = {
                name: input.name,
                jobId: input.jobId,
                pipelineId: input.pipelineId,
                missionId: input.missionId,
                scheduleId: input.scheduleId,
                triggerType: input.triggerType,
                triggerCredentialId: input.triggerCredentialId,
                priority: input.priority,
                isActive: input.isActive,
                alertOnFailure: input.alertOnFailure,
                alertOnSuccess: input.alertOnSuccess,
                parameterValues: input.parameterValues || input.inputData,
                labels: input.labels || input.config,
            };

            Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

            const [updated] = await db
                .update(scheduledJobs)
                .set(updateData)
                .where(and(...conditions))
                .returning();

            logger.info("Scheduled job updated", { scheduledJobId });
            return updated;
        }, { table: "scheduled_jobs", operation: "update" });
    },

    async delete(scheduledJobId: number, orgContext: OrgContext): Promise<void> {
        return withQueryTracking("scheduleService.delete", async () => {
            const conditions = [eq(scheduledJobs.id, scheduledJobId), ...getOrgConditions(orgContext)];
            await db.delete(scheduledJobs).where(and(...conditions));

            logger.info("Scheduled job deleted", { scheduledJobId });
        }, { table: "scheduled_jobs", operation: "delete" });
    },

    async setActive(scheduledJobId: number, isActive: boolean, orgContext: OrgContext): Promise<ScheduledJob> {
        return this.update(scheduledJobId, { isActive }, orgContext);
    },

    async runNow(scheduledJobId: number, orgContext: OrgContext): Promise<{ executionId: number }> {
        await this.getById(scheduledJobId, orgContext);

        const { scheduledJobQueue } = await import("../infrastructure/scheduler-worker.js");
        const { randomUUID } = await import("crypto");

        try {
            await scheduledJobQueue.add('execute-trigger', {
                triggerId: -1, // Manual run
                scheduledJobId: scheduledJobId,
                scheduledFor: new Date(),
            }, {
                jobId: `manual-${scheduledJobId}-${randomUUID()}`,
            });
            return { executionId: 0 };
        } catch (error) {
            throw error;
        }
    },

    async getStats(orgContext: OrgContext): Promise<{
        total: number;
        active: number;
        inactive: number;
    }> {
        const all = await this.list(orgContext);
        const active = all.filter(s => s.isActive);

        return {
            total: all.length,
            active: active.length,
            inactive: all.length - active.length,
        };
    },

    async getExecutionStats(days: number, orgContext: OrgContext): Promise<any> {
        return withQueryTracking("scheduleService.getExecutionStats", async () => {
            const conditions = [];

            if (orgContext.organizationId !== null) {
                conditions.push(eq(scheduleExecutionHistory.organizationId, orgContext.organizationId));
            } else if (!orgContext.isAdmin) {
                conditions.push(sql`${scheduleExecutionHistory.organizationId} IS NULL`);
            }

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            conditions.push(sql`${scheduleExecutionHistory.startedAt} >= ${startDate}`);

            const stats = await db.select({
                status: scheduleExecutionHistory.status,
                count: sql<number>`count(*)`,
                avgDurationMs: sql<number>`avg(${scheduleExecutionHistory.durationMs})`,
            })
                .from(scheduleExecutionHistory)
                .where(and(...conditions))
                .groupBy(scheduleExecutionHistory.status);

            const dailyStats = await db.select({
                date: sql<string>`DATE(${scheduleExecutionHistory.startedAt})`,
                completed: sql<number>`count(*) FILTER (WHERE ${scheduleExecutionHistory.status} = 'completed')`,
                failed: sql<number>`count(*) FILTER (WHERE ${scheduleExecutionHistory.status} = 'failed')`,
                total: sql<number>`count(*)`,
            })
                .from(scheduleExecutionHistory)
                .where(and(...conditions))
                .groupBy(sql`DATE(${scheduleExecutionHistory.startedAt})`)
                .orderBy(sql`DATE(${scheduleExecutionHistory.startedAt})`);

            const statsMap = stats.reduce((acc, s) => {
                if (s.status) {
                    acc[s.status] = { count: Number(s.count), avgDurationMs: Number(s.avgDurationMs) || 0 };
                }
                return acc;
            }, {} as Record<string, { count: number; avgDurationMs: number }>);

            const avgSum = Object.values(statsMap).reduce((sum: number, s: any) => sum + (s.avgDurationMs || 0) * (s.count || 0), 0);
            const countSum = Object.values(statsMap).reduce((sum: number, s: any) => sum + (s.count || 0), 0);

            return {
                summary: {
                    completed: statsMap['completed']?.count || 0,
                    failed: statsMap['failed']?.count || 0,
                    running: statsMap['running']?.count || 0,
                    retrying: statsMap['retrying']?.count || 0,
                    avgDurationMs: Math.round(avgSum / (countSum || 1)),
                },
                daily: dailyStats.map(d => ({
                    date: d.date,
                    completed: Number(d.completed),
                    failed: Number(d.failed),
                    total: Number(d.total),
                })),
                period: { days, startDate: startDate.toISOString() },
            };
        }, { table: "schedule_execution_history", operation: "select" });
    },

    async getExecutionHistory(
        orgContext: OrgContext,
        options: {
            limit?: number;
            offset?: number;
            status?: string;
            scheduledJobId?: number;
            executionId?: number;
        } = {}
    ): Promise<any> {
        return withQueryTracking("scheduleService.getExecutionHistory", async () => {
            const conditions = [];

            if (orgContext.organizationId !== null) {
                conditions.push(eq(scheduleExecutionHistory.organizationId, orgContext.organizationId));
            } else if (!orgContext.isAdmin) {
                conditions.push(sql`${scheduleExecutionHistory.organizationId} IS NULL`);
            }

            if (options.status) {
                conditions.push(eq(scheduleExecutionHistory.status, options.status));
            }

            if (options.scheduledJobId) {
                conditions.push(eq(scheduleExecutionHistory.scheduledJobId, options.scheduledJobId));
            }

            if (options.executionId) {
                conditions.push(eq(scheduleExecutionHistory.id, options.executionId));
            }

            const limit = options.limit || 20;
            const offset = options.offset || 0;

            const query = db.select({
                id: scheduleExecutionHistory.id,
                scheduledJobId: scheduleExecutionHistory.scheduledJobId,
                scheduledJobName: scheduledJobs.name,
                status: scheduleExecutionHistory.status,
                executionType: scheduleExecutionHistory.executionType,
                scheduledFor: scheduleExecutionHistory.scheduledFor,
                startedAt: scheduleExecutionHistory.startedAt,
                completedAt: scheduleExecutionHistory.completedAt,
                durationMs: scheduleExecutionHistory.durationMs,
                retryCount: scheduleExecutionHistory.retryCount,
                error: scheduleExecutionHistory.error,
                organizationId: scheduleExecutionHistory.organizationId
            })
                .from(scheduleExecutionHistory)
                .leftJoin(scheduledJobs, eq(scheduleExecutionHistory.scheduledJobId, scheduledJobs.id))
                .where(and(...conditions))
                .orderBy(desc(scheduleExecutionHistory.startedAt))
                .limit(limit)
                .offset(offset);

            const data = await query;

            let total = 0;
            if (!options.executionId) {
                const [countResult] = await db.select({ count: sql<number>`count(*)` })
                    .from(scheduleExecutionHistory)
                    .where(and(...conditions));
                total = Number(countResult.count);
            } else {
                total = data.length;
            }

            return {
                data,
                pagination: {
                    total,
                    limit,
                    offset,
                    hasMore: offset + data.length < total,
                }
            };
        }, { table: "schedule_execution_history", operation: "select" });
    },

    async previewSchedule(input: {
        pattern: number;
        patternString?: Record<string, any>;
        timezone?: string;
        starttime?: string;
    }): Promise<{
        timezone: string;
        occurrences: any[];
        warnings: string[];
    }> {
        const { pattern, patternString, timezone, starttime } = input;
        const occurrences: any[] = [];
        const now = new Date();

        if (pattern === 1) {
            for (let i = 1; i <= 5; i++) {
                const next = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
                if (starttime) {
                    const [hours, minutes] = starttime.split(':').map(Number);
                    next.setHours(hours, minutes, 0, 0);
                }
                occurrences.push({
                    local_time: next.toISOString(),
                    utc_time: next.toISOString(),
                    adjustments: { maintenance_window: false }
                });
            }
        } else if (pattern === 2) {
            for (let i = 1; i <= 5; i++) {
                const next = new Date(now.getTime() + i * 7 * 24 * 60 * 60 * 1000);
                if (starttime) {
                    const [hours, minutes] = starttime.split(':').map(Number);
                    next.setHours(hours, minutes, 0, 0);
                }
                occurrences.push({
                    local_time: next.toISOString(),
                    utc_time: next.toISOString(),
                    adjustments: { maintenance_window: false }
                });
            }
        } else if (pattern === 3) {
            const dayOfMonth = patternString?.dayOfMonth || patternString?.dayofmonth || 1;
            for (let i = 1; i <= 5; i++) {
                const next = new Date(now);
                const targetMonth = next.getMonth() + i;
                const targetYear = next.getFullYear() + Math.floor(targetMonth / 12);
                const targetMonthAdjusted = targetMonth % 12;
                const daysInMonth = new Date(targetYear, targetMonthAdjusted + 1, 0).getDate();
                const clampedDay = Math.min(dayOfMonth, daysInMonth);
                next.setFullYear(targetYear, targetMonthAdjusted, clampedDay);
                if (starttime) {
                    const [hours, minutes] = starttime.split(':').map(Number);
                    next.setHours(hours, minutes, 0, 0);
                }
                occurrences.push({
                    local_time: next.toISOString(),
                    utc_time: next.toISOString(),
                    adjustments: { maintenance_window: false }
                });
            }
        } else if (pattern === 4 && patternString) {
            for (let i = 1; i <= 5; i++) {
                const next = new Date(now.getTime() + i * 60 * 60 * 1000);
                occurrences.push({
                    local_time: next.toISOString(),
                    utc_time: next.toISOString(),
                    adjustments: { maintenance_window: false }
                });
            }
        }

        return {
            timezone: timezone || "UTC",
            occurrences,
            warnings: pattern === 4 && patternString?.toString().includes("* *") ? ["Rare schedule detected"] : []
        };
    },

    async getEnrichedScheduledJobs(orgContext: OrgContext): Promise<any[]> {
        return withQueryTracking("scheduleService.getEnrichedScheduledJobs", async () => {
            const conditions = [];

            if (orgContext.organizationId !== null) {
                conditions.push(
                    or(
                        eq(scheduledJobs.organizationId, orgContext.organizationId),
                        eq(jobs.organizationId, orgContext.organizationId),
                        eq(missions.organizationId, orgContext.organizationId)
                    )
                );
            } else if (!orgContext.isAdmin) {
                conditions.push(
                    or(
                        sql`${scheduledJobs.organizationId} IS NULL`,
                        sql`${jobs.organizationId} IS NULL`,
                        sql`${missions.organizationId} IS NULL`
                    )
                );
            }

            const allScheduledJobs = await db.select({
                id: scheduledJobs.id,
                scheduledJobId: scheduledJobs.id,
                name: scheduledJobs.name,
                jobId: scheduledJobs.jobId,
                pipelineId: scheduledJobs.pipelineId,
                missionId: scheduledJobs.missionId,
                scheduleId: scheduledJobs.scheduleId,
                isActive: scheduledJobs.isActive,
                priority: scheduledJobs.priority,
                alertOnFailure: scheduledJobs.alertOnFailure,
                createdBy: scheduledJobs.createdBy,
                jobName: jobs.name,
                scheduleName: schedules.name,
                missionName: missions.name,
                schedulePattern: schedules.pattern,
                schedulePatternString: schedules.patternString,
                scheduleTimezone: schedules.timezone,
                scheduleIsActive: schedules.isActive,
                schedulePatternLabel: schedules.patternLabel
            })
                .from(scheduledJobs)
                .leftJoin(jobs, eq(scheduledJobs.jobId, jobs.id))
                .leftJoin(missions, eq(scheduledJobs.missionId, missions.id))
                .leftJoin(schedules, eq(scheduledJobs.scheduleId, schedules.id))
                .where(and(...conditions))
                .orderBy(desc(scheduledJobs.createdAt));

            return allScheduledJobs.map((sj: any) => {
                const schedule = sj.scheduleId ? {
                    pattern: sj.schedulePattern,
                    patternString: sj.schedulePatternString,
                    timezone: sj.scheduleTimezone,
                    isActive: sj.scheduleIsActive
                } : null;

                let nextRunTime: string | null = null;
                try {
                    const nextRunTimeISO = calculateNextRunTime(schedule);
                    if (nextRunTimeISO) {
                        nextRunTime = formatDate(new Date(nextRunTimeISO), 'MMM d, yyyy HH:mm:ss');
                    }
                } catch (error: any) {
                    logger.error(`Error calculating next run time for scheduled job ${sj.scheduledJobId || sj.id}`, error);
                }

                return {
                    ...sj,
                    nextRunTime,
                    schedule: schedule
                };
            });
        }, { table: "scheduled_jobs", operation: "select" });
    },

    async getJobWithDetails(jobId: number, organizationId: number | null) {
        const conditions = [eq(jobs.id, jobId), ...(organizationId !== null ? [eq(jobs.organizationId, organizationId)] : [sql`${jobs.organizationId} IS NULL`])];
        const rows = await db.select().from(jobs).where(and(...conditions)).limit(1);
        return rows[0] || null;
    },

    async checkCredentialAccess(credentialId: number, organizationId: number | null) {
        const conditions = [eq(credentials.id, credentialId), ...(organizationId !== null ? [eq(credentials.organizationId, organizationId)] : [sql`${credentials.organizationId} IS NULL`])];
        const [cred] = await db.select().from(credentials).where(and(...conditions)).limit(1);
        return !!cred;
    }
};

export default scheduleService;
