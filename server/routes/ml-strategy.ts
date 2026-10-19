/**
 * Strategy Prediction ML API Routes
 * 
 * REST API for ML-based strategy prediction and model management.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { strategyMLService } from "@domain/agents/core/ml-strategy-predictor/index.js";
import { ReasoningStrategy } from "@domain/agents/core/meta-cognitive/reasoning-strategies.js";
import { z } from "zod";

const router = Router();

// Validation schemas
const predictSchema = z.object({
  agentId: z.string(),
  taskFeatures: z.object({
    description: z.string(),
    complexity: z.enum(["low", "medium", "high"]),
    domain: z.string(),
    hasStructuredData: z.boolean(),
    requiresCreativity: z.boolean(),
    hasTimeConstraint: z.boolean(),
    expectedSteps: z.number(),
    riskLevel: z.enum(["low", "medium", "high"]),
    novelty: z.enum(["routine", "familiar", "novel"]),
    wordCount: z.number(),
    questionCount: z.number(),
    keywordDensity: z.record(z.number()),
  }),
});

const recordPerformanceSchema = z.object({
  strategy: z.string(),
  taskFeatures: z.object({
    description: z.string(),
    complexity: z.enum(["low", "medium", "high"]),
    domain: z.string(),
    hasStructuredData: z.boolean(),
    requiresCreativity: z.boolean(),
    hasTimeConstraint: z.boolean(),
    expectedSteps: z.number(),
    riskLevel: z.enum(["low", "medium", "high"]),
    novelty: z.enum(["routine", "familiar", "novel"]),
    wordCount: z.number(),
    questionCount: z.number(),
    keywordDensity: z.record(z.number()),
  }),
  success: z.boolean(),
  qualityScore: z.number().min(0).max(1),
  executionTimeMs: z.number(),
  tokenUsage: z.number(),
  correctionCount: z.number().default(0),
});

const updatePredictionSchema = z.object({
  predictionId: z.number(),
  actualStrategy: z.string(),
  actualSuccess: z.boolean(),
  actualQuality: z.number().min(0).max(1),
});

// ============================================================================
// PREDICTIONS
// ============================================================================

/**
 * POST /api/ml-strategy/predict
 * Get ML-based strategy prediction for a task
 */
router.post("/predict", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

  const { agentId, taskFeatures } = predictSchema.parse(req.body);

  const prediction = await strategyMLService.predictStrategy(taskFeatures, agentId, orgId);

  res.json(prediction);
}));

/**
 * POST /api/ml-strategy/batch-predict
 * Get predictions for multiple tasks
 */
router.post("/batch-predict", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

  const { agentId, tasks } = z.object({
    agentId: z.string(),
    tasks: z.array(predictSchema.shape.taskFeatures),
  }).parse(req.body);

  const predictions = await Promise.all(
    tasks.map(task => strategyMLService.predictStrategy(task, agentId, orgId))
  );

  res.json({ predictions, count: predictions.length });
}));

// ============================================================================
// PERFORMANCE RECORDING
// ============================================================================

/**
 * POST /api/ml-strategy/performance
 * Record actual performance for learning
 */
router.post("/performance", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

  const data = recordPerformanceSchema.parse(req.body);
  const agentId = req.body.agentId || orgContext.userId;

  await strategyMLService.recordPerformance({
    ...data,
    strategy: data.strategy as ReasoningStrategy,
    agentId,
    organizationId: orgId,
  });

  res.json({ success: true });
}));

/**
 * POST /api/ml-strategy/prediction-feedback
 * Update prediction with actual outcome
 */
router.post("/prediction-feedback", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { predictionId, actualStrategy, actualSuccess, actualQuality } = updatePredictionSchema.parse(req.body);

  await strategyMLService.updatePredictionAccuracy(predictionId, actualStrategy as ReasoningStrategy, actualSuccess, actualQuality);

  res.json({ success: true });
}));

// ============================================================================
// MODEL MANAGEMENT
// ============================================================================

/**
 * POST /api/ml-strategy/retrain
 * Retrain the model with recent data
 */
router.post("/retrain", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

  const result = await strategyMLService.retrainModel(orgId);

  res.json(result);
}));

/**
 * GET /api/ml-strategy/metrics
 * Get model performance metrics
 */
router.get("/metrics", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

  const metrics = await strategyMLService.getMetrics(orgId);

  res.json(metrics);
}));

/**
 * GET /api/ml-strategy/model
 * Export current model
 */
router.get("/model", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  // Scoped to the caller's org: this used to export one process-wide model,
  // which after per-tenant weights would have leaked another org's training.
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

  const model = await strategyMLService.exportModel(orgId);
  res.json(model);
}));

// ============================================================================
// ANALYTICS
// ============================================================================

/**
 * GET /api/ml-strategy/strategy-performance/:strategy
 * Get performance stats for a specific strategy
 */
router.get("/strategy-performance/:strategy", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

  const { strategy } = req.params;
  const days = parseInt(req.query.days as string) || 30;

  // Query from database
  const { db } = await import("@server/database_service.js");
  const { strategyPerformanceLogs } = await import("@domain/agents/core/ml-strategy-predictor/strategy-ml.schema.js");
  const { eq, and, gte, sql } = await import("drizzle-orm");

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [stats] = await db
    .select({
      totalUses: sql<number>`count(*)`,
      successRate: sql<number>`avg(case when ${strategyPerformanceLogs.success} then 1 else 0 end)`,
      avgQuality: sql<number>`avg(${strategyPerformanceLogs.qualityScore})`,
      avgTimeMs: sql<number>`avg(${strategyPerformanceLogs.executionTimeMs})`,
      avgTokenUsage: sql<number>`avg(${strategyPerformanceLogs.tokenUsage})`,
    })
    .from(strategyPerformanceLogs)
    .where(and(
      eq(strategyPerformanceLogs.strategy, strategy),
      eq(strategyPerformanceLogs.organizationId, orgId),
      gte(strategyPerformanceLogs.createdAt, cutoff)
    ));

  res.json({
    strategy,
    period: `${days} days`,
    ...stats,
  });
}));

/**
 * GET /api/ml-strategy/top-strategies
 * Get top performing strategies
 */
router.get("/top-strategies", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

  const days = parseInt(req.query.days as string) || 30;
  const limit = parseInt(req.query.limit as string) || 5;

  const { db } = await import("@server/database_service.js");
  const { strategyPerformanceLogs } = await import("@domain/agents/core/ml-strategy-predictor/strategy-ml.schema.js");
  const { eq, gte, sql, and } = await import("drizzle-orm");

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const strategies = await db
    .select({
      strategy: strategyPerformanceLogs.strategy,
      totalUses: sql<number>`count(*)`,
      successRate: sql<number>`avg(case when ${strategyPerformanceLogs.success} then 1 else 0 end)`,
      avgQuality: sql<number>`avg(${strategyPerformanceLogs.qualityScore})`,
    })
    .from(strategyPerformanceLogs)
    .where(and(
      eq(strategyPerformanceLogs.organizationId, orgId),
      gte(strategyPerformanceLogs.createdAt, cutoff)
    ))
    .groupBy(strategyPerformanceLogs.strategy)
    .orderBy(sql`avg(case when ${strategyPerformanceLogs.success} then 1 else 0 end) desc`)
    .limit(limit);

  res.json({ strategies, count: strategies.length });
}));

export default router;
