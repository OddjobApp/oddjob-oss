import { Router, type Request, type Response } from "express";
import { validateIdParam } from "@server/utils/api-utils.js";
import { db } from "@server/database_service.js";
import { snapshots, users, pipelineStepExecutions } from "@shared/schema/index.js";
import { eq, desc, and, or, isNull } from "drizzle-orm";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, NotFoundError, ForbiddenError, ValidationError, ErrorCode } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const router = Router();
const logger = createLogger('Snapshots');

// List snapshots for an entity
router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const { entityType, entityId, jobId } = req.query;

    let query = db.select().from(snapshots).$dynamic();
    const conditions = [];

    if (!isSuperAdmin && organizationId) {
        conditions.push(
            or(
                eq(snapshots.organizationId, organizationId),
                isNull(snapshots.organizationId)
            )
        );
    }

    if (entityType) {
        conditions.push(eq(snapshots.entityType, String(entityType)));
    }
    if (entityId) {
        conditions.push(eq(snapshots.entityId, parseInt(String(entityId), 10)));
    }
    if (jobId) {
        conditions.push(eq(snapshots.jobId, parseInt(String(jobId), 10)));
    }

    if (conditions.length > 0) {
        query = query.where(and(...conditions));
    }

    const results = await query.orderBy(desc(snapshots.createdAt)).limit(100);

    logger.debug('Listed snapshots', {
        correlationId: req.correlationId,
        count: results.length,
        entityType,
        entityId,
    });

    res.json(results);
}));

// Create a snapshot
router.post("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await getUserOrgContext(req);
    const userId = (req.session as any)?.userId;
    const [user] = userId ? await db.select().from(users).where(eq(users.id, userId)).limit(1) : [null];
    const { entityType, entityId, jobId, data, label, description, isPrimary } = req.body;

    if (!entityType || !entityId || !data) {
        throw new ValidationError("entityType, entityId, and data are required", {
            missing: [
                !entityType && 'entityType',
                !entityId && 'entityId',
                !data && 'data'
            ].filter(Boolean)
        });
    }

    // Compute hash
    const crypto = await import('crypto');
    const hash = crypto.default.createHash('sha256').update(JSON.stringify(data)).digest('hex');

    // If setting as primary, unset any existing primary for this entity
    if (isPrimary) {
        await db
            .update(snapshots)
            .set({ isPrimary: false })
            .where(
                and(
                    eq(snapshots.entityType, entityType),
                    eq(snapshots.entityId, entityId)
                )
            );
    }

    const [snapshot] = await db
        .insert(snapshots)
        .values({
            entityType,
            entityId,
            jobId: jobId || null,
            data,
            hash,
            label: label || null,
            description: description || null,
            isPrimary: isPrimary || false,
            organizationId: organizationId || null,
            createdBy: user?.id || 'system',
        })
        .returning();

    logger.info('Snapshot created', {
        correlationId: req.correlationId,
        snapshotId: snapshot.id,
        entityType,
        entityId,
    });

    res.status(201).json(snapshot);
}));

// Set a snapshot as primary
router.patch("/:id/primary", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const snapshotId = validateIdParam(req.params.id);

    if (isNaN(snapshotId)) {
        throw new BadRequestError("Invalid snapshot ID", { snapshotId: req.params.id }, ErrorCode.INVALID_INPUT);
    }

    // Get the snapshot
    const [snapshot] = await db
        .select()
        .from(snapshots)
        .where(eq(snapshots.id, snapshotId))
        .limit(1);

    if (!snapshot) {
        throw new NotFoundError("Snapshot not found", ErrorCode.NOT_FOUND, { snapshotId });
    }

    if (!isSuperAdmin && snapshot.organizationId !== organizationId) {
        throw new ForbiddenError("Access denied to this snapshot");
    }

    // Unset other primaries for same entity
    await db
        .update(snapshots)
        .set({ isPrimary: false })
        .where(
            and(
                eq(snapshots.entityType, snapshot.entityType),
                eq(snapshots.entityId, snapshot.entityId)
            )
        );

    // Set this one as primary
    const [updated] = await db
        .update(snapshots)
        .set({ isPrimary: true })
        .where(eq(snapshots.id, snapshotId))
        .returning();

    logger.info('Snapshot set as primary', {
        correlationId: req.correlationId,
        snapshotId,
        entityType: snapshot.entityType,
        entityId: snapshot.entityId,
    });

    res.json(updated);
}));

// Delete a snapshot
router.delete("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const snapshotId = validateIdParam(req.params.id);

    if (isNaN(snapshotId)) {
        throw new BadRequestError("Invalid snapshot ID", { snapshotId: req.params.id }, ErrorCode.INVALID_INPUT);
    }

    // Get the snapshot first
    const [snapshot] = await db
        .select()
        .from(snapshots)
        .where(eq(snapshots.id, snapshotId))
        .limit(1);

    if (!snapshot) {
        throw new NotFoundError("Snapshot not found", ErrorCode.NOT_FOUND, { snapshotId });
    }

    if (!isSuperAdmin && snapshot.organizationId !== organizationId) {
        throw new ForbiddenError("Access denied to this snapshot");
    }

    await db.delete(snapshots).where(eq(snapshots.id, snapshotId));

    logger.info('Snapshot deleted', {
        correlationId: req.correlationId,
        snapshotId,
    });

    res.json({ message: "Snapshot deleted successfully" });
}));

// Preview diff between two states
router.post("/diff/preview", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { baseline, current, ignorePaths } = req.body;

    if (baseline === undefined || current === undefined) {
        throw new ValidationError("baseline and current are required", {
            missing: [
                baseline === undefined && 'baseline',
                current === undefined && 'current'
            ].filter(Boolean)
        });
    }

    const { computeDiff } = await import('@domain/core/infrastructure/diff-service.js');
    const diffResult = computeDiff(baseline, current, {
        ignorePaths: ignorePaths || ['timestamp', 'createdAt', 'updatedAt'],
    });

    logger.debug('Diff computed', { correlationId: req.correlationId });
    res.json(diffResult);
}));

// Get diff for a specific step execution
router.get("/diff/step-execution/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const stepExecutionId = validateIdParam(req.params.id);

    if (isNaN(stepExecutionId)) {
        throw new BadRequestError("Invalid step execution ID", { stepExecutionId: req.params.id }, ErrorCode.INVALID_INPUT);
    }

    // Get the step execution
    const [stepExec] = await db
        .select()
        .from(pipelineStepExecutions)
        .where(eq(pipelineStepExecutions.id, stepExecutionId))
        .limit(1);

    if (!stepExec) {
        throw new NotFoundError("Step execution not found", ErrorCode.EXECUTION_NOT_FOUND, { stepExecutionId });
    }

    // Get the previous successful execution of the same job
    const [previousExec] = await db
        .select()
        .from(pipelineStepExecutions)
        .where(
            and(
                eq(pipelineStepExecutions.jobId, stepExec.jobId!),
                eq(pipelineStepExecutions.status, 'success')
            )
        )
        .orderBy(desc(pipelineStepExecutions.completedAt))
        .limit(1)
        .offset(1); // Skip the current one

    if (!previousExec) {
        return res.json({
            hasChanges: false,
            message: "No previous execution to compare against",
            current: stepExec.output,
            baseline: null,
        });
    }

    // Compute diff
    const { computeDiff } = await import('@domain/core/infrastructure/diff-service.js');

    let baseline: any, current: any;
    try {
        baseline = JSON.parse(previousExec.output || '{}');
    } catch {
        baseline = previousExec.output;
    }
    try {
        current = JSON.parse(stepExec.output || '{}');
    } catch {
        current = stepExec.output;
    }

    const diffResult = computeDiff(baseline, current, {
        ignorePaths: ['timestamp', 'createdAt', 'updatedAt'],
    });

    logger.debug('Step execution diff computed', {
        correlationId: req.correlationId,
        stepExecutionId,
        baselineExecutionId: previousExec.id,
    });

    res.json({
        ...diffResult,
        baselineExecutionId: previousExec.id,
        currentExecutionId: stepExec.id,
    });
}));

export function registerSnapshotRoutes(app: any) {
    app.use("/api/snapshots", router);
    // Also mount diff routes at /api/diff
    app.post("/api/diff/preview", router);
    app.get("/api/diff/step-execution/:id", router);
}

