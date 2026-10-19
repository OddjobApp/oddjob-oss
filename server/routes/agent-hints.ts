/**
 * Agent Tool Hints Routes
 * CRUD endpoints for managing tool hints that guide the agent
 */
import { Router, type Request, type Response } from "express";
import { validateIdParam } from "@server/utils/api-utils.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { requireAgentDeploymentAccess } from "../middleware/agent-access.js";
import { db } from "@server/database_service.js";
import { agentToolHints } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { getUserOrgContext } from "../utils/auth-context.js";

const router = Router();

// Create tool hint
router.post("/:jobId/tool-hints", requireAuth, requireAgentDeploymentAccess, asyncHandler(async (req: Request, res: Response) => {
    const jobId = validateIdParam(req.params.jobId, 'jobId');
    const orgContext = await getUserOrgContext(req);
    const { promptPattern, pipelineId, toolName, hintText, sourceMessageId } = req.body;

    if (!promptPattern) {
        res.status(400).json({ error: "promptPattern is required" });
        return;
    }

    const [hint] = await db.insert(agentToolHints).values({
        jobId,
        promptPattern,
        pipelineId: pipelineId || null,
        toolName: toolName || null,
        hintText: hintText || null,
        sourceMessageId: sourceMessageId || null,
        createdBy: orgContext.userId || 'system'
    }).returning();

    res.status(201).json(hint);
}));

// List tool hints
router.get("/:jobId/tool-hints", requireAuth, requireAgentDeploymentAccess, asyncHandler(async (req: Request, res: Response) => {
    const jobId = validateIdParam(req.params.jobId, 'jobId');

    const hints = await db.select()
        .from(agentToolHints)
        .where(eq(agentToolHints.jobId, jobId))
        .orderBy(desc(agentToolHints.createdAt));

    res.json({ hints });
}));

// Update tool hint
router.put("/:jobId/tool-hints/:hintId", requireAuth, requireAgentDeploymentAccess, asyncHandler(async (req: Request, res: Response) => {
    const jobId = validateIdParam(req.params.jobId, 'jobId');
    const hintId = validateIdParam(req.params.hintId, 'hintId');
    const { promptPattern, pipelineId, toolName, hintText } = req.body;

    const [updated] = await db.update(agentToolHints)
        .set({
            promptPattern,
            pipelineId: pipelineId || null,
            toolName: toolName || null,
            hintText: hintText || null
        })
        .where(and(
            eq(agentToolHints.id, hintId),
            eq(agentToolHints.jobId, jobId)
        ))
        .returning();

    res.json(updated);
}));

// Delete tool hint
router.delete("/:jobId/tool-hints/:hintId", requireAuth, requireAgentDeploymentAccess, asyncHandler(async (req: Request, res: Response) => {
    const jobId = validateIdParam(req.params.jobId, 'jobId');
    const hintId = validateIdParam(req.params.hintId, 'hintId');

    await db.delete(agentToolHints)
        .where(and(
            eq(agentToolHints.id, hintId),
            eq(agentToolHints.jobId, jobId)
        ));

    res.json({ success: true });
}));

export default router;

