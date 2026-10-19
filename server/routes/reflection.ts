/**
 * Reflection System API Routes
 * 
 * Endpoints for the ReAct with Reflection & Self-Correction system.
 */

import { Router, type Request, type Response } from "express";
import { validateIdParam } from "@server/utils/api-utils.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext, requireOrgAdminOrSuper } from "../utils/auth-context.js";
import { reflectionService } from "@domain/agents/core/reflection/reflection.service.js";
import { z } from "zod";
import { asyncHandler } from "@server/middleware/error-handler.js";

const router = Router();

// Validation schemas
const reflectSchema = z.object({
  stepId: z.string(),
  output: z.any(),
  context: z.record(z.any()).optional(),
  verificationStrategies: z.array(z.enum(["factual", "logical", "consistency", "schema", "hallucination"])).optional(),
  previousReflections: z.number().optional(),
});

const correctSchema = z.object({
  original: z.any(),
  issues: z.array(z.object({
    type: z.enum(["hallucination", "logical_error", "factual_error", "schema_mismatch", "inconsistency"]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    description: z.string(),
    location: z.string().optional(),
    evidence: z.any().optional(),
  })),
  context: z.record(z.any()).optional(),
  attempt: z.number().default(1),
  maxAttempts: z.number().default(3),
});

// ========================================================================
// REFLECTION ENDPOINTS
// ========================================================================

/**
 * POST /api/agents/:missionRunId/reflect
 * 
 * Manually trigger reflection on a step output.
 */
router.post("/:missionRunId/reflect", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

    const missionRunId = validateIdParam(req.params.missionRunId, 'missionRunId');
    if (isNaN(missionRunId)) {
      return res.status(400).json({ error: "Invalid mission run ID" });
    }

    const input = reflectSchema.parse(req.body);

    const result = await reflectionService.reflect({
      ...input,
      missionRunId,
      organizationId: orgId,
    } as any);

    res.json(result);
}));

/**
 * POST /api/agents/:missionRunId/correct
 * 
 * Attempt to correct detected issues.
 */
router.post("/:missionRunId/correct", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const input = correctSchema.parse(req.body);

  const result = await reflectionService.attemptCorrection(input as any);

  res.json(result);
}));

// ========================================================================
// QUERY ENDPOINTS
// ========================================================================

/**
 * GET /api/agents/:missionRunId/reflections
 * 
 * Get reflection history for a mission run.
 */
router.get("/:missionRunId/reflections", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

    const missionRunId = validateIdParam(req.params.missionRunId, 'missionRunId');
    const limit = parseInt(req.query.limit as string) || 50;

    const { db } = await import("@server/database_service.js");
    const { reflectionLogs } = await import("@shared/schema/index.js");
    const { eq, and, desc } = await import("drizzle-orm");

    const logs = await db.query.reflectionLogs.findMany({
      where: and(
        eq(reflectionLogs.missionRunId, missionRunId),
        eq(reflectionLogs.organizationId, orgId)
      ),
      orderBy: desc(reflectionLogs.createdAt),
      limit,
    });

  res.json({ 
    reflections: logs,
    count: logs.length,
  });
}));

/**
 * GET /api/agents/:missionRunId/reflections/:reflectionId
 * 
 * Get specific reflection details.
 */
router.get("/:missionRunId/reflections/:reflectionId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { db } = await import("@server/database_service.js");
    const { reflectionLogs } = await import("@shared/schema/index.js");
    const { eq, and } = await import("drizzle-orm");

    const log = await db.query.reflectionLogs.findFirst({
      where: and(
        eq(reflectionLogs.id, req.params.reflectionId),
        eq(reflectionLogs.organizationId, orgId)
      ),
    });

    if (!log) {
      return res.status(404).json({ error: "Reflection not found" });
    }

  res.json(log);
}));

// ========================================================================
// STATISTICS ENDPOINTS
// ========================================================================

/**
 * GET /api/agents/reflection-stats
 * 
 * Get organization-wide reflection statistics.
 */
router.get("/reflection-stats", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

    const days = parseInt(req.query.days as string) || 30;

    const stats = await reflectionService.getStats(orgId, days);

  res.json(stats);
}));

/**
 * GET /api/agents/reflection-patterns
 * 
 * Get learned reflection patterns for the organization.
 */
router.get("/reflection-patterns", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { db } = await import("@server/database_service.js");
    const { reflectionPatterns } = await import("@shared/schema/index.js");
    const { eq, and, desc } = await import("drizzle-orm");

    const type = req.query.type as string | undefined;
    const activeOnly = req.query.active === "true";

    const patterns = await db.query.reflectionPatterns.findMany({
      where: and(
        eq(reflectionPatterns.organizationId, orgId),
        type ? eq(reflectionPatterns.patternType, type) : undefined,
        activeOnly ? eq(reflectionPatterns.isActive, true) : undefined
      ),
      orderBy: desc(reflectionPatterns.successRate),
    });

  res.json({ 
    patterns,
    count: patterns.length,
  });
}));

// ========================================================================
// ADMIN ENDPOINTS
// ========================================================================

/**
 * POST /api/agents/reflection-patterns
 * 
 * Create a new reflection pattern (admin only).
 */
router.post("/reflection-patterns", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

    const patternSchema = z.object({
      patternType: z.enum(["hallucination", "logical_error", "factual_error", "schema_mismatch", "inconsistency", "common_mistake"]),
      triggerSignature: z.string(),
      name: z.string(),
      description: z.string(),
      example: z.string().optional(),
      correctionStrategy: z.record(z.any()),
    });

    const data = patternSchema.parse(req.body);

    const { db } = await import("@server/database_service.js");
    const { reflectionPatterns } = await import("@shared/schema/index.js");

    const [pattern] = await db.insert(reflectionPatterns).values({
      ...data,
      organizationId: orgId,
      isAutoGenerated: false,
    } as any).returning();

  res.json({ success: true, pattern });
}));

/**
 * PUT /api/agents/reflection-patterns/:patternId
 * 
 * Update a reflection pattern.
 */
router.put("/reflection-patterns/:patternId", requireOrgAdminOrSuper, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

    const patternId = validateIdParam(req.params.patternId, 'patternId');

    const updateSchema = z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
      correctionStrategy: z.record(z.any()).optional(),
    });

    const updates = updateSchema.parse(req.body);

    const { db } = await import("@server/database_service.js");
    const { reflectionPatterns } = await import("@shared/schema/index.js");
    const { eq, and } = await import("drizzle-orm");

    await db.update(reflectionPatterns)
      .set({
        ...updates,
        lastDetectedAt: new Date(),
      })
      .where(and(
        eq(reflectionPatterns.id, patternId),
        eq(reflectionPatterns.organizationId, orgId)
      ));

  res.json({ success: true });
}));

/**
 * GET /api/agents/reflection-dashboard
 * 
 * Get dashboard data for reflection monitoring.
 */
router.get("/reflection-dashboard", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

    const days = parseInt(req.query.days as string) || 7;
    const { db } = await import("@server/database_service.js");
    const { sql } = await import("drizzle-orm");

    // Get stats
    const stats = await reflectionService.getStats(orgId, days);

    // Get recent trends (last 7 days)
    const trends = await db.execute(sql`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as total,
        SUM(CASE WHEN resolution = 'passed' THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN resolution = 'corrected' THEN 1 ELSE 0 END) as corrected,
        SUM(CASE WHEN resolution = 'escalated' THEN 1 ELSE 0 END) as escalated,
        AVG((reflection_result->>'confidenceScore')::float) as avg_confidence
      FROM reflection_logs
      WHERE organization_id = ${orgId}
        AND created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    // Get top issues this week
    const topIssues = await db.execute(sql`
      SELECT 
        issue->>'type' as issue_type,
        COUNT(*) as count
      FROM reflection_logs,
           jsonb_array_elements(reflection_result->'issues') as issue
      WHERE organization_id = ${orgId}
        AND created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY issue->>'type'
      ORDER BY count DESC
      LIMIT 5
    `);

  res.json({
    summary: stats,
    dailyTrends: trends.rows,
    topIssues: topIssues.rows,
  });
}));

export default router;
