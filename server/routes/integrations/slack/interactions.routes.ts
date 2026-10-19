/**
 * Slack Interactions Routes
 * Handles button clicks, modals, and interactive components
 */

import { Router } from "express";
import { slackService } from "@domain/integrations/core/slack.service.js";
import { requireSlackSignature } from "./middleware/slack-auth.middleware.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SlackInteractionRoutes");
const router = Router();

// POST /api/integrations/slack/interaction - Handle button clicks, modals
router.post("/interaction", requireSlackSignature, async (req: any, res) => {
    try {
        // Parse payload (sent as form data)
        const payload = JSON.parse(req.body.payload);

        // Handle interaction
        const result = await slackService.handleInteraction(payload);

        res.json(result);
    } catch (err: any) {
        logger.error("Interaction handling failed:", err);
        res.json({ text: `❌ Error: ${err.message}` });
    }
});

export default router;
