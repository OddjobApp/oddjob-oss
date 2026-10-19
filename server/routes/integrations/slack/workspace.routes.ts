import { validateIdParam } from "@server/utils/api-utils.js";
/**
 * Slack Workspace Management Routes
 * Handles workspace CRUD operations
 */

import { Router } from "express";
import { slackService } from "@domain/integrations/core/slack.service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../../../utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { normalizeSlackWorkspaceSettings } from "@domain/integrations/core/slack-workspace-settings.js";

const logger = createLogger("SlackWorkspaceRoutes");
const router = Router();

// GET /api/integrations/slack/workspaces - List connected workspaces
router.get("/workspaces", requireAuth, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const workspaces = await slackService.listWorkspaces(orgContext.organizationId as number);
        res.json(workspaces);
    } catch (err: any) {
        logger.error("Failed to list workspaces:", err);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/integrations/slack/workspaces/:id - Get workspace details
router.get("/workspaces/:id", requireAuth, async (req: any, res) => {
    try {
        const workspaceId = validateIdParam(req.params.id);
        const workspace = await slackService.getWorkspaceById(workspaceId);
        
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        res.json(workspace);
    } catch (err: any) {
        logger.error("Failed to get workspace:", err);
        res.status(500).json({ message: err.message });
    }
});

// DELETE /api/integrations/slack/workspaces/:id - Disconnect workspace
router.delete("/workspaces/:id", requireAuth, async (req: any, res) => {
    try {
        const workspaceId = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);

        const disconnected = await slackService.disconnectWorkspace(workspaceId, orgContext.organizationId as number);
        if (!disconnected) {
            return res.status(403).json({ message: "Access denied" });
        }

        res.json({ success: true });
    } catch (err: any) {
        logger.error("Failed to disconnect workspace:", err);
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/integrations/slack/workspaces/:id/settings - Update settings
router.put("/workspaces/:id/settings", requireAuth, async (req: any, res) => {
    try {
        const workspaceId = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);

        const updates = normalizeSlackWorkspaceSettings(req.body);
        const updated = await slackService.updateWorkspaceSettings(
            workspaceId,
            orgContext.organizationId as number,
            updates,
        );
        if (!updated) {
            return res.status(403).json({ message: "Access denied" });
        }

        res.json({ success: true });
    } catch (err: any) {
        logger.error("Failed to update workspace settings:", err);
        res.status(err instanceof TypeError ? 400 : 500).json({ message: err.message });
    }
});

export default router;
