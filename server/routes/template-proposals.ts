import { Router, type Request, type Response } from "express";
import { validateIdParam } from "@server/utils/api-utils.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { templateRevisionService } from "@domain/mission/core/template-revision.service.js";

const router = Router();
const logger = createLogger("TemplateProposalsRoute");

/**
 * Auth model: super-admins see all; org admins see their own org's proposals.
 * Approval/reject restricted to super-admins for now since template config
 * changes affect every future mission spawned from that template.
 */

// GET /api/template-proposals — list pending proposals in the caller's org
router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    if (!organizationId && !isSuperAdmin) {
        throw new BadRequestError("Organization context required");
    }
    const templateId = req.query.templateId ? Number(req.query.templateId) : undefined;
    const limit = req.query.limit ? Math.min(200, Number(req.query.limit)) : 50;
    // Super-admins can pass ?orgId=N to view a specific tenant; otherwise scope to caller's org
    const targetOrg = isSuperAdmin && req.query.orgId
        ? Number(req.query.orgId)
        : organizationId!;
    const items = await templateRevisionService.listPending(targetOrg, { templateId, limit });
    res.json({ items, count: items.length });
}));

// GET /api/template-proposals/:id — single proposal
router.get("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    const id = validateIdParam(req.params.id);
    const targetOrg = isSuperAdmin && req.query.orgId
        ? Number(req.query.orgId)
        : organizationId!;
    if (!targetOrg) throw new BadRequestError("Organization context required");
    const proposal = await templateRevisionService.getById(id, targetOrg);
    if (!proposal) throw new NotFoundError("Proposal not found");
    res.json(proposal);
}));

// POST /api/template-proposals/:id/approve — super-admin only
// Body: { comments?: string, force?: boolean }
// Returns 409 with { missingKeys } if the proposed config drops top-level
// keys from the current config; client should review and re-POST with
// force:true to override.
router.post("/:id/approve", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    if (!isSuperAdmin) throw new ForbiddenError("Only super-admins can approve template revisions");
    const id = validateIdParam(req.params.id);
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) throw new BadRequestError("Authenticated user required");
    const targetOrg = req.query.orgId ? Number(req.query.orgId) : organizationId!;
    if (!targetOrg) throw new BadRequestError("Organization context required");

    const force = req.body?.force === true;
    const result = await templateRevisionService.approve(id, targetOrg, userId, req.body?.comments, force);

    // Distinguish "not found" from "blocked by schema check" so the client
    // can decide whether to surface a confirm-and-retry prompt.
    if (!result.success) {
        if (result.missingKeys && result.missingKeys.length > 0) {
            return res.status(409).json({
                error: "Proposed config drops keys from the current config. Re-submit with force:true to override.",
                missingKeys: result.missingKeys,
            });
        }
        throw new NotFoundError("Proposal not found or not pending");
    }
    logger.info("Template proposal approved", { proposalId: id, templateId: result.templateId, newVersion: result.newVersion, forced: force });
    res.json(result);
}));

// POST /api/template-proposals/:id/reject — super-admin only, requires reason
router.post("/:id/reject", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    if (!isSuperAdmin) throw new ForbiddenError("Only super-admins can reject template revisions");
    const id = validateIdParam(req.params.id);
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) throw new BadRequestError("Authenticated user required");
    const comments = String(req.body?.comments ?? "").trim();
    if (!comments) throw new BadRequestError("Rejection requires a comments string");
    const targetOrg = req.query.orgId ? Number(req.query.orgId) : organizationId!;
    if (!targetOrg) throw new BadRequestError("Organization context required");
    const result = await templateRevisionService.reject(id, targetOrg, userId, comments);
    if (!result.success) throw new NotFoundError("Proposal not found or not pending");
    logger.info("Template proposal rejected", { proposalId: id });
    res.json(result);
}));

export function registerTemplateProposalRoutes(app: any) {
    app.use("/api/template-proposals", router);
}

export default router;
