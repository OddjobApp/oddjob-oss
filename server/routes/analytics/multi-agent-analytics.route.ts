/**
 * Multi-Agent Coordination Analytics API Routes
 * 
 * Exposes agent role performance tracking, team composition analysis, and coordination efficiency
 */

import { Router } from "express";
import { multiAgentAnalyticsService } from "@domain/mission/core/multi-agent-analytics.service.js";

const router = Router();

/**
 * POST /api/analytics/multi-agent/track
 * Track agent role performance from mission execution
 */
router.post("/track", async (req, res) => {
  try {
    const { missionId, role, entityId, success, coordinationTime, contributionScore } = req.body;
    
    if (!missionId || !role || !entityId || typeof success !== "boolean" || typeof coordinationTime !== "number" || typeof contributionScore !== "number") {
      return res.status(400).json({ error: "Missing required fields: missionId, role, entityId, success, coordinationTime, contributionScore" });
    }

    await multiAgentAnalyticsService.trackRolePerformance(missionId, role, entityId, success, coordinationTime, contributionScore);
    res.json({ message: "Role performance tracked" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/multi-agent/performance/:role/:organizationId
 * Get agent role performance metrics
 */
router.get("/performance/:role/:organizationId", async (req, res) => {
  try {
    const { role, organizationId } = req.params;
    const orgId = parseInt(organizationId);
    
    if (isNaN(orgId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const performances = await multiAgentAnalyticsService.getRolePerformance(role, orgId);
    res.json(performances);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/multi-agent/compositions/:organizationId
 * Identify optimal team compositions
 */
router.get("/compositions/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const compositions = await multiAgentAnalyticsService.identifyOptimalCompositions(organizationId);
    res.json(compositions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/multi-agent/efficiency/:organizationId
 * Measure coordination overhead vs benefit
 */
router.get("/efficiency/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const metrics = await multiAgentAnalyticsService.measureCoordinationEfficiency(organizationId);
    res.json(metrics);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/multi-agent/recommendations/:organizationId
 * Suggest agent role assignments based on mission type
 */
router.get("/recommendations/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const recommendations = await multiAgentAnalyticsService.suggestRoleAssignments(organizationId);
    res.json(recommendations);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/multi-agent/stats/:organizationId
 * Get multi-agent coordination statistics
 */
router.get("/stats/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const stats = await multiAgentAnalyticsService.getCoordinationStats(organizationId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/multi-agent/cache/clear
 * Clear performance cache
 */
router.post("/cache/clear", async (req, res) => {
  try {
    multiAgentAnalyticsService.clearCache();
    res.json({ message: "Cache cleared" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
