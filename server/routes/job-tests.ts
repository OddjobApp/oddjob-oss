import { validateIdParam } from "@server/utils/api-utils.js";
import { Router, type Request, type Response } from "express";
import { db } from "@server/database_service.js";
import { jobs } from "@shared/schema/index.js";
import { eq, sql, count, avg } from "drizzle-orm";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { jobTestService } from "@domain/jobs/core/job-test.service.js";

import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, NotFoundError, ErrorCode } from "@server/utils/errors.js";


const router = Router();


router.post("/:id/test", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const jobId = validateIdParam(req.params.id);
    const { input, captureInputSchema, captureOutputSchema, config: configOverride, outputDatasetId, outputKnowledgeTopicId, enableKnowledgeStore } = req.body;

    const [jobData] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!jobData) throw new NotFoundError("Job not found", ErrorCode.NOT_FOUND, { jobId });

    // Merge Overrides
    if (configOverride) {
        jobData.config = typeof configOverride === 'string' ? configOverride : JSON.stringify(configOverride);
    }
    if (outputDatasetId !== undefined) jobData.outputDatasetId = outputDatasetId;
    if (outputKnowledgeTopicId !== undefined) jobData.outputKnowledgeTopicId = outputKnowledgeTopicId;
    if (enableKnowledgeStore !== undefined) jobData.enableKnowledgeStore = enableKnowledgeStore;

    let config = typeof jobData.config === 'string' ? JSON.parse(jobData.config) : jobData.config;
    const capture = { captureInput: !!captureInputSchema, captureOutput: !!captureOutputSchema, input };

    let result: any;

    if (jobData.type === "human_approval") {
        await db.update(jobs).set({ lastTestedAt: new Date(), lastTestStatus: "success" }).where(eq(jobs.id, jobId));
        result = { success: true, output: input, metadata: { method: "FORM", status: "Simulated" } };
    } else if (jobData.type === "curl" || jobData.type === "api") {
        result = await jobTestService.testCurlJob(jobData, config, capture);
    } else if (jobData.type === "openapi") {
        result = await jobTestService.testOpenAPIJob(jobData, config, capture);
    } else if (jobData.type === "ai_api_call") {
        result = await jobTestService.testAIAPICallJob(jobData, config, capture);
    } else if (jobData.type === "ai_agent" || jobData.type === "agent_ai") {
        result = await jobTestService.testAIAgentJob(jobData, config, capture);
    } else {
        result = await jobTestService.testGenericJob(jobData, config, capture);
    }

    const outputStats = await jobTestService.saveOutputToDataset(jobData, result);
    if (outputStats && outputStats.stats) {
        result.stats = outputStats.stats;
    }

    return res.json(result);
}));

// GET /api/jobs/:id/schemas
router.get("/:id/schemas", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, validateIdParam(req.params.id))).limit(1);
    if (!job) throw new NotFoundError("Job not found", ErrorCode.NOT_FOUND, { jobId: req.params.id });
    res.json({ inputSchema: job.inputSchema, outputSchema: job.outputSchema });
}));

// POST /api/jobs/:id/schemas
router.post("/:id/schemas", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const jobId = validateIdParam(req.params.id);
    const { inputSchema, outputSchema } = req.body;
    const updates: any = {};
    if (inputSchema) updates.inputSchema = inputSchema;
    if (outputSchema) updates.outputSchema = outputSchema;
    await db.update(jobs).set(updates).where(eq(jobs.id, jobId));
    res.json({ success: true });
}));


// GET /api/jobs/:id/analytics — aggregate run stats for the Performance tab
router.get("/:id/analytics", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const jobId = validateIdParam(req.params.id);
    if (isNaN(jobId)) throw new BadRequestError("Invalid job ID", { jobId: req.params.id }, ErrorCode.INVALID_INPUT);

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) throw new NotFoundError("Job not found", ErrorCode.NOT_FOUND, { jobId });

    // Pull recent executions via the existing service
    const { jobService } = await import("@domain/jobs/job.service.js");
    const executions: any[] = await jobService.getJobExecutions(jobId, 200, {
        organizationId: job.organizationId!,
        userId: (req as any).user?.id || "system",
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: false,
    });

    if (!executions || executions.length === 0) {
        return res.json(null);
    }

    const total = executions.length;
    const successes = executions.filter((e: any) => e.status === "success" || e.status === "completed").length;
    const failures = executions.filter((e: any) => e.status === "failed" || e.status === "error").length;

    const durations = executions
        .filter((e: any) => e.startedAt && (e.completedAt || e.updatedAt))
        .map((e: any) => {
            const start = new Date(e.startedAt).getTime();
            const end = new Date(e.completedAt ?? e.updatedAt).getTime();
            return (end - start) / 1000; // seconds
        });
    const avgDuration = durations.length > 0
        ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length)
        : 0;

    // Aggregate failure reasons
    const failureCounts: Record<string, number> = {};
    for (const e of executions) {
        if ((e.status === "failed" || e.status === "error") && e.error) {
            const reason = String(e.error).slice(0, 80);
            failureCounts[reason] = (failureCounts[reason] ?? 0) + 1;
        }
    }
    const topFailures = Object.entries(failureCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count }));

    // Recent 14 days trend (bucket by day)
    const now = Date.now();
    const dayMs = 86_400_000;
    const trend: Array<{ date: string; success: number; failure: number }> = [];
    for (let i = 13; i >= 0; i--) {
        const dayStart = now - i * dayMs;
        const dayEnd = dayStart + dayMs;
        const dayExecs = executions.filter((e: any) => {
            const t = new Date(e.startedAt ?? e.createdAt).getTime();
            return t >= dayStart && t < dayEnd;
        });
        trend.push({
            date: new Date(dayStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            success: dayExecs.filter((e: any) => e.status === "success" || e.status === "completed").length,
            failure: dayExecs.filter((e: any) => e.status === "failed" || e.status === "error").length,
        });
    }

    return res.json({
        totalExecutions: total,
        successRate: total > 0 ? successes / total : 0,
        avgDuration,
        totalCost: 0, // Token cost tracking not yet implemented at job level
        successCount: successes,
        failureCount: failures,
        topFailures,
        trend,
        recentExecutions: executions.slice(0, 10),
    });
}));


export function registerJobTestRoutes(app: any) {
    app.use("/api/jobs", router);
}

