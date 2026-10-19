/**
 * Mission Blackboard Analytics API Routes
 * 
 * Exposes blackboard state transition analysis, failure pattern detection, and optimization suggestions
 */

import { Router } from "express";
import { blackboardAnalyticsService } from "@domain/mission/core/blackboard-analytics.service.js";

const router = Router();

/**
 * GET /api/analytics/blackboard/transitions/:missionId
 * Analyze blackboard state transitions for a mission
 */
router.get("/transitions/:missionId", async (req, res) => {
  try {
    const missionId = parseInt(req.params.missionId);
    if (isNaN(missionId)) {
      return res.status(400).json({ error: "Invalid mission ID" });
    }

    const transitions = await blackboardAnalyticsService.analyzeTransitions(missionId);
    res.json(transitions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/blackboard/failure-patterns/:organizationId
 * Identify common failure patterns from blackboard history
 */
router.get("/failure-patterns/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const patterns = await blackboardAnalyticsService.identifyFailurePatterns(organizationId);
    res.json(patterns);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/blackboard/progress/:missionId
 * Visualize mission progress from blackboard history
 */
router.get("/progress/:missionId", async (req, res) => {
  try {
    const missionId = parseInt(req.params.missionId);
    if (isNaN(missionId)) {
      return res.status(400).json({ error: "Invalid mission ID" });
    }

    const progress = await blackboardAnalyticsService.visualizeMissionProgress(missionId);
    res.json(progress);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/blackboard/optimizations/:organizationId
 * Generate optimization suggestions based on blackboard analytics
 */
router.get("/optimizations/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const suggestions = await blackboardAnalyticsService.generateOptimizationSuggestions(organizationId);
    res.json(suggestions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/blackboard/stats/:organizationId
 * Get blackboard analytics statistics
 */
router.get("/stats/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const stats = await blackboardAnalyticsService.getAnalyticsStats(organizationId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/blackboard/cache/clear
 * Clear transition cache
 */
router.post("/cache/clear", async (req, res) => {
  try {
    blackboardAnalyticsService.clearCache();
    res.json({ message: "Cache cleared" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
