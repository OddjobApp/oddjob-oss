/**
 * Slack OAuth Routes
 * Handles OAuth installation flow
 */

import { Router } from "express";
import { slackService } from "@domain/integrations/core/slack.service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import crypto from "crypto";

const logger = createLogger("SlackOAuthRoutes");
const router = Router();

// GET /api/integrations/slack/install - Get install URL
router.get("/install", requireAuth, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const userId = (req.session as any)?.userId;

        // Encode org+user context in state so callback can recover it
        const statePayload = Buffer.from(JSON.stringify({
            nonce: crypto.randomBytes(16).toString("hex"),
            organizationId: orgContext.organizationId,
            userId,
        })).toString("base64url");

        const installUrl = `https://slack.com/oauth/v2/authorize?` + new URLSearchParams({
            client_id: process.env.SLACK_CLIENT_ID!,
            scope: "chat:write,commands,im:write,channels:read,groups:read,mpim:read",
            user_scope: "",
            state: statePayload,
            redirect_uri: `${process.env.APP_URL}/api/integrations/slack/callback`,
        });

        res.json({ installUrl, state: statePayload });
    } catch (err: any) {
        logger.error("Failed to generate install URL:", err);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/integrations/slack/callback - OAuth callback
router.get("/callback", async (req: any, res) => {
    const { code, state, error } = req.query;

    if (error) {
        logger.error("Slack OAuth error:", error);
        return res.redirect(`${process.env.APP_URL}/settings/integrations?error=${error}`);
    }

    if (!code || !state) {
        return res.redirect(`${process.env.APP_URL}/settings/integrations?error=no_code`);
    }

    try {
        // Decode org context from state parameter
        let organizationId: number | null = null;
        let userId: number | null = null;
        try {
            const decoded = JSON.parse(Buffer.from(state as string, "base64url").toString("utf8"));
            organizationId = decoded.organizationId ?? null;
            userId = decoded.userId ?? null;
        } catch {
            logger.warn("Could not decode OAuth state, org context unavailable");
        }

        const workspace = await slackService.installWorkspace({
            code: code as string,
            organizationId: organizationId as number,
            installedBy: userId as number,
        });

        res.redirect(`${process.env.APP_URL}/settings/integrations?success=slack_installed&team=${workspace.teamName}`);
    } catch (err: any) {
        logger.error("Slack OAuth callback failed:", err);
        res.redirect(`${process.env.APP_URL}/settings/integrations?error=install_failed`);
    }
});

export default router;
