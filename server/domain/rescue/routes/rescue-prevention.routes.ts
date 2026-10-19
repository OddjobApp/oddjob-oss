/**
 * Rescue Prevention API Routes
 *
 * API endpoints for predictive rescue and mission risk assessment.
 */

import { Router } from "express";
import { createLogger } from "@server/utils/logger.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { rescuePreventionService } from "../core/rescue-prevention.service.js";

const logger = createLogger("RescuePreventionRoutes");
const router = Router();

router.use(requireAuth);

/**
 * GET /api/oddjob/missions/high-risk
 * Get high-risk missions needing attention
 */
router.get("/missions/high-risk", async (req, res) => {
  try {
    // From the session, not the query string. requireAuth establishes only
    // that there is a user; it says nothing about which organization's missions
    // they may read, and `?orgId=` was taken at face value. getUserOrgContext
    // still honours an explicit orgId, but only for an organization the user
    // belongs to.
    const organizationId = requireOrgId(await getUserOrgContext(req));
    const limitRaw = req.query.limit ? parseInt(req.query.limit as string) : 10;
    const limit = isNaN(limitRaw) ? 10 : limitRaw;

    logger.info(`[RescuePreventionRoutes] Getting high-risk missions for org ${organizationId}`);

    const highRiskMissions = await rescuePreventionService.getHighRiskMissions(organizationId);

    res.json({
      count: highRiskMissions.length,
      missions: highRiskMissions.slice(0, limit),
    });
  } catch (error: any) {
    logger.error(`[RescuePreventionRoutes] Failed to get high-risk missions:`, error.message);
    res.status(500).json({ error: "Failed to retrieve high-risk missions" });
  }
});

/**
 * GET /api/oddjob/missions/:missionId/risk-assessment
 * Get risk assessment for a mission
 */
router.get("/missions/:missionId/risk-assessment", async (req, res) => {
  try {
    const missionId = parseInt(req.params.missionId);
    if (isNaN(missionId)) {
      return res.status(400).json({ error: "Invalid mission ID" });
    }

    logger.info(`[RescuePreventionRoutes] Risk assessment requested for mission ${missionId}`);

    const assessment = await rescuePreventionService.assessMissionRisk(missionId);

    res.json({
      success: true,
      missionId,
      assessment: {
        overallRiskScore: assessment.overallRiskScore,
        riskLevel: assessment.riskLevel,
        factors: assessment.factors,
        similarFailedMissions: assessment.similarFailedMissions,
        preventiveActions: assessment.preventiveActions,
        recommendedGovernorPolicy: assessment.recommendedGovernorPolicy,
        confidence: assessment.confidence,
      },
    });
  } catch (error: any) {
    logger.error(`[RescuePreventionRoutes] Risk assessment failed:`, error.message);
    res.status(500).json({ error: "Risk assessment failed" });
  }
});

/**
 * POST /api/oddjob/missions/batch-risk-assessment
 * Batch risk assessment for multiple missions
 */
router.post("/missions/batch-risk-assessment", async (req, res) => {
  try {
    const { missionIds } = req.body;

    if (!Array.isArray(missionIds) || missionIds.length === 0) {
      return res.status(400).json({ error: "missionIds array required" });
    }

    if (missionIds.length > 20) {
      return res.status(400).json({ error: "Maximum 20 missions per batch" });
    }

    logger.info(`[RescuePreventionRoutes] Batch risk assessment for ${missionIds.length} missions`);

    const results = await rescuePreventionService.batchAssess(missionIds);

    res.json({
      processed: results.length,
      highRisk: results.filter((r) => !r.error && r.assessment.riskLevel === "high").length,
      criticalRisk: results.filter((r) => !r.error && r.assessment.riskLevel === "critical").length,
      results: results.map((r) => ({
        missionId: r.missionId,
        error: r.error,
        riskLevel: r.assessment?.riskLevel,
        riskScore: r.assessment?.overallRiskScore,
        confidence: r.assessment?.confidence,
        topFactors: r.assessment?.factors.slice(0, 3).map((f) => ({
          category: f.category,
          score: f.score,
          severity: f.severity,
        })),
      })),
    });
  } catch (error: any) {
    logger.error(`[RescuePreventionRoutes] Batch assessment failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/oddjob/rescue/patterns
 * Analyze rescue patterns from historical data
 */
router.get("/rescue/patterns", async (req, res) => {
  try {
    logger.info(`[RescuePreventionRoutes] Analyzing rescue patterns`);

    const patterns = await rescuePreventionService.analyzeRescuePatterns();

    res.json({
      patterns: patterns.map((p) => ({
        pattern: p.pattern,
        frequency: p.frequency,
        affectedTypes: p.affectedMissionTypes,
        commonCulpritNodes: p.commonCulpritNodes,
        preventiveMeasures: p.preventiveMeasures,
      })),
    });
  } catch (error: any) {
    logger.error(`[RescuePreventionRoutes] Pattern analysis failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
