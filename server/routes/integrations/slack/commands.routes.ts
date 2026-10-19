/**
 * Slack Slash Commands Routes
 * Handles /oddjob slash commands
 */

import { Router } from "express";
import { slackService } from "@domain/integrations/core/slack.service.js";
import { requireSlackSignature } from "./middleware/slack-auth.middleware.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SlackCommandRoutes");
const router = Router();

// POST /api/integrations/slack/command - Handle slash commands
router.post("/command", requireSlackSignature, async (req: any, res) => {
    try {
        const payload = req.body;

        // Handle command
        const result = await slackService.handleCommand(payload);

        // Slack expects immediate response
        res.json(result);
    } catch (err: any) {
        logger.error("Slash command failed:", err);
        res.json({ text: `❌ Error: ${err.message}` });
    }
});

export default router;
