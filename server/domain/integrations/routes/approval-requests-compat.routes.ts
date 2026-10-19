import { Router, type Express, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { validateIdParam } from "@server/utils/api-utils.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { requireOrganizationPermission } from "@server/utils/organization-permissions.js";
import { cacheService } from "@domain/cache/cache.service.js";
import { approvalService } from "../core/approval.service.js";
import { toBlockApprovalRequest } from "../core/approval-request-adapter.js";

/**
 * /api/approval-requests: the path PlatformHILApprovalBlock calls.
 *
 * Nothing ever served it, so the block showed an HTTP error everywhere, including
 * inside apps already built with a copy of the block. These routes serve it from
 * the same approvalService and permission as /api/approvals, so fixing the server
 * fixes every copy without rebuilding apps.
 */
const router = Router();

router.get("/", requireAuth, asyncHandler(async (req: any, res: Response) => {
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);

    // approvalService only lists pending requests. "all" is served as pending;
    // approved/rejected get an empty list rather than pending rows mislabelled.
    if (status !== "pending" && status !== "all") {
        return res.json([]);
    }

    const orgContext = await getUserOrgContext(req);
    const rows = await approvalService.listPending(req.user.id, req.user.email, { ...req.user.adminRole, organizationId: orgContext.organizationId });
    res.json(rows.slice(0, limit).map(toBlockApprovalRequest));
}));

for (const [verb, decision] of [["approve", "approved"], ["reject", "rejected"]] as const) {
    router.post(
        `/:id/${verb}`,
        requireAuth,
        requireOrganizationPermission("mission:approve"),
        asyncHandler(async (req: any, res: Response) => {
            const requestId = validateIdParam(req.params.id, "approval ID");
            const comments = typeof req.body?.comment === "string" && req.body.comment.trim() ? req.body.comment : undefined;

            const result = await approvalService.processDecision(
                requestId,
                { decision, comments },
                req.user.id,
                req.user.email,
                req.user.adminRole,
            );

            const orgContext = await getUserOrgContext(req);
            if (orgContext.organizationId) {
                await cacheService.invalidate(`approval:*:org:${orgContext.organizationId}:*`);
                await cacheService.invalidateByTag(`org:${orgContext.organizationId}`);
            }

            res.json({ message: "Decision recorded", ...result });
        }),
    );
}

export function registerApprovalRequestsCompatRoutes(app: Express) {
    app.use("/api/approval-requests", router);
}
