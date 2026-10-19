import { type Request, type Response } from "express";
import { BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AppPlatformSchedulesController");

export class SchedulesController {
    public static async createSchedule(req: Request, res: Response) {
        const { orgId, deploymentId } = req.appTokenContext!;
        const { name, cronExpression, pipelineId, missionId, timezone } = req.body;
        if (!name || typeof name !== "string")
            throw new BadRequestError("'name' is required");
        if (!cronExpression || typeof cronExpression !== "string")
            throw new BadRequestError("'cronExpression' is required");
        if (!pipelineId && !missionId)
            throw new BadRequestError(
                "Either 'pipelineId' or 'missionId' is required",
            );

        const { scheduleService } =
            await import("@domain/schedules/core/schedule.service.js");
        const { getSystemOrgContext } =
            await import("@server/utils/auth-context.js");
        const orgContext = getSystemOrgContext(orgId);

        const schedule = await scheduleService.createSchedule(
            {
                name: `app-${deploymentId}:${name}`,
                pattern: 2,
                patternString: { expression: cronExpression },
                patternLabel: cronExpression,
                timezone: timezone ?? "UTC",
                isActive: true,
            },
            orgContext,
        );

        const scheduledJob = await scheduleService.create(
            {
                name: `app-${deploymentId}:${name}`,
                scheduleId: schedule.id,
                pipelineId: pipelineId ?? null,
                missionId: missionId ?? null,
                triggerType: "Schedule",
                isActive: true,
            },
            orgContext,
        );

        logger.info(
            `[AppPlatform] Deployment ${deploymentId} created schedule '${name}' (scheduleId: ${schedule.id}, jobId: ${scheduledJob.id})`,
        );
        res.status(201).json({
            scheduleId: schedule.id,
            scheduledJobId: scheduledJob.id,
            cronExpression,
        });
    }
}
