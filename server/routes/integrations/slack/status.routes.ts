/**
 * Slack Status Routes
 * Provides health and connection status for Slack integration
 */

import { Router } from "express";
import { SlackSocketListener } from "@domain/integrations/slack-socket-listener.js";
import { slackService } from "@domain/integrations/core/slack.service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../../../utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SlackStatusRoutes");
const router = Router();

// GET /api/integrations/slack/status - Get overall Slack integration status
router.get("/", requireAuth, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        
        // Get workspaces for this org
        const workspaces = orgContext.organizationId 
            ? await slackService.listWorkspaces(orgContext.organizationId)
            : [];
        
        // Get socket mode health
        const socketHealth = SlackSocketListener.getHealthStatus();
        
        // Get Python Hub health
        let pythonHubHealth: any = { status: "unknown" };
        try {
            const { pythonBridge } = await import("@domain/integrations/core/gateway/python.gateway.js");
            const result = await pythonBridge.execute(
                "check_hub_health",
                "/api/v1/notifications/health",
                "GET"
            );
            // In success_response, data is in result.body.data
            pythonHubHealth = result.body?.data || { status: "healthy" };
        } catch (err) {
            pythonHubHealth = { status: "unreachable" };
        }
        
        res.json({
            status: workspaces.length > 0 ? "connected" : "disconnected",
            workspaces: workspaces.map(w => ({
                id: w.id,
                teamName: w.teamName,
                teamId: w.teamId,
                isActive: w.isActive,
                installedAt: w.installedAt,
                defaultChannel: w.defaultChannel
            })),
            socketMode: socketHealth,
            pythonHub: pythonHubHealth,
            timestamp: new Date().toISOString()
        });
    } catch (err: any) {
        logger.error("Failed to get Slack status:", err);
        res.status(500).json({ message: err.message });
    }
});

export default router;
