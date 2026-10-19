import { validateIdParam } from "@server/utils/api-utils.js";
// @ts-nocheck

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { monitoringService, type ExecutionIdKind } from "@domain/core/infrastructure/monitoring.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, ErrorCode, ForbiddenError } from "@server/utils/errors.js";
import { alertMissionBridge } from "@domain/core/infrastructure/alert-mission-bridge.js";
import { db } from "@server/database_service.js";
import { rescueSessions, alerts } from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireOrgId } from "../utils/auth-context.js";

const router = Router();

// GET /api/executions - List executions
router.get("/executions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const executions = await monitoringService.listExecutions(orgContext);
    res.json(executions);
}));

// GET /api/executions/:id - Get specific execution
router.get("/executions/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const executionId = validateIdParam(req.params.id);

    if (isNaN(executionId)) throw new BadRequestError("Invalid execution ID", { id: req.params.id }, ErrorCode.INVALID_INPUT);

    // ?kind=step|agent-step selects which table to resolve against. Omitted, the
    // service keeps its legacy try-pipeline-then-agent behaviour, which returns the
    // wrong record for an id present in both.
    const kindParam = typeof req.query.kind === "string" ? (req.query.kind as ExecutionIdKind) : undefined;
    if (kindParam && kindParam !== "step" && kindParam !== "agent-step") {
        throw new BadRequestError("Invalid kind", { kind: kindParam }, ErrorCode.INVALID_INPUT);
    }

    const execution = await monitoringService.getExecution(executionId, orgContext, kindParam);
    res.json(execution);
}));

// GET /api/alerts - List alerts
router.get("/alerts", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    // Note: Originally this route was public/unprotected in some contexts or had less strict checking.
    // Now enforcing auth and org context via service.
    const alerts = await monitoringService.listAlerts(orgContext);
    res.json(alerts);
}));

// POST /api/alerts/:id/acknowledge - Acknowledge alert
router.post("/alerts/:id/acknowledge", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const alertId = validateIdParam(req.params.id);
    if (isNaN(alertId)) throw new BadRequestError("Invalid alert ID");

    const result = await monitoringService.acknowledgeAlert(alertId, orgContext);
    res.json(result);
}));

// DELETE /api/alerts/clear-acknowledged - Clear acknowledged alerts
router.delete("/alerts/clear-acknowledged", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const result = await monitoringService.clearAcknowledgedAlerts(orgContext);
    res.json(result);
}));

// POST /api/pipelines/:id/feedback - Reranker feedback
router.post("/pipelines/:id/feedback", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { executionId, stepId, documentIndex, feedbackType } = req.body;

    if (!executionId || !feedbackType) throw new BadRequestError("Missing required fields");

    const result = await monitoringService.recordFeedback(executionId, stepId, documentIndex, feedbackType);
    res.json({ ...result, message: "Feedback recorded" });
}));

// GET /api/health - System Health Check (New)
router.get("/health", asyncHandler(async (req: Request, res: Response) => {
    const health = await monitoringService.getSystemHealth();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
}));

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-RESCUE CONFIGURATION ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/alerts/auto-rescue/config - Get auto-rescue configuration
router.get("/alerts/auto-rescue/config", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    
    // Return current configuration (stored in memory for now, can be moved to DB later)
    res.json({
        enabled: alertMissionBridge.config.autoApprove !== undefined ? true : alertMissionBridge.config.autoApprove !== undefined,
        autoRescueCategories: alertMissionBridge.config.autoRescueCategories,
        minSeverity: alertMissionBridge.config.minSeverity,
        cooldownMinutes: Math.round(alertMissionBridge.config.cooldownMs / 60000),
        maxPerHour: alertMissionBridge.config.maxPerHour,
        autoApprove: alertMissionBridge.config.autoApprove,
    });
}));

// POST /api/alerts/auto-rescue/config - Update auto-rescue configuration
router.post("/alerts/auto-rescue/config", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const { enabled, autoRescueCategories, minSeverity, cooldownMinutes, maxPerHour, autoApprove } = req.body;

    // Validate input
    if (!Array.isArray(autoRescueCategories)) {
        throw new BadRequestError("autoRescueCategories must be an array");
    }
    if (!['error', 'critical'].includes(minSeverity)) {
        throw new BadRequestError("minSeverity must be 'error' or 'critical'");
    }
    if (typeof cooldownMinutes !== 'number' || cooldownMinutes < 1 || cooldownMinutes > 60) {
        throw new BadRequestError("cooldownMinutes must be between 1 and 60");
    }
    if (typeof maxPerHour !== 'number' || maxPerHour < 1 || maxPerHour > 50) {
        throw new BadRequestError("maxPerHour must be between 1 and 50");
    }

    // Update configuration
    alertMissionBridge.initialize({
        autoRescueCategories,
        minSeverity,
        cooldownMs: cooldownMinutes * 60 * 1000,
        maxPerHour,
        autoApprove: !!autoApprove,
    });

    res.json({
        success: true,
        message: "Auto-rescue configuration updated",
        config: {
            enabled,
            autoRescueCategories,
            minSeverity,
            cooldownMinutes,
            maxPerHour,
            autoApprove: !!autoApprove,
        },
    });
}));

// GET /api/alerts/auto-rescue/stats - Get auto-rescue statistics
router.get("/alerts/auto-rescue/stats", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    const stats = await alertMissionBridge.getStats(orgId);
    res.json(stats);
}));

// GET /api/alerts/auto-rescue/history - Get auto-rescue history
router.get("/alerts/auto-rescue/history", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    
    // Fetch recent auto-created rescue sessions with linked alerts
    const sessions = await db
        .select({
            session: rescueSessions,
            alert: alerts,
        })
        .from(rescueSessions)
        .leftJoin(alerts, sql`${alerts.id} = ${rescueSessions.metadata}->>'alertId'`)
        .where(
            and(
                eq(rescueSessions.organizationId, orgId),
                sql`${rescueSessions.source} = 'alert_auto_rescue'`
            )
        )
        .orderBy(desc(rescueSessions.createdAt))
        .limit(50);

    const history = sessions.map(({ session, alert }) => ({
        id: session.id,
        alertId: alert?.id,
        category: session.serviceType,
        severity: session.severity === 'P1' ? 'critical' : session.severity === 'P2' ? 'error' : 'warning',
        message: alert?.message || session.failureContext,
        rescueSessionId: session.id,
        missionId: session.missionId,
        status: session.status,
        createdAt: session.createdAt,
        resolvedAt: session.completedAt,
    }));

    res.json(history);
}));

// POST /api/alerts/:id/trigger-rescue - Manually trigger rescue for an alert
router.post("/alerts/:id/trigger-rescue", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const alertId = validateIdParam(req.params.id);
    if (isNaN(alertId)) throw new BadRequestError("Invalid alert ID");

    const userId = (req as any).user?.id || 'unknown';
    const result = await alertMissionBridge.manualTrigger(alertId, userId);

    if (!result.success) {
        throw new BadRequestError(result.error || "Failed to trigger rescue");
    }

    res.json({
        success: true,
        rescueSessionId: result.rescueSessionId,
        message: "Rescue mission triggered successfully",
    });
}));

export function registerMonitoringRoutes(app: any) {
    app.use("/api", router);
}

