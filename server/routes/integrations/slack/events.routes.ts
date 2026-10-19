/**
 * Slack Events Routes
 * Handles Slack Events API (for real-time features)
 */

import { Router } from "express";
import { createLogger } from "@server/utils/logger.js";
import { requireSlackSignature } from "./middleware/slack-auth.middleware.js";

const logger = createLogger("SlackEventRoutes");
const router = Router();

// POST /api/integrations/slack/event - Handle Slack events
router.post("/event", requireSlackSignature, async (req: any, res) => {
    const { type, challenge, event } = req.body;

    // URL verification for initial setup
    if (type === "url_verification") {
        return res.json({ challenge });
    }

    // Acknowledge immediately so Slack doesn't retry, then process in background
    res.status(200).send("OK");

    if (!event) return;

    // Ignore messages the bot itself posted to prevent reply loops
    if (event.bot_id || event.subtype === "bot_message") return;

    // Process event asynchronously
    try {
        const isMention = event.type === "app_mention";
        const isDirectMessage = event.type === "message" && event.channel_type === "im";

        if (isMention || isDirectMessage) {
            logger.info(`Received Slack ${event.type} from user ${event.user} in channel ${event.channel}`);

            const { conversationalBridgeService } = await import(
                "@domain/integrations/conversational-bridge.service.js"
            );
            await conversationalBridgeService.handleInboundMessage({
                platform: "slack",
                teamId: req.body.team_id,
                channelId: event.channel,
                userId: event.user,
                text: event.text || "",
                files: event.files,
                threadTs: event.thread_ts || event.ts,
                timestamp: event.event_ts,
            });
        }
    } catch (err: any) {
        logger.error("Event processing failed:", err.message);
    }
});

export default router;
