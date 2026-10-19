
import { Router, Request, Response } from "express";
import { validateIdParam } from "@server/utils/api-utils.js";
import { auditService, reasoningAuditService } from "@domain/audit/index.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { UnauthorizedError } from "@server/utils/errors.js";

export const auditRouter = Router();

auditRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user) {
        throw new UnauthorizedError("Authentication required");
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const results = await auditService.getLogs(user.organizationId, {
        entityType: req.query.entityType as string,
        entityId: req.query.entityId as string,
        userId: req.query.userId as string,
        limit,
        offset
    });

    res.json(results);
}));

// ============================================================================
// REASONING AUDIT ROUTES (Security Hardening)
// ============================================================================

auditRouter.get("/reasoning-audits/:missionRunId", asyncHandler(async (req: Request, res: Response) => {
    const missionRunId = validateIdParam(req.params.missionRunId, 'missionRunId');
    const audits = await reasoningAuditService.getAuditsByRun(missionRunId);
    res.json(audits);
}));

auditRouter.patch("/reasoning-audits/:auditId", asyncHandler(async (req: Request, res: Response) => {
    const auditId = validateIdParam(req.params.auditId, 'auditId');
    const { action, notes, violatedPolicies } = req.body;
    const user = (req as any).user;
    
    await reasoningAuditService.updateStatus(
        auditId, 
        user?.id ? `user:${user.id}` : 'system', 
        action, 
        notes, 
        violatedPolicies
    );
    res.json({ success: true });
}));

