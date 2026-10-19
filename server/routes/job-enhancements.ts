import { validateIdParam } from "@server/utils/api-utils.js";
/**
 * Job Enhancements Routes
 * API endpoints for request history, token tracking, streaming, health, and HIL
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { requestHistoryService } from "@domain/jobs/core/request-history.service.js";
import { tokenTrackingService } from "@domain/jobs/core/token-tracking.service.js";
import { streamingLogsService } from "@domain/jobs/core/streaming-logs.service.js";
import { jobHealthService } from "@domain/jobs/core/job-health.service.js";
import { hilEnhancementsService } from "@domain/integrations/core/hil-enhancements.service.js";
import { jobTestService } from "@domain/jobs/core/job-test.service.js";

const logger = createLogger("JobEnhancementsRoutes");
const router = Router();

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST HISTORY ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/jobs/:id/history - Get request history for a job
router.get("/jobs/:id/history", requireAuth, async (req: any, res) => {
    const jobId = validateIdParam(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job ID" });
    
    const { limit = 50, offset = 0, onlyReplayable } = req.query;
    
    try {
        const history = await requestHistoryService.getJobHistory(jobId, {
            limit: parseInt(limit as string),
            offset: parseInt(offset as string),
            onlyReplayable: onlyReplayable === "true",
        });
        res.json(history);
    } catch (err: any) {
        logger.error(`Failed to get job history: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/jobs/:id/history/stats - Get request statistics
router.get("/jobs/:id/history/stats", requireAuth, async (req: any, res) => {
    const jobId = validateIdParam(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job ID" });
    
    const days = parseInt(req.query.days as string) || 30;
    
    try {
        const stats = await requestHistoryService.getRequestStats(jobId, days);
        res.json(stats);
    } catch (err: any) {
        logger.error(`Failed to get request stats: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/jobs/:id/replay - Replay a request
router.post("/jobs/:id/replay", requireAuth, async (req: any, res) => {
    const jobId = validateIdParam(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job ID" });
    
    const { requestId, dryRun, modifyParams } = req.body;
    
    try {
        const result = await requestHistoryService.replayRequest(requestId, {
            dryRun,
            modifyParams,
        });
        res.json(result);
    } catch (err: any) {
        logger.error(`Failed to replay request: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/jobs/:id/history/compare - Compare two requests
router.post("/jobs/:id/history/compare", requireAuth, async (req: any, res) => {
    const { requestId1, requestId2 } = req.body;
    
    try {
        const comparison = await requestHistoryService.compareRequests(requestId1, requestId2);
        res.json(comparison);
    } catch (err: any) {
        logger.error(`Failed to compare requests: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TOKEN TRACKING ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/jobs/:id/tokens - Get token usage for a job
router.get("/jobs/:id/tokens", requireAuth, async (req: any, res) => {
    const jobId = validateIdParam(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job ID" });
    
    const days = parseInt(req.query.days as string) || 30;
    
    try {
        const usage = await tokenTrackingService.getJobTokenUsage(jobId, days);
        res.json(usage);
    } catch (err: any) {
        logger.error(`Failed to get token usage: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/org/tokens - Get organization-wide token usage
router.get("/org/tokens", requireAuth, async (req: any, res) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) {
        return res.status(400).json({ message: "Organization ID required" });
    }
    
    const days = parseInt(req.query.days as string) || 30;
    
    try {
        const usage = await tokenTrackingService.getOrgTokenUsage(orgContext.organizationId, days);
        res.json(usage);
    } catch (err: any) {
        logger.error(`Failed to get org token usage: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/tokens/pricing - Get token pricing information
router.get("/tokens/pricing", requireAuth, async (req: any, res) => {
    try {
        const models = tokenTrackingService.getSupportedModels();
        res.json({ models });
    } catch (err: any) {
        logger.error(`Failed to get pricing: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/tokens/estimate - Get cost estimate
router.post("/tokens/estimate", requireAuth, async (req: any, res) => {
    const { model, inputTokens, outputTokens } = req.body;
    
    try {
        const estimate = tokenTrackingService.getCostEstimate(model, inputTokens, outputTokens);
        res.json(estimate);
    } catch (err: any) {
        logger.error(`Failed to estimate cost: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// STREAMING LOGS ROUTES (SSE)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/jobs/:id/stream - SSE endpoint for live logs
router.get("/jobs/:id/stream", requireAuth, asyncHandler(async (req: any, res: any) => {
    const jobId = validateIdParam(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job ID" });
    
    // jobRunId was never validated: a non-numeric value became NaN and was handed
    // to getChannelId, which then queried for a run that cannot exist. This throws
    // BadRequestError, which the error handler renders as a 400 — and it happens
    // before the SSE headers go out, after which the status can no longer be set.
    const parsedRunId = validateIdParam(req.query.jobRunId as string, 'jobRunId');

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    // Get channel ID
    const channelId = await streamingLogsService.getChannelId(jobId, parsedRunId);
    if (!channelId) {
        res.write(`data: ${JSON.stringify({ error: "Job run not found" })}\n\n`);
        res.end();
        return;
    }
    
    // Subscribe to events
    const unsubscribe = streamingLogsService.subscribe(channelId, (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        
        if (data.type === "complete") {
            unsubscribe();
            res.end();
        }
    });
    
    // Handle client disconnect
    req.on("close", () => {
        unsubscribe();
    });
    
    // Send initial logs
    const logs = await streamingLogsService.getLogs(jobId, parsedRunId);
    res.write(`data: ${JSON.stringify({ type: "initial", logs })}\n\n`);
}));

// GET /api/jobs/:id/runs - Get active runs for a job
router.get("/jobs/:id/runs", requireAuth, async (req: any, res) => {
    const jobId = validateIdParam(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job ID" });
    
    try {
        const runs = await streamingLogsService.getActiveRuns(jobId);
        res.json(runs);
    } catch (err: any) {
        logger.error(`Failed to get job runs: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/jobs/:id/runs/:runId/logs - Get logs for a specific run
router.get("/jobs/:id/runs/:runId/logs", requireAuth, async (req: any, res) => {
    const jobId = validateIdParam(req.params.id);
    const jobRunId = validateIdParam(req.params.runId, 'runId');
    
    if (isNaN(jobId) || isNaN(jobRunId)) {
        return res.status(400).json({ message: "Invalid job or run ID" });
    }
    
    const since = parseInt(req.query.since as string) || 0;
    
    try {
        const logs = await streamingLogsService.getLogs(jobId, jobRunId, { sinceChunkIndex: since });
        res.json(logs);
    } catch (err: any) {
        logger.error(`Failed to get run logs: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH SCORE ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/jobs/:id/health - Get health score for a job
router.get("/jobs/:id/health", requireAuth, asyncHandler(async (req: any, res: any) => {
    const jobId = validateIdParam(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job ID" });
    
    try {
        const health = await jobHealthService.calculateHealthScore(jobId);
        const status = jobHealthService.getHealthStatus(health.overall);
        
        res.json({
            ...health,
            status,
        });
    } catch (err: any) {
        logger.error(`Failed to calculate health: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
}));

// GET /api/jobs/:id/health/trend - Get health trend
router.get("/jobs/:id/health/trend", requireAuth, async (req: any, res) => {
    const jobId = validateIdParam(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job ID" });
    
    const days = parseInt(req.query.days as string) || 14;
    
    try {
        const trend = await jobHealthService.getHealthTrend(jobId, days);
        res.json(trend);
    } catch (err: any) {
        logger.error(`Failed to get health trend: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/org/health - Get organization health summary
router.get("/org/health", requireAuth, async (req: any, res) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) {
        return res.status(400).json({ message: "Organization ID required" });
    }
    
    try {
        const summary = await jobHealthService.getOrgHealthSummary(orgContext.organizationId);
        res.json(summary);
    } catch (err: any) {
        logger.error(`Failed to get org health: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// HIL ENHANCEMENTS ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/jobs/:id/hil/config - Get HIL config
router.get("/jobs/:id/hil/config", requireAuth, async (req: any, res) => {
    const jobId = validateIdParam(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job ID" });
    
    const orgContext = await getUserOrgContext(req);
    
    try {
        const config = await hilEnhancementsService.getOrCreateConfig(jobId, orgContext.organizationId ?? undefined);
        res.json(config);
    } catch (err: any) {
        logger.error(`Failed to get HIL config: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/jobs/:id/hil/config - Update HIL config
router.put("/jobs/:id/hil/config", requireAuth, async (req: any, res) => {
    const jobId = validateIdParam(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job ID" });
    
    try {
        const config = await hilEnhancementsService.updateConfig(jobId, req.body);
        res.json(config);
    } catch (err: any) {
        logger.error(`Failed to update HIL config: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/jobs/:id/hil/analytics - Get HIL analytics
router.get("/jobs/:id/hil/analytics", requireAuth, async (req: any, res) => {
    const jobId = validateIdParam(req.params.id);
    if (isNaN(jobId)) return res.status(400).json({ message: "Invalid job ID" });
    
    try {
        const analytics = await hilEnhancementsService.getJobApprovalAnalytics(jobId);
        res.json(analytics);
    } catch (err: any) {
        logger.error(`Failed to get HIL analytics: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/approvals/:id/check-escalation - Check if approval should escalate
router.post("/approvals/:id/check-escalation", requireAuth, async (req: any, res) => {
    const approvalId = validateIdParam(req.params.id);
    if (isNaN(approvalId)) return res.status(400).json({ message: "Invalid approval ID" });
    
    try {
        const check = await hilEnhancementsService.checkEscalation(approvalId);
        res.json(check);
    } catch (err: any) {
        logger.error(`Failed to check escalation: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/approvals/:id/escalate - Manually escalate
router.post("/approvals/:id/escalate", requireAuth, async (req: any, res) => {
    const approvalId = validateIdParam(req.params.id);
    if (isNaN(approvalId)) return res.status(400).json({ message: "Invalid approval ID" });
    
    const { escalationType, toUserIds, toRole, reason } = req.body;
    
    try {
        const log = await hilEnhancementsService.escalateRequest(
            approvalId,
            escalationType || "manual",
            toUserIds,
            toRole,
            reason
        );
        res.json(log);
    } catch (err: any) {
        logger.error(`Failed to escalate: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/approvals/:id/check-auto-approval - Check if can auto-approve
router.post("/approvals/:id/check-auto-approval", requireAuth, async (req: any, res) => {
    const approvalId = validateIdParam(req.params.id);
    if (isNaN(approvalId)) return res.status(400).json({ message: "Invalid approval ID" });
    
    try {
        const check = await hilEnhancementsService.checkAutoApproval(approvalId);
        res.json(check);
    } catch (err: any) {
        logger.error(`Failed to check auto-approval: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

export default router;
