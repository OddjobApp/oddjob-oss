import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { attentionQueueService } from "../core/attention-queue.service.js";

const router = Router();

router.get("/attention", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    // requireOrgId, not `|| 1`: OrgContext.organizationId is number | null, and
    // defaulting a null org to 1 serves org 1's attention queue to the caller.
    const organizationId = requireOrgId(orgContext);
    const requestedLimit = Number.parseInt(String(req.query.limit ?? "20"), 10);
    const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(requestedLimit, 100))
        : 20;

    res.json(await attentionQueueService.list(organizationId, limit));
}));

export default router;

