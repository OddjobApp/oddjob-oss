import { validateIdParam } from "@server/utils/api-utils.js";
import { Router, Request, Response } from "express";
import { agentAnalyticsService } from "../domain/agents/agent-analytics.service.js";
import { agentOptimizationService } from "../domain/agents/agent-optimization.service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { ValidationError } from "@server/utils/errors.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger('AgentAnalytics');

const router = Router();

// GET /api/agent/memory - Recent runs
router.get("/memory", asyncHandler(async (req: Request, res: Response) => {
    const runs = await agentAnalyticsService.getRecentRuns(50);
    res.json(runs);
}));

// GET /api/agent/memory/:runId - Steps for a run
router.get("/memory/:runId", asyncHandler(async (req: Request, res: Response) => {
    const steps = await agentAnalyticsService.getRunSteps(req.params.runId);
    res.json(steps);
}));

// POST /api/agent/memory/correct-response - Save human correction
router.post("/memory/correct-response", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { stepId, correctedContent, correctionReason, runId } = req.body;

    if (!stepId || !correctedContent || !correctionReason) {
        return res.status(400).json({ error: "Missing required correction fields" });
    }

    // 1. Fetch step to get jobId
    const step = await agentAnalyticsService.getStepById(parseInt(stepId));
    if (!step) {
        return res.status(404).json({ error: "Run step not found" });
    }

    // 2. Save correction as an optimization suggestion
    const suggestion = await agentAnalyticsService.saveOptimizationSuggestion({
        jobId: step.jobId,
        runId: runId || step.runId,
        type: 'user_correction',
        content: correctedContent,
        reasoning: correctionReason,
        status: 'pending'
    });

    // 3. (Optional) In future, trigger an automatic prompt update or fine-tuning process
    logger.info(`[AgentAnalytics] Human correction saved for run ${step.runId}, step ${stepId}`);

    res.json({ success: true, suggestionId: suggestion.id });
}));

// POST /api/agent/memory/:runId/optimize - Trigger analysis
router.post("/memory/:runId/optimize", asyncHandler(async (req: Request, res: Response) => {
    try {
        logger.info(`[AgentAnalytics] Starting optimization for run ${req.params.runId}`);
        const { jobId, hasSteps } = await agentAnalyticsService.getRunMetadata(req.params.runId);

        if (!hasSteps) {
            logger.warn(`[AgentAnalytics] No steps found for run ${req.params.runId}`);
            res.status(404).json({ error: "Run not found or has no steps" });
            return;
        }

        if (!jobId) {
            logger.info(`[AgentAnalytics] Ad-hoc run detected (no jobId) for ${req.params.runId}. Proceeding with general analysis.`);
        } else {
            logger.info(`[AgentAnalytics] Found jobId ${jobId} for run ${req.params.runId}. Starting service analysis...`);
        }

        const suggestions = await agentOptimizationService.analyzeRun(req.params.runId, jobId);
        logger.info(`[AgentAnalytics] Analysis complete for run ${req.params.runId}. Found ${suggestions.length} suggestions.`);
        res.json(suggestions);
    } catch (err: any) {
        logger.error(`[AgentAnalytics] Optimization failed for run ${req.params.runId}:`, err);
        res.status(500).json({ error: err.message || "Optimization failed" });
    }
}));

// GET /api/agent/memory/:runId/suggestions
router.get("/memory/:runId/suggestions", asyncHandler(async (req: Request, res: Response) => {
    const suggestions = await agentOptimizationService.getSuggestions(req.params.runId);
    res.json(suggestions);
}));

// GET /api/agent/analytics/tools - Tool usage
router.get("/analytics/tools", asyncHandler(async (req: Request, res: Response) => {
    const usage = await agentAnalyticsService.getToolUsage(20);
    res.json(usage);
}));

// GET /api/agents/deployments/:jobId/analytics - Agent performance metrics
router.get("/:jobId/analytics", asyncHandler(async (req: Request, res: Response) => {
    const jobId = validateIdParam(req.params.jobId, 'jobId');
    const metrics = await agentAnalyticsService.getJobPerformanceMetrics(jobId, 7);
    res.json({
        ...metrics,
        topConcepts: []
    });
}));

// GET /api/agents/deployments/:jobId/review-queue - Sessions with negative feedback
router.get("/:jobId/review-queue", asyncHandler(async (req: Request, res: Response) => {
    const jobId = validateIdParam(req.params.jobId, 'jobId');
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const reason = req.query.reason as string;

    const result = await agentAnalyticsService.getReviewQueue(jobId, { page, pageSize, reason });

    res.json({
        conversations: result.conversations || [],
        pagination: {
            page,
            pageSize,
            total: result.totalCount
        }
    });
}));

// GET /api/agents/deployments/:jobId/conversation/:sessionId - Full history
router.get("/:jobId/conversation/:sessionId", asyncHandler(async (req: Request, res: Response) => {
    const jobId = validateIdParam(req.params.jobId, 'jobId');
    const sessionId = req.params.sessionId;

    const messages = await agentAnalyticsService.getConversationHistory(jobId, sessionId);
    res.json({ messages });
}));

// GET /api/agents/deployments/:jobId/knowledge-gaps - Failure analysis
router.get("/:jobId/knowledge-gaps", asyncHandler(async (req: Request, res: Response) => {
    const jobId = validateIdParam(req.params.jobId, 'jobId');
    const gaps = await agentAnalyticsService.identifyKnowledgeGaps(jobId);
    const totalFailures = gaps.reduce((sum, g) => sum + g.failureCount, 0);

    res.json({
        gaps: gaps.map(g => ({
            ...g,
            topic: g.topic || 'Unknown',
            sampleQueries: (g.sampleQueries || []).filter(Boolean),
            hasToolHint: false,
            suggestedAction: g.topic?.toLowerCase().includes('tool') || g.topic?.toLowerCase().includes('intent') ? 'add_tool_hint' : 'add_document'
        })),
        totalFailures,
        analyzedPeriod: 'Last 30 Days'
    });
}));

// POST /api/agents/deployments/:jobId/regenerate - Improve response
router.post("/:jobId/regenerate", asyncHandler(async (req: Request, res: Response) => {
    const jobId = validateIdParam(req.params.jobId, 'jobId');
    const { messageId, originalPrompt, originalResponse, correctionFeedback } = req.body;

    // 1. Load Agent Config
    const config = await agentAnalyticsService.getJobConfig(jobId);
    if (!config) {
        res.status(404).json({ error: "Agent not found" });
        return;
    }

    // 2. Use LLM to generate improved response
    const systemInstruction = `You are an expert AI editor. 
Original User Prompt: "${originalPrompt}"
Agent's Original Response: "${originalResponse}"
User's Correction/Feedback: "${correctionFeedback}"

Your task is to write the PERFECT response that addresses the user's feedback and correctly answers the original prompt.
Output ONLY the improved response text. No boilerplate or commentary.`;

    const { systemAiService } = await import("../domain/ai/core/system-ai.service.js");
    const aiConfig = await systemAiService.getAiConfig('copilot') || { provider: 'google', model: 'gemini-2.0-flash' };

    const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");
    const aiClient = AIClientFactory.getClient(aiConfig as any);

    // Resolve API Key
    let apiKey = (aiConfig as any).apiKey || developmentProviderKey();

    const aiResult = await aiClient.execute({
        model: (aiConfig as any).model,
        systemPrompt: systemInstruction,
        userPrompt: "Please provide the improved response.",
        temperature: 0.3
    } as any, undefined, apiKey);

    if (!aiResult.success) {
        res.status(500).json({ error: "AI improvement failed: " + aiResult.error });
        return;
    }

    const improvedContent = aiResult.output;

    // 3. Save as a corrected "Gold Standard" example 
    await agentAnalyticsService.saveCorrectionAsExample(jobId, messageId, improvedContent || "", originalPrompt, correctionFeedback);

    res.json({ success: true, improvedContent });
}));

// POST /api/agent/memory/suggestions/:id/apply
router.post("/memory/suggestions/:id/apply", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    const result = await agentOptimizationService.applySuggestion(id);
    res.json(result);
}));

// GET /api/agent/analytics/tool-heatmap - Tool usage heatmap by time
router.get("/analytics/tool-heatmap", asyncHandler(async (req: Request, res: Response) => {
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
    const groupBy = (req.query.groupBy as string) || 'hour';

    const heatmapData = await agentAnalyticsService.getToolHeatmap({
        startDate,
        endDate,
        groupBy: groupBy as 'hour' | 'day'
    });

    res.json(heatmapData);
}));

// GET /api/agent/analytics/cost-trends - Cost efficiency trends over time
router.get("/analytics/cost-trends", asyncHandler(async (req: Request, res: Response) => {
    const groupBy = (req.query.groupBy as string) || 'day';
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const costTrends = await agentAnalyticsService.getCostTrends(startDate, groupBy as 'day' | 'week' | 'month');
    res.json(costTrends);
}));

// GET /api/agent/analytics/compare - Compare multiple agents
router.get("/analytics/compare", asyncHandler(async (req: Request, res: Response) => {
    const agentIds = req.query.agentIds as string | string[];
    const jobIds = Array.isArray(agentIds) ? agentIds.map(Number) : [Number(agentIds)];

    if (!jobIds || jobIds.length === 0) {
        return res.status(400).json({ error: "At least one agentId is required" });
    }

    const comparisonData = await agentAnalyticsService.compareAgents(jobIds, 30);
    res.json(comparisonData.filter(Boolean));
}));

// =============================================
// RESPONSE TEMPLATE ROUTES
// =============================================

// GET /api/agent/response-templates - List templates
router.get("/response-templates", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const templates = await agentAnalyticsService.listResponseTemplates(orgContext);
    res.json(templates);
}));

// POST /api/agent/response-templates - Create template
router.post("/response-templates", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const template = await agentAnalyticsService.createResponseTemplate(orgContext, req.body);
    res.status(201).json(template);
}));

// PUT /api/agent/response-templates/:id - Update template
router.put("/response-templates/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = validateIdParam(req.params.id);
    const updated = await agentAnalyticsService.updateResponseTemplate(orgContext, id, req.body);

    if (!updated) return res.status(404).json({ error: "Template not found" });
    res.json(updated);
}));

// DELETE /api/agent/response-templates/:id - Delete template
router.delete("/response-templates/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = validateIdParam(req.params.id);

    await agentAnalyticsService.deleteResponseTemplate(orgContext, id);
    res.status(204).send();
}));

// POST /api/agent/response-templates/:id/analyze - Analysis via Python Bridge
router.post("/response-templates/:id/analyze", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const id = validateIdParam(req.params.id);

    const template = await agentAnalyticsService.getTemplateById(orgContext, id);
    if (!template) return res.status(404).json({ error: "Template not found" });

    // There is no analysis behind this route: it forwarded to a sidecar endpoint
    // (/api/scoring/analyze-response) that never existed, and on the failure it
    // answered a fixed "75" as if a score had been measured. Say so instead.
    return res.status(503).json({
        error: "Template analysis is not available",
        message: "No scoring engine is connected for response templates, so no effectiveness score was measured.",
    });
}));

export default router;

