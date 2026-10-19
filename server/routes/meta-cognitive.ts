/**
 * Meta-Cognitive Planning API Routes
 * 
 * REST API for agent meta-cognitive planning and monitoring.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { metaCognitivePlanner, cognitiveMonitor } from "@domain/agents/core/meta-cognitive/index.js";
import { z } from "zod";

const router = Router();

// Validation schemas
const createPlanSchema = z.object({
  agentId: z.string(),
  taskId: z.string(),
  characteristics: z.object({
    description: z.string(),
    complexity: z.enum(["low", "medium", "high"]),
    domain: z.string(),
    hasStructuredData: z.boolean(),
    requiresCreativity: z.boolean(),
    hasTimeConstraint: z.boolean(),
    expectedSteps: z.number().optional(),
    riskLevel: z.enum(["low", "medium", "high"]),
    novelty: z.enum(["routine", "familiar", "novel"]),
  }),
  context: z.object({
    availableTools: z.array(z.string()).optional(),
    deadlineMs: z.number().optional(),
    previousAttempts: z.number().optional(),
  }).optional(),
});

const recordMetricsSchema = z.object({
  processingLatencyMs: z.number().optional(),
  tokenThroughput: z.number().optional(),
  contextUtilization: z.number().min(0).max(1).optional(),
  toolCallFrequency: z.number().optional(),
  errorRate: z.number().min(0).max(1).optional(),
  repetitionScore: z.number().min(0).max(1).optional(),
  coherenceScore: z.number().min(0).max(1).optional(),
  confidenceEstimate: z.number().min(0).max(1).optional(),
});

const completePlanSchema = z.object({
  success: z.boolean(),
  actualSteps: z.number(),
  actualTimeMs: z.number(),
  quality: z.number().min(0).max(1),
  lessons: z.array(z.string()),
});

// ============================================================================
// COGNITIVE PLANNING
// ============================================================================

/**
 * POST /api/meta-cognitive/plans
 * Create a cognitive plan for a task
 */
router.post("/plans", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const data = createPlanSchema.parse(req.body);
  
  const plan = await metaCognitivePlanner.createPlan(
    data.agentId,
    data.taskId,
    data.characteristics,
    data.context
  );

  res.status(201).json(plan);
}));

/**
 * GET /api/meta-cognitive/plans/:planId
 * Get plan details
 */
router.get("/plans/:planId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const plan = metaCognitivePlanner.getPlan(req.params.planId);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  res.json(plan);
}));

/**
 * POST /api/meta-cognitive/plans/:planId/start
 * Mark plan as started
 */
router.post("/plans/:planId/start", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const plan = metaCognitivePlanner.startExecution(req.params.planId);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  res.json(plan);
}));

/**
 * POST /api/meta-cognitive/plans/:planId/adapt
 * Adapt plan with new strategy
 */
router.post("/plans/:planId/adapt", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { strategy } = z.object({ strategy: z.string() }).parse(req.body);
  
  const plan = metaCognitivePlanner.adaptPlan(req.params.planId, strategy as any);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  res.json(plan);
}));

/**
 * POST /api/meta-cognitive/plans/:planId/complete
 * Complete plan with outcome
 */
router.post("/plans/:planId/complete", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const outcome = completePlanSchema.parse(req.body);
  
  const plan = await metaCognitivePlanner.completePlan(req.params.planId, outcome);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  res.json(plan);
}));

/**
 * POST /api/meta-cognitive/plans/:planId/check-adaptation
 * Check if adaptation is needed
 */
router.post("/plans/:planId/check-adaptation", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { currentStep, metrics } = z.object({
    currentStep: z.number(),
    metrics: z.object({
      timeSpentMs: z.number(),
      verificationFailures: z.number(),
      confidence: z.number(),
    }),
  }).parse(req.body);

  const result = metaCognitivePlanner.checkAdaptationNeeded(
    req.params.planId,
    currentStep,
    metrics
  );

  res.json(result);
}));

// ============================================================================
// AGENT STATE & INSIGHTS
// ============================================================================

/**
 * GET /api/meta-cognitive/agents/:agentId/state
 * Get agent cognitive state
 */
router.get("/agents/:agentId/state", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const state = metaCognitivePlanner.getAgentState(req.params.agentId);
  if (!state) return res.status(404).json({ error: "Agent state not found" });

  res.json(state);
}));

/**
 * GET /api/meta-cognitive/agents/:agentId/history
 * Get agent's plan history
 */
router.get("/agents/:agentId/history", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const history = metaCognitivePlanner.getAgentHistory(req.params.agentId);
  
  res.json({ 
    history: history.slice(-limit),
    total: history.length,
  });
}));

/**
 * GET /api/meta-cognitive/agents/:agentId/insights
 * Get agent insights and recommendations
 */
router.get("/agents/:agentId/insights", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const insights = metaCognitivePlanner.getAgentInsights(req.params.agentId);
  res.json(insights);
}));

/**
 * GET /api/meta-cognitive/agents/:agentId/strategies
 * Get agent's preferred strategies
 */
router.get("/agents/:agentId/strategies", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 3;
  const strategies = metaCognitivePlanner.getAgentPreferredStrategies(req.params.agentId, limit);
  res.json({ strategies });
}));

/**
 * POST /api/meta-cognitive/agents/:agentId/reset-fatigue
 * Reset agent fatigue
 */
router.post("/agents/:agentId/reset-fatigue", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  metaCognitivePlanner.resetFatigue(req.params.agentId);
  res.json({ success: true });
}));

// ============================================================================
// COGNITIVE MONITORING
// ============================================================================

/**
 * POST /api/meta-cognitive/agents/:agentId/monitoring/start
 * Start cognitive monitoring
 */
router.post("/agents/:agentId/monitoring/start", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { windowMinutes } = z.object({ windowMinutes: z.number().optional() }).parse(req.body);
  
  cognitiveMonitor.startMonitoring(req.params.agentId, windowMinutes);
  res.json({ success: true });
}));

/**
 * POST /api/meta-cognitive/agents/:agentId/monitoring/stop
 * Stop cognitive monitoring
 */
router.post("/agents/:agentId/monitoring/stop", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  cognitiveMonitor.stopMonitoring(req.params.agentId);
  res.json({ success: true });
}));

/**
 * POST /api/meta-cognitive/agents/:agentId/metrics
 * Record cognitive metrics
 */
router.post("/agents/:agentId/metrics", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const metrics = recordMetricsSchema.parse(req.body);
  
  await cognitiveMonitor.recordMetrics(req.params.agentId, metrics);
  res.json({ success: true });
}));

/**
 * GET /api/meta-cognitive/agents/:agentId/health
 * Get cognitive health status
 */
router.get("/agents/:agentId/health", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const health = cognitiveMonitor.getCognitiveHealth(req.params.agentId);
  res.json(health);
}));

/**
 * GET /api/meta-cognitive/agents/:agentId/metrics/history
 * Get metrics history
 */
router.get("/agents/:agentId/metrics/history", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const minutes = parseInt(req.query.minutes as string) || 60;
  const history = cognitiveMonitor.getMetricsHistory(req.params.agentId, minutes);
  res.json({ metrics: history, count: history.length });
}));

// ============================================================================
// GLOBAL STATS
// ============================================================================

/**
 * GET /api/meta-cognitive/strategies/performance
 * Get global strategy performance
 */
router.get("/strategies/performance", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const performance = metaCognitivePlanner.getStrategyPerformance();
  // Always returns Map when called without argument
  res.json(Object.fromEntries(performance as Map<any, any>));
}));

/**
 * GET /api/meta-cognitive/monitoring/summary
 * Get monitoring summary across all agents
 */
router.get("/monitoring/summary", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const summary = cognitiveMonitor.getMonitoringSummary();
  res.json(summary);
}));

/**
 * GET /api/meta-cognitive/strategies
 * Get all available reasoning strategies
 */
router.get("/strategies", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  const { STRATEGY_DEFINITIONS } = await import("@domain/agents/core/meta-cognitive/reasoning-strategies.js");
  res.json(STRATEGY_DEFINITIONS);
}));

export default router;
