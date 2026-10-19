
import { Router, Request, Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { chaosToolsService } from "@domain/chaos/chaos-tools.service.js";
import { createLogger } from "@server/utils/logger.js";

const router = Router();
const logger = createLogger("ChaosRoute");

// All chaos routes require authentication
router.use(requireAuth);

/**
 * GET /api/chaos/status
 * Returns current chaos state for the authenticated org: active latency flags,
 * open incidents, and whether chaos mode is enabled.
 */
router.get("/status", asyncHandler(async (req: Request, res: Response) => {
    const orgId = (req as any).user?.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization context required" });

    const result = await chaosToolsService.query_metrics({ orgId, lookbackMinutes: 60, limit: 5 });
    res.json({
        enabled: process.env.CHAOS_ENABLED === "true",
        orgId,
        ...result,
    });
}));

/**
 * POST /api/chaos/drills/:tool
 * Executes a named chaos tool for the authenticated org.
 *
 * Supported tools:
 *   set_latency_flag       — Inject artificial latency into staging DB
 *   reset_latency_flag     — Remove latency injection
 *   trigger_monitoring_incident — Create a simulated incident + Slack alert
 *   resolve_pagerduty_alert — Resolve the active incident
 *   run_http_latency_checks — Measure HTTP response latency
 *   query_metrics          — Query active chaos state + recent events
 */
router.post("/drills/:tool", asyncHandler(async (req: Request, res: Response) => {
    const orgId = (req as any).user?.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization context required" });

    const { tool } = req.params;
    const validTools = Object.keys(chaosToolsService).filter(k => k !== "getToolDefinitions");

    if (!validTools.includes(tool)) {
        return res.status(400).json({
            error: `Unknown chaos tool: "${tool}"`,
            availableTools: validTools,
        });
    }

    logger.info(`[Chaos] Drill triggered: tool=${tool}, orgId=${orgId}, user=${(req as any).user?.id}`);

    const toolFn = (chaosToolsService as any)[tool];
    const result = await toolFn({ orgId, ...req.body });

    res.json(result);
}));

/**
 * GET /api/chaos/tools
 * Returns the MCP tool definitions for all available chaos tools.
 */
router.get("/tools", asyncHandler(async (_req: Request, res: Response) => {
    res.json({
        tools: chaosToolsService.getToolDefinitions(),
        chaosEnabled: process.env.CHAOS_ENABLED === "true",
    });
}));

export default router;
