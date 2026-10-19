/**
 * Skill Evolution Analytics API Routes
 * 
 * Exposes skill performance tracking, gap identification, and improvement recommendations
 */

import { Router } from "express";
import { skillEvolutionService } from "@domain/agents/core/skill-evolution.service.js";

const router = Router();

/**
 * POST /api/analytics/skill-evolution/track
 * Track skill execution performance
 */
router.post("/track", async (req, res) => {
  try {
    const { skillId, success, latency, cost } = req.body;
    
    if (!skillId || typeof success !== "boolean" || typeof latency !== "number" || typeof cost !== "number") {
      return res.status(400).json({ error: "Missing required fields: skillId, success, latency, cost" });
    }

    await skillEvolutionService.trackSkillExecution(skillId, success, latency, cost);
    res.json({ message: "Performance tracked" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/skill-evolution/performance/:skillId
 * Get skill performance metrics
 */
router.get("/performance/:skillId", async (req, res) => {
  try {
    const skillId = parseInt(req.params.skillId);
    if (isNaN(skillId)) {
      return res.status(400).json({ error: "Invalid skill ID" });
    }

    const performance = await skillEvolutionService.getSkillPerformance(skillId);
    res.json(performance);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/skill-evolution/gaps/:organizationId
 * Identify skill gaps from mission failures
 */
router.get("/gaps/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const gaps = await skillEvolutionService.identifySkillGaps(organizationId);
    res.json(gaps);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/skill-evolution/recommendations/:organizationId
 * Suggest skill improvements based on knowledge graph patterns
 */
router.get("/recommendations/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const recommendations = await skillEvolutionService.suggestSkillImprovements(organizationId);
    res.json(recommendations);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/skill-evolution/stats/:organizationId
 * Get skill evolution statistics
 */
router.get("/stats/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const stats = await skillEvolutionService.getEvolutionStats(organizationId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/skill-evolution/cache/clear
 * Clear skill evolution caches
 */
router.post("/cache/clear", async (req, res) => {
  try {
    skillEvolutionService.clearCaches();
    res.json({ message: "Caches cleared" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
