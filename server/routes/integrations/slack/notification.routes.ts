/**
 * Slack Notification Routes
 * Handles manual notifications and history
 */

import { Router } from "express";
import { slackService } from "@domain/integrations/core/slack.service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../../../utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { slackNotifications } from "@shared/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { slackNotificationService } from "@domain/integrations/slack-notification.service.js";

const logger = createLogger("SlackNotificationRoutes");
const router = Router();

// POST /api/integrations/slack/notify - Send manual notification
router.post("/notify", requireAuth, async (req: any, res) => {
    try {
        const { workspaceId, channel, message, blocks } = req.body;
        const orgContext = await getUserOrgContext(req);

        const workspace = await slackService.getWorkspaceById(workspaceId);
        if (!workspace || workspace.organizationId !== orgContext.organizationId) {
            return res.status(403).json({ message: "Access denied" });
        }

        const result = await slackService.sendMessage(workspaceId, {
            channel: channel || workspace.defaultChannel,
            text: message,
            blocks,
        });

        res.json(result);
    } catch (err: any) {
        logger.error("Failed to send notification:", err);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/integrations/slack/notifications - List notification history
router.get("/notifications", requireAuth, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const { limit = 50, offset = 0 } = req.query;

        const notifications = await slackNotificationService.listForOrg(
            orgContext.organizationId as number,
            parseInt(limit),
            parseInt(offset),
        );

        res.json(notifications);
    } catch (err: any) {
        logger.error("Failed to get notifications:", err);
        res.status(500).json({ message: err.message });
    }
});

export default router;
