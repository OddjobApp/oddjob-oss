import { validateIdParam } from "@server/utils/api-utils.js";

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, NotFoundError, ForbiddenError } from "@server/utils/errors.js";
import { errorAlertService } from "@domain/diagnostics/index.js";
import { approvalService } from "@domain/integrations/core/approval.service.js";

const router = Router();

// GET /api/alert-configs - List alert configurations
router.get("/alert-configs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const configs = await errorAlertService.getConfigs(orgContext.organizationId || undefined);
    // Frontend expects { configs: [] } structure based on current code
    res.json({ configs });
}));

// POST /api/alert-configs - Create alert configuration
router.post("/alert-configs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const { name, errorCategories, minOccurrences, timeWindowMinutes, notifyVia, emailRecipients, slackWebhookUrl, slackChannel, pipelineIds, cooldownMinutes, enabled } = req.body;

    if (!name) throw new BadRequestError("Name is required");

    const id = await errorAlertService.createConfig({
        organizationId: orgContext.organizationId,
        name,
        enabled: enabled ?? true,
        errorCategories: errorCategories || [],
        minOccurrences: minOccurrences || 3,
        timeWindowMinutes: timeWindowMinutes || 60,
        pipelineIds: pipelineIds || null,
        notifyVia: notifyVia || [],
        slackWebhookUrl: slackWebhookUrl || null,
        slackChannel: slackChannel || null,
        emailRecipients: emailRecipients || [],
        cooldownMinutes: cooldownMinutes || 30
    });

    res.status(201).json({ id, message: "Alert configuration created" });
}));

// PUT /api/alert-configs/:id - Update alert configuration
router.put("/alert-configs/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid ID");

    const orgContext = await getUserOrgContext(req);

    // Scope the write to the caller's organization. Without this any authenticated
    // user could modify another tenant's alert config by guessing its id — the
    // previous comment here acknowledged the check was missing.
    const updated = await errorAlertService.updateConfig(
        id,
        req.body,
        orgContext.organizationId || undefined,
    );
    if (!updated) throw new NotFoundError("Alert configuration not found");

    res.json({ success: true, message: "Alert configuration updated" });
}));

// DELETE /api/alert-configs/:id - Delete alert configuration
router.delete("/alert-configs/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid ID");

    const orgContext = await getUserOrgContext(req);
    const removed = await errorAlertService.deleteConfig(id, orgContext.organizationId || undefined);
    if (!removed) throw new NotFoundError("Alert configuration not found");

    res.json({ success: true, message: "Alert configuration deleted" });
}));

// GET /api/alert-configs/history - List triggered alerts history
router.get("/alert-configs/history", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const configId = req.query.configId ? parseInt(req.query.configId as string) : undefined;

    const history = await errorAlertService.getAlertHistory(configId, orgContext.organizationId || undefined);
    res.json(history);
}));

// GET /api/mobile/alerts - List pending approvals as mobile notifications
router.get("/mobile/alerts", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const userId = orgContext.userId;
    const email = (req as any).user?.email || "";

    // Get pending approvals
    const adminRole = (req as any).user?.adminRole;
    const pendingApprovals = await approvalService.listPending(userId, email, adminRole);

    // Format as mobile notifications
    const notifications = pendingApprovals.map((approval: any, index: number) => ({
        id: approval.id || index,
        title: approval.stepName || approval.modifiedOutput?.tool || approval.modifiedOutput?.description || "Pending Approval",
        message: approval.pipelineName || "Approval request pending review",
        type: "warning" as const,
        timestamp: approval.createdAt || new Date().toISOString(),
        read: false
    }));

    res.json(notifications);
}));

export default router;

