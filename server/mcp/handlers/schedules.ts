import {
    ListSchedulesInput,
    GetScheduleDetailsInput,
    CreateScheduleInput,
    UpdateScheduleInput,
    DeleteScheduleInput,
    ListScheduledJobsInput,
    GetScheduledJobDetailsInput,
    CreateScheduledJobInput,
    UpdateScheduledJobInput,
    DeleteScheduledJobInput,
} from "../tools/schedules.js";
import { scheduleService } from "../../domain/schedules/core/schedule.service.js";
import { db } from "../../database_service.js";
import { schedules, type Schedule } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import {
    successResponse,
    getOrgContext,
    createHandlerWrapper,
    type ToolContext
} from "./utils.js";

// Type for schedule list item response
interface ScheduleListItem {
    id: number;
    name: string;
    description: string | null;
    pattern: string;
    patternLabel: string | null;
    timezone: string | null;
    isActive: boolean;
}

// Type for upcoming run response
interface UpcomingRunItem {
    id: number;
    name: string;
    nextRun: Date | string;
    jobName: string | null;
    scheduleName: string | null;
}

export const handleListSchedules = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ListSchedulesInput.parse(args);
        const orgContext = getOrgContext(context);

        const results = await scheduleService.listSchedules(orgContext, {
            isActive: input.activeOnly ? true : undefined,
            limit: 100
        });

        return successResponse(
            results.map((s: any): ScheduleListItem => ({
                id: s.id,
                name: s.name,
                description: s.description,
                pattern: String(s.pattern),
                patternLabel: s.patternLabel,
                timezone: s.timezone,
                isActive: s.isActive,
            })),
            `Found ${results.length} schedules`
        );
    }
);

export const handleGetScheduleDetails = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetScheduleDetailsInput.parse(args);
        const orgContext = getOrgContext(context);

        let schedule: Schedule | undefined;
        if (input.scheduleId) {
            schedule = await scheduleService.getScheduleById(input.scheduleId, orgContext);
        } else if (input.scheduleName) {
            const all = await scheduleService.listSchedules(orgContext);
            schedule = all.find((s: any) => s.name.toLowerCase().includes(input.scheduleName!.toLowerCase()));
        }

        if (!schedule) {
            throw new Error("Schedule not found");
        }

        return successResponse(schedule, `Schedule: ${schedule.name}`);
    }
);

export const handleCreateSchedule = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = CreateScheduleInput.parse(args);
        const orgContext = getOrgContext(context);

        const newSchedule = await scheduleService.createSchedule({
            name: input.name,
            description: input.description ?? null,
            pattern: input.pattern,
            patternString: input.patternString ?? {},
            patternLabel: input.patternLabel ?? null,
            timezone: input.timezone ?? null,
            isActive: input.isActive ?? true,
        }, orgContext);

        return successResponse(
            { id: newSchedule.id, name: newSchedule.name },
            `Created schedule "${input.name}" (ID: ${newSchedule.id})`
        );
    }
);

export const handleUpdateSchedule = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = UpdateScheduleInput.parse(args);
        const orgContext = getOrgContext(context);
        const orgIdNum = orgContext.organizationId;

        if (orgIdNum === null || orgIdNum === undefined) {
            throw new Error("Organization ID required for update");
        }

        const [existing] = await db.select().from(schedules)
            .where(and(eq(schedules.id, input.scheduleId), eq(schedules.organizationId, orgIdNum)));

        if (!existing) {
            throw new Error("Schedule not found or access denied");
        }

        const updateData: Partial<Schedule> = {};
        if (input.name !== undefined) updateData.name = input.name;
        if (input.description !== undefined) updateData.description = input.description;
        if (input.pattern !== undefined) updateData.pattern = input.pattern;
        if (input.patternString !== undefined) updateData.patternString = input.patternString;
        if (input.patternLabel !== undefined) updateData.patternLabel = input.patternLabel;
        if (input.timezone !== undefined) updateData.timezone = input.timezone;
        if (input.isActive !== undefined) updateData.isActive = input.isActive;

        const [updated] = await db.update(schedules)
            .set(updateData)
            .where(eq(schedules.id, input.scheduleId))
            .returning();

        return successResponse(
            { id: updated.id, name: updated.name, isActive: updated.isActive },
            `Updated schedule "${updated.name}"`
        );
    },
    { requireAdmin: true }
);

export const handleDeleteSchedule = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = DeleteScheduleInput.parse(args);
        const orgContext = getOrgContext(context);
        const orgIdNum = orgContext.organizationId;

        if (orgIdNum === null || orgIdNum === undefined) {
            throw new Error("Organization ID required for delete");
        }

        const [existing] = await db.select().from(schedules)
            .where(and(eq(schedules.id, input.scheduleId), eq(schedules.organizationId, orgIdNum)));

        if (!existing) {
            throw new Error("Schedule not found or access denied");
        }

        await db.delete(schedules).where(eq(schedules.id, input.scheduleId));
        return successResponse({ id: input.scheduleId, deleted: true });
    },
    { requireAdmin: true }
);

export const handleListScheduledJobs = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = ListScheduledJobsInput.parse(args);
        const orgContext = getOrgContext(context);
        const results = await scheduleService.getEnrichedScheduledJobs(orgContext);

        let filtered = results;
        if (input.activeOnly) {
            filtered = results.filter((sj: any) => sj.isActive);
        }
        if (input.triggerType) {
            filtered = filtered.filter((sj: any) => sj.triggerType === input.triggerType);
        }

        return successResponse(filtered);
    }
);

export const handleGetScheduledJobDetails = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = GetScheduledJobDetailsInput.parse(args);
        const orgContext = getOrgContext(context);
        const scheduledJob = await scheduleService.getById(input.scheduledJobId!, orgContext);

        if (!scheduledJob) {
            throw new Error("Scheduled job not found");
        }

        return successResponse(scheduledJob, `Scheduled job: ${scheduledJob.name}`);
    }
);

export const handleCreateScheduledJob = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = CreateScheduledJobInput.parse(args);
        const orgContext = getOrgContext(context);

        const sj = await scheduleService.create({
            ...input,
        }, orgContext);

        return successResponse(
            { id: sj.id, name: sj.name, jobId: sj.jobId, pipelineId: sj.pipelineId, triggerType: sj.triggerType },
            `Created scheduled job "${input.name}" (ID: ${sj.id})`
        );
    }
);

export const handleUpdateScheduledJob = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = UpdateScheduledJobInput.parse(args);
        const orgContext = getOrgContext(context);

        const updated = await scheduleService.update(input.scheduledJobId, input, orgContext);

        return successResponse(
            { id: updated.id, name: updated.name, isActive: updated.isActive },
            `Updated scheduled job "${updated.name}"`
        );
    }
);

export const handleDeleteScheduledJob = createHandlerWrapper(
    async (args: unknown, context?: ToolContext) => {
        const input = DeleteScheduledJobInput.parse(args);
        const orgContext = getOrgContext(context);
        await scheduleService.delete(input.scheduledJobId, orgContext);
        return successResponse({ id: input.scheduledJobId, deleted: true });
    }
);

export const handleGetUpcomingScheduledRuns = createHandlerWrapper(
    async (_args: unknown, context?: ToolContext) => {
        const orgContext = getOrgContext(context);
        const enriched = await scheduleService.getEnrichedScheduledJobs(orgContext);

        const upcoming = enriched
            .filter((sj: any) => sj.isActive && sj.nextRunTime)
            .sort((a: any, b: any) => new Date(a.nextRunTime).getTime() - new Date(b.nextRunTime).getTime())
            .slice(0, 10);

        return successResponse(
            upcoming.map((u: any): UpcomingRunItem => ({
                id: u.id,
                name: u.name,
                nextRun: u.nextRunTime,
                jobName: u.jobName,
                scheduleName: u.scheduleName,
            })),
            `Found ${upcoming.length} upcoming runs`
        );
    }
);

