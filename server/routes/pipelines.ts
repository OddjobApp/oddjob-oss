import { Router, type Request, type Response } from "express";
import { getUserOrgContext } from "../utils/auth-context.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, ForbiddenError, ValidationError, PipelineExecutionError, ErrorCode, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { pipelineService } from "../domain/pipeline/core/pipeline.service.js";
import { AppDeploymentService } from "../domain/apps/app-deployment.service.js";
import { CapabilityDiscoveryService } from "@domain/core/infrastructure/capability-discovery.service.js";
import { InputValidationService } from "@domain/core/input-validation.service.js";
import { validateIdParam, parseNumericParam } from "../utils/api-utils.js";
import { db } from "@server/database_service.js";
import { and, eq, sql, desc, asc, gte } from "drizzle-orm";
import { pipelineTriggerLogs, driftScores, pipelineSteps } from "@shared/schema/index.js";
import { predictiveAnalyticsService } from "../domain/pipeline/core/predictive-analytics.service.js";


import { getRedisClient } from "../domain/core/infrastructure/redis/redis-client.js";
import { invalidateCachePattern } from "../utils/cache-utils.js";

const logger = createLogger('Pipelines');
const router = Router();
const redis = getRedisClient();

// ACDD canvas hook & Cache Invalidation: after any successful pipeline/canvas SAVE
// or deletion under /pipelines (the pipeline itself, app-steps, or input/output params),
// enqueue a code→docs capability sync and invalidate Redis pipeline list cache.
router.use((req: Request, res: Response, next) => {
    const isSave =
        (req.method === "PUT" || req.method === "PATCH" || req.method === "POST" || req.method === "DELETE") &&
        (req.path === "/pipelines" || /^\/pipelines\/\d+(\/|$)/.test(req.path));
    if (isSave) {
        res.on("finish", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                // 1. Invalidate cache
                getUserOrgContext(req).then((orgContext) => {
                    const orgId = orgContext.organizationId || 0;
                    invalidateCachePattern(`cache:pipelines:org:${orgId}:*`).catch(() => {});
                }).catch(() => {});

                // 2. ACDD Sync Hook
                const match = req.path.match(/^\/pipelines\/(\d+)/);
                if (match) {
                    const pipelineId = Number(match[1]);
                    if (Number.isInteger(pipelineId)) {
                        void import("../domain/capabilities/infrastructure/capability-canvas.js")
                            .then((m) => m.onPipelineSaved(pipelineId))
                            .catch(() => { /* trigger failure must not affect the request */ });
                    }
                }
            }
        });
    }
    next();
});

// ============================================================================
// DISCOVERY
// ============================================================================

router.get("/pipelines/capabilities", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const ids = (req.query.ids as string || "").split(",").map(id => parseInt(id)).filter(id => !isNaN(id));
    if (ids.length === 0) return res.json([]);

    const orgContext = await getUserOrgContext(req);
    const capabilities = await CapabilityDiscoveryService.discoverCapabilities(ids, orgContext.organizationId || 0);
    res.json(capabilities);
}));

// ============================================================================
// PIPELINES
// ============================================================================

router.get("/pipelines", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = orgContext.organizationId || 0;
    const includeInactive = req.query.includeDrafts === 'true';

    const cacheKey = `cache:pipelines:org:${orgId}:includeInactive:${includeInactive}`;
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(JSON.parse(cached));
        }
    } catch (e: any) {
        logger.warn(`[Pipelines Cache] Read error: ${e.message}`);
    }

    const allPipelines = await pipelineService.list(orgContext, {
        includeInactive
    });

    try {
        await redis.setex(cacheKey, 30, JSON.stringify(allPipelines));
    } catch (e: any) {
        logger.warn(`[Pipelines Cache] Write error: ${e.message}`);
    }

    res.json(allPipelines);
}));

router.post("/pipelines", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const pipeline = await pipelineService.create(req.body, orgContext);
    // ACDD canvas hook (create). Fire-and-forget, env-gated.
    void import("../domain/capabilities/infrastructure/capability-canvas.js")
        .then((m) => m.onPipelineSaved((pipeline as any).id))
        .catch(() => { /* trigger failure must not affect the request */ });
    res.status(201).json(pipeline);
}));

router.post("/pipelines/:id/app-steps", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);
    await pipelineService.getById(pipelineId, orgContext);

    const deploymentId = Number(req.body.deploymentId ?? req.body.appDeploymentId);
    if (!Number.isInteger(deploymentId) || deploymentId <= 0) {
        throw new BadRequestError("deploymentId is required");
    }

    const { deployment, app, job } = await AppDeploymentService.ensurePipelineRunnableJob(deploymentId, orgContext);
    const currentSteps = await db
        .select({ order: pipelineSteps.order })
        .from(pipelineSteps)
        .where(eq(pipelineSteps.pipelineId, pipelineId))
        .orderBy(asc(pipelineSteps.order));

    const requestedOrder = req.body.order === undefined ? currentSteps.length : Number(req.body.order);
    if (!Number.isInteger(requestedOrder)) {
        throw new BadRequestError("order must be an integer when provided");
    }

    const insertOrder = Math.max(0, Math.min(requestedOrder, currentSteps.length));
    const defaultOutputName = (deployment.publicSlug || app.slug || "app")
        .replace(/[^a-zA-Z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();
    const outputName = typeof req.body.outputName === "string" && req.body.outputName.trim()
        ? req.body.outputName.trim()
        : defaultOutputName || null;

    const [step] = await db.transaction(async (tx) => {
        await tx
            .update(pipelineSteps)
            .set({
                order: sql`${pipelineSteps.order} + 1`,
                updatedAt: new Date(),
            })
            .where(and(
                eq(pipelineSteps.pipelineId, pipelineId),
                gte(pipelineSteps.order, insertOrder)
            ));

        return await tx
            .insert(pipelineSteps)
            .values({
                pipelineId,
                jobId: job.id,
                order: insertOrder,
                outputName,
            })
            .returning();
    });

    try {
        await pipelineService.createSnapshot(pipelineId, String(orgContext.userId || "system"), `Added app step: ${app.name}`, orgContext);
    } catch (err) {
        logger.warn("Failed to snapshot app step addition", { error: err, pipelineId });
    }

    res.status(201).json({ step, job, app, deployment });
}));

router.get("/pipelines/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);

    const pipeline = await pipelineService.getEnrichedById(pipelineId, orgContext);
    res.json(pipeline);
}));

router.patch("/pipelines/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);
    const pipeline = await pipelineService.update(pipelineId, req.body, orgContext);
    res.json(pipeline);
}));

router.put("/pipelines/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);
    const pipeline = await pipelineService.update(pipelineId, req.body, orgContext);
    res.json(pipeline);
}));

router.delete("/pipelines/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");

    await pipelineService.delete(pipelineId, orgContext);

    logger.info('Pipeline deleted', { correlationId: req.correlationId, pipelineId });
    res.status(204).send();
}));

// --- Triggers ---

router.get("/pipelines/:id/triggers", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);
    const triggers = await pipelineService.getTriggersByPipelineId(pipelineId, orgContext);
    res.json(triggers);
}));

router.post("/pipelines/:id/triggers", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);
    const trigger = await pipelineService.createTrigger(pipelineId, req.body, orgContext);
    res.status(201).json(trigger);
}));

router.patch("/pipelines/:id/triggers/:triggerId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const triggerId = validateIdParam(req.params.triggerId, "Trigger ID");
    const orgContext = await getUserOrgContext(req);
    const trigger = await pipelineService.updateTrigger(pipelineId, triggerId, req.body, orgContext);
    res.json(trigger);
}));

router.delete("/pipelines/:id/triggers/:triggerId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const triggerId = validateIdParam(req.params.triggerId, "Trigger ID");
    const orgContext = await getUserOrgContext(req);
    await pipelineService.deleteTrigger(pipelineId, triggerId, orgContext);
    res.status(204).send();
}));

router.post("/pipelines/triggers/translate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { prompt } = req.body;
    if (!prompt) throw new BadRequestError("Prompt is required");
    
    const { triggerAiService } = await import("../domain/pipeline/core/trigger-ai.service.js");
    const result = await triggerAiService.translateNaturalLanguage(prompt);
    res.json(result);
}));

router.post("/pipelines/triggers/simulate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { filterCondition, mockEvent } = req.body;
    if (filterCondition === undefined || !mockEvent) {
        throw new BadRequestError("filterCondition and mockEvent are required");
    }
    
    const { evaluateFilterCondition } = await import("../domain/pipeline/core/pipeline-trigger.service.js");
    try {
        const result = evaluateFilterCondition(filterCondition, mockEvent);
        res.json({ success: true, match: result });
    } catch (err: any) {
        res.json({ success: false, error: err.message });
    }
}));

router.get("/pipelines/:id/trigger-logs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);
    
    const logs = await db
        .select()
        .from(pipelineTriggerLogs)
        .where(
            and(
                eq(pipelineTriggerLogs.pipelineId, pipelineId),
                orgContext.organizationId ? eq(pipelineTriggerLogs.organizationId, orgContext.organizationId) : sql`${pipelineTriggerLogs.organizationId} IS NULL`
            )
        )
        .orderBy(desc(pipelineTriggerLogs.createdAt))
        .limit(100);
        
    res.json(logs);
}));

router.post("/pipelines/:id/runs/:runId/promote-to-baseline", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const runId = validateIdParam(req.params.runId, "Run ID");
    const orgContext = await getUserOrgContext(req);
    
    const updated = await pipelineService.promoteToBaseline(pipelineId, runId, orgContext);
    res.json(updated);
}));

router.get("/pipelines/:id/drift-scores", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);
    
    const scores = await db
        .select()
        .from(driftScores)
        .where(
            and(
                eq(driftScores.pipelineId, pipelineId),
                orgContext.organizationId ? eq(driftScores.organizationId, orgContext.organizationId) : sql`${driftScores.organizationId} IS NULL`
            )
        )
        .orderBy(driftScores.createdAt);
        
    res.json(scores);
}));

router.get("/pipelines/:id/predictive-drift", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);
    // Verify ownership before returning predictions
    await pipelineService.getById(pipelineId, orgContext);
    const prediction = await predictiveAnalyticsService.predictPipelineDrift(pipelineId);
    res.json(prediction);
}));

// --- Analytics & Stats ---

router.get("/pipelines/:id/cost-analytics", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);

    // Logic moved to service
    const analytics = await pipelineService.getCostAnalytics(pipelineId, orgContext);
    res.json(analytics);
}));

router.get("/pipelines/:id/stats", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);

    const stats = await pipelineService.getStats(pipelineId, orgContext);
    res.json(stats);
}));

router.get("/pipelines/:id/latest-run", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);

    // Logic moved to service
    const result = await pipelineService.getLatestRun(pipelineId, orgContext);
    res.json(result);
}));

// --- Execution Control ---

router.post("/pipelines/:id/execute", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");

    const { startStepId, ttl, workgroupId } = req.body;
    const orgContext = await getUserOrgContext(req);

    logger.info('Starting pipeline execution', { correlationId: req.correlationId, pipelineId, startStepId, ttl });

    const result = await pipelineService.run(pipelineId, {
        startStepId: startStepId ? Number(startStepId) : undefined,
        input: req.body,
        missionId: workgroupId ? Number(workgroupId) : undefined,
    }, orgContext);

    logger.info('Pipeline execution completed', { correlationId: req.correlationId, pipelineId, success: result.success });
    res.status(200).json(result);
}));

router.post("/pipelines/:id/validate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);
    await pipelineService.getById(pipelineId, orgContext);

    const validationResult = await pipelineService.validateGraph(pipelineId);

    if (validationResult.valid) {
        res.json({
            valid: true,
            errors: validationResult.errors,
            warnings: validationResult.warnings,
        });
    } else {
        res.status(400).json({
            valid: false,
            errors: validationResult.errors,
            warnings: validationResult.warnings,
        });
    }
}));

router.post("/pipelines/:id/resume", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const { executionId, fromStepId } = req.body;
    const orgContext = await getUserOrgContext(req);
    if (!executionId) throw new ValidationError("Execution ID is required", { field: 'executionId' });

    const result = await pipelineService.resume(
        executionId,
        fromStepId ? Number(fromStepId) : null,
        orgContext
    );

    if (result.success) {
        res.json({
            success: true,
            executionId: result.executionId,
            message: "Pipeline resumed successfully",
        });
    } else {
        throw new PipelineExecutionError(
            result.error || "Failed to resume pipeline",
            pipelineId,
            executionId,
            { originalResult: result }
        );
    }
}));

router.post("/pipeline-executions/:id/resume-step", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const executionId = validateIdParam(req.params.id, "Execution ID");
    const { stepExecutionId, responses } = req.body;
    const orgContext = await getUserOrgContext(req);

    if (!stepExecutionId) throw new BadRequestError("stepExecutionId is required");

    // Verify the execution belongs to the caller's org before touching anything
    await pipelineService.getExecution(executionId, orgContext);

    // Verify the step execution belongs to this execution (prevents cross-org IDOR)
    const stepExec = await pipelineService.getStepExecution(stepExecutionId);
    if (!stepExec || stepExec.pipelineExecutionId !== executionId) {
        throw new BadRequestError("stepExecutionId does not belong to this execution");
    }

    // Update step execution as success (since we got the HIL)
    await pipelineService.updateStepExecution(stepExecutionId, {
        output: JSON.stringify(responses),
        status: "success",
        completedAt: new Date(),
    });

    // Resume the pipeline with the provided responses in context.data
    const result = await pipelineService.resume(executionId, null, orgContext, responses);
    res.json(result);
}));

// ============================================================================
// EXECUTIONS
// ============================================================================

router.get("/pipelines/:id/executions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);
    const executions = await pipelineService.listExecutionsEnriched(pipelineId, orgContext);
    res.json(executions);
}));

router.get("/pipeline-executions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const limit = parseNumericParam(req.query.limit, 20);
    const missionId = req.query.missionId ? validateIdParam(req.query.missionId, "Mission ID") : undefined;

    // Mission UI compatibility: GET /api/pipelines/executions?missionId=X
    // Already covered if we use the same handler or a new one.
    const executions = await pipelineService.listRecentExecutions(orgContext, {
        limit,
        // If missionId is provided, we might need a separate service method or filter
        // listRecentExecutions accepts options.pipelineId but not missionId yet.
    });
    res.json(executions);
}));

/**
 * Compatibility route for Mission UI: GET /api/pipelines/executions?missionId=X
 */
router.get("/pipelines/executions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const missionId = validateIdParam(req.query.missionId, "Mission ID");
    const orgContext = await getUserOrgContext(req);

    const executions = await pipelineService.listExecutionsByMissionId(missionId, orgContext);
    res.json(executions);
}));

/**
 * Compatibility route for Mission UI: GET /api/pipelines/executions/:id/steps
 */
router.get("/pipelines/executions/:id/steps", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const executionId = validateIdParam(req.params.id, "Execution ID");
    const orgContext = await getUserOrgContext(req);

    const details = await pipelineService.getEnrichedExecutionDetails(executionId, orgContext);
    res.json(details.stepExecutions);
}));

router.get("/pipeline-executions/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const executionId = validateIdParam(req.params.id, "Execution ID");
    const orgContext = await getUserOrgContext(req);
    const executionDetails = await pipelineService.getEnrichedExecutionDetails(executionId, orgContext);
    res.json(executionDetails);
}));

router.get("/pipeline-executions/:id/children", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const executionId = validateIdParam(req.params.id, "Execution ID");
    const orgContext = await getUserOrgContext(req);
    const children = await pipelineService.getChildExecutions(executionId, orgContext);
    res.json(children);
}));

router.post("/pipeline-executions/:id/rerun", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const executionId = validateIdParam(req.params.id, "Execution ID");
    const { startStepId } = req.body;
    const orgContext = await getUserOrgContext(req);

    const result = await pipelineService.rerun(
        executionId,
        startStepId ? Number(startStepId) : null,
        orgContext
    );

    if (result.success) {
        res.json(result);
    } else {
        throw new PipelineExecutionError(
            result.error || "Pipeline rerun failed",
            result.pipelineId || 0,
            result.executionId || executionId,
            { originalResult: result }
        );
    }
}));

router.post("/pipeline-executions/:id/cancel", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const executionId = validateIdParam(req.params.id, "Execution ID");
    const orgContext = await getUserOrgContext(req);

    const result = await pipelineService.cancelExecution(executionId, orgContext);
    res.json(result);
}));

// --- Bulk Operations ---

router.post("/pipelines/bulk/execute", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { runs, options } = req.body;
    const orgContext = await getUserOrgContext(req);

    if (!Array.isArray(runs) || runs.length === 0) {
        throw new ValidationError("Request must include a non-empty 'runs' array");
    }

    if (runs.length > 50) {
        throw new ValidationError("Maximum 50 pipelines can be executed in a single bulk request");
    }

    logger.info("Bulk pipeline execution requested", { count: runs.length, userId: orgContext.userId });

    const results = await pipelineService.runBulk(runs, orgContext, {
        continueOnError: options?.continueOnError ?? true,
        maxConcurrency: options?.maxConcurrency ?? 5,
    });

    const successCount = results.filter(r => r.status === 'success').length;
    res.status(200).json({
        total: runs.length,
        successful: successCount,
        failed: runs.length - successCount,
        results,
    });
}));

router.post("/pipeline-executions/bulk/cancel", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { executionIds } = req.body;
    const orgContext = await getUserOrgContext(req);

    if (!Array.isArray(executionIds) || executionIds.length === 0) {
        throw new ValidationError("Request must include a non-empty 'executionIds' array");
    }

    if (executionIds.length > 100) {
        throw new ValidationError("Maximum 100 executions can be cancelled in a single bulk request");
    }

    logger.info("Bulk cancellation requested", { count: executionIds.length, userId: orgContext.userId });

    const result = await pipelineService.cancelBulk(executionIds, orgContext);

    res.status(200).json(result);
}));

router.get("/pipeline-step-executions/:id/schema-diff", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const stepExecutionId = validateIdParam(req.params.id, "Step Execution ID");
    const orgContext = await getUserOrgContext(req);

    // Verify org ownership before returning schema diff
    const stepExec = await pipelineService.getStepExecution(stepExecutionId);
    if (!stepExec) throw new NotFoundError("Step execution not found");
    const execution = await pipelineService.getExecution(stepExec.pipelineExecutionId, orgContext);
    if (!execution) throw new NotFoundError("Execution not found or access denied");

    const diff = await pipelineService.getRunSchemaDiff(stepExecutionId);
    res.json(diff);
}));

// ============================================================================
// VERSION CONTROL
// ============================================================================

router.post("/pipelines/:id/versions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    // Explicitly ensure userId is present (usually covered by requireAuth/getUserOrgContext)
    if (!orgContext.userId) throw new ForbiddenError("Unauthorized");

    const pipelineId = validateIdParam(req.params.id);
    if (isNaN(pipelineId)) throw new BadRequestError("Invalid pipeline ID", { pipelineId: req.params.id }, ErrorCode.INVALID_INPUT);

    const { description } = req.body;

    // We pass orgContext to createSnapshot. 
    const version = await pipelineService.createSnapshot(pipelineId, orgContext.userId, description, orgContext);

    logger.info('Version snapshot created', { correlationId: req.correlationId, pipelineId, versionId: version.id });
    res.status(201).json({ message: "Version snapshot created", version });
}));

router.get("/pipelines/:id/versions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");

    await pipelineService.getById(pipelineId, orgContext);

    const { getVersions } = await import("@domain/pipeline/core/version.service.js");
    const versions = await getVersions("pipeline", pipelineId);
    res.json(versions);
}));

router.get("/pipelines/:id/versions/:version", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const version = validateIdParam(req.params.version, "Version");

    await pipelineService.getById(pipelineId, orgContext);

    const { getVersion } = await import("@domain/pipeline/core/version.service.js");
    const versionData = await getVersion("pipeline", pipelineId, version);

    if (!versionData) {
        return res.status(404).json({ error: `Version ${version} not found` });
    }
    res.json(versionData);
}));

router.post("/pipelines/:id/rollback/:version", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const userId = (req.session as any)?.userId;
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const version = validateIdParam(req.params.version, "Version");

    await pipelineService.getById(pipelineId, orgContext);

    const { rollbackToVersion } = await import("@domain/pipeline/core/version.service.js");
    const snapshot = await rollbackToVersion("pipeline", pipelineId, version, {
        userId,
        organizationId: orgContext.organizationId ?? undefined,
    });

    logger.info("Pipeline rolled back", { pipelineId, version });
    res.json({ message: `Rolled back to version ${version}`, snapshot });
}));

router.get("/pipelines/:id/versions/diff", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const v1 = validateIdParam(req.query.v1, "v1");
    const v2 = validateIdParam(req.query.v2, "v2");

    await pipelineService.getById(pipelineId, orgContext);

    const { diffVersions } = await import("@domain/pipeline/core/version.service.js");
    const diff = await diffVersions("pipeline", pipelineId, v1, v2);
    res.json(diff);
}));

// ============================================================================
// VARIABLES & LINEAGE
// ============================================================================

router.get("/pipelines/:id/variables", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);
    const stepOrder = req.query.stepOrder ? validateIdParam(req.query.stepOrder, "Step Order") : undefined;

    const variables = await pipelineService.discoverVariables(pipelineId, orgContext, { stepOrder });
    res.json({ variables });
}));

router.get("/pipelines/:id/lineage", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    await pipelineService.getById(pipelineId, orgContext);

    const { lineageService } = await import("@domain/pipeline/core/lineage.service.js");
    const graph = await lineageService.getPipelineLineage(pipelineId);
    res.json(graph);
}));

// --- Input Params ---

router.get("/pipelines/:id/input-params", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);

    // Initial access check 
    await pipelineService.getById(pipelineId, orgContext);

    // Call validation service which merges explicit and implicit (inherited) parameters
    const params = await InputValidationService.getParamsForPipeline(pipelineId);

    res.json(params);
}));

router.post("/pipelines/:id/input-params", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);

    const { insertPipelineInputParamSchema } = await import("@shared/schema/pipelineInputParams.js");
    const validated = insertPipelineInputParamSchema.parse({
        ...req.body,
        pipelineId
    });

    const param = await pipelineService.createInputParam(pipelineId, validated, orgContext);
    res.status(201).json(param);
}));

router.patch("/pipelines/:id/input-params/:paramId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const paramId = validateIdParam(req.params.paramId, "Param ID");
    const orgContext = await getUserOrgContext(req);

    const { updatePipelineInputParamSchema } = await import("@shared/schema/pipelineInputParams.js");
    const validated = updatePipelineInputParamSchema.parse(req.body);

    const updated = await pipelineService.updateInputParam(pipelineId, paramId, validated, orgContext);
    res.json(updated);
}));

router.delete("/pipelines/:id/input-params/:paramId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const paramId = validateIdParam(req.params.paramId, "Param ID");
    const orgContext = await getUserOrgContext(req);

    await pipelineService.deleteInputParam(pipelineId, paramId, orgContext);
    res.status(204).send();
}));

/**
 * Pipeline Output Params Routes
 */
router.get("/pipelines/:id/output-params", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);

    // Initial access check
    await pipelineService.getById(pipelineId, orgContext);

    // Call validation service which merges explicit and implicit (inherited) parameters
    const params = await InputValidationService.getOutputParamsForPipeline(pipelineId);

    res.json(params);
}));

router.post("/pipelines/:id/output-params", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const orgContext = await getUserOrgContext(req);

    const { insertPipelineOutputParamSchema } = await import("@shared/schema/pipelineOutputParams.js");
    const validated = insertPipelineOutputParamSchema.parse({
        ...req.body,
        pipelineId
    });

    const param = await pipelineService.createOutputParam(pipelineId, validated, orgContext);
    res.status(201).json(param);
}));

router.patch("/pipelines/:id/output-params/:paramId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const paramId = validateIdParam(req.params.paramId, "Param ID");
    const orgContext = await getUserOrgContext(req);

    const { updatePipelineOutputParamSchema } = await import("@shared/schema/pipelineOutputParams.js");
    const validated = updatePipelineOutputParamSchema.parse(req.body);

    const updated = await pipelineService.updateOutputParam(pipelineId, paramId, validated, orgContext);
    res.json(updated);
}));

router.delete("/pipelines/:id/output-params/:paramId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const pipelineId = validateIdParam(req.params.id, "Pipeline ID");
    const paramId = validateIdParam(req.params.paramId, "Param ID");
    const orgContext = await getUserOrgContext(req);

    await pipelineService.deleteOutputParam(pipelineId, paramId, orgContext);
    res.status(204).send();
}));

export default router;
