import { Router, type Request, type Response } from "express";
import {
    insertScheduledJobSchema, credentials
} from "@shared/schema/index.js";
import { eq } from "drizzle-orm"; 
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, NotFoundError, ForbiddenError, ErrorCode } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { scheduleService } from "../core/schedule.service.js";
import { db } from "@server/database_service.js";

const logger = createLogger('Schedules');
const router = Router();

// --- Schedules ---

router.get("/schedules", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const allSchedules = await scheduleService.listSchedules(orgContext);
    res.json(allSchedules);
}));

router.get("/schedules/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        throw new BadRequestError("Invalid schedule ID");
    }
    const schedule = await scheduleService.getScheduleById(id, orgContext);
    res.json(schedule);
}));

router.post("/schedules", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const schedule = await scheduleService.createSchedule(req.body, orgContext);
    res.json(schedule);
}));

router.put("/schedules/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        throw new BadRequestError("Invalid schedule ID");
    }
    const schedule = await scheduleService.updateSchedule(id, req.body, orgContext);
    res.json(schedule);
}));

router.delete("/schedules/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        throw new BadRequestError("Invalid schedule ID");
    }
    await scheduleService.deleteSchedule(id, orgContext);
    res.status(204).send();
}));

// --- Preview Schedule ---
router.post("/schedules/preview", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const result = await scheduleService.previewSchedule(req.body);
    res.json(result);
}));

// --- Scheduled Jobs ---

router.get("/scheduled-jobs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const enrichedJobs = await scheduleService.getEnrichedScheduledJobs(orgContext);
    res.json(enrichedJobs);
}));

router.get("/scheduled-jobs/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid ID");

    const result = await scheduleService.getJobWithDetails(id, orgContext.organizationId);
    res.json(result);
}));

router.post("/scheduled-jobs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) throw new BadRequestError("No organization context");

    const data = insertScheduledJobSchema.parse(req.body);

    if (data.triggerCredentialId) {
        const hasAccess = await scheduleService.checkCredentialAccess(data.triggerCredentialId, orgContext.organizationId);
        if (!hasAccess) throw new ForbiddenError("You don't have access to this credential");
    }

    const job = await scheduleService.create(data as any, orgContext);
    res.json(job);
}));

router.put("/scheduled-jobs/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const scheduledJobId = parseInt(req.params.id);
    if (isNaN(scheduledJobId)) throw new BadRequestError("Invalid scheduled job ID", { id: req.params.id }, ErrorCode.INVALID_INPUT);

    const scheduledJobData = req.body;

    if (scheduledJobData.triggerType === 'Webhook' && scheduledJobData.triggerCredentialId) {
        const credential = await scheduleService.getWebhookCredential(
            scheduledJobData.triggerCredentialId,
            requireOrgId(orgContext),
        );

        if (!credential) throw new BadRequestError("Webhook credential not found");
        if (credential.type !== "webhook") throw new BadRequestError("Credential must be of type 'webhook'");
    }

    const updated = await scheduleService.update(scheduledJobId, scheduledJobData, orgContext);
    res.json(updated);
}));

router.delete("/scheduled-jobs/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const scheduledJobId = parseInt(req.params.id);

    if (isNaN(scheduledJobId)) throw new BadRequestError("Invalid scheduled job ID", { id: req.params.id }, ErrorCode.INVALID_INPUT);

    await scheduleService.delete(scheduledJobId, orgContext);
    res.status(204).send();
}));

// --- Run Scheduled Job Now ---
router.post("/scheduled-jobs/:id/run", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const scheduledJobId = parseInt(req.params.id);

    if (isNaN(scheduledJobId)) throw new BadRequestError("Invalid scheduled job ID", { id: req.params.id }, ErrorCode.INVALID_INPUT);

    const scheduledJob = await scheduleService.getById(scheduledJobId, orgContext);
    const result = await scheduleService.runNow(scheduledJobId, orgContext);
    const executionType = scheduledJob.pipelineId ? "pipeline" : "job";

    res.json({
        success: true,
        message: `Scheduled ${executionType} "${scheduledJob.name}" execution started`,
        scheduledJobId,
        executionType,
        triggeredAt: new Date().toISOString(),
        executionId: result.executionId
    });
}));

// --- Execution History ---

router.get("/scheduled-jobs/:id/history", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const scheduledJobId = parseInt(req.params.id);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string;

    if (isNaN(scheduledJobId)) throw new BadRequestError("Invalid scheduled job ID");

    await scheduleService.getById(scheduledJobId, orgContext);

    const result = await scheduleService.getExecutionHistory(orgContext, {
        scheduledJobId,
        limit,
        offset,
        status
    });

    res.json(result);
}));

router.get("/schedule-executions/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const executionId = parseInt(req.params.id);

    if (isNaN(executionId)) throw new BadRequestError("Invalid execution ID");

    const result = await scheduleService.getExecutionHistory(orgContext, { executionId });
    if (!result.data || result.data.length === 0) {
        throw new NotFoundError("Execution record not found");
    }
    res.json(result.data[0]);
}));

router.get("/schedule-executions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const status = req.query.status as string;

    const result = await scheduleService.getExecutionHistory(orgContext, {
        limit,
        status
    });

    res.json(result.data); 
}));

router.get("/schedule-execution-stats", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const days = parseInt(req.query.days as string) || 7;

    const stats = await scheduleService.getExecutionStats(days, orgContext);
    res.json(stats);
}));

export function registerScheduleRoutes(app: any) {
    app.use("/api", router);
}
