/**
 * GMS REST API Routes
 * 
 * Exposes GMS functionality via HTTP endpoints:
 * - POST /api/gms/score - Score mission blueprint
 * - POST /api/gms/synthesize - Generate mission candidates (Phase 2)
 * - POST /api/gms/outcome - Record mission outcome
 * - GET /api/gms/status - Get GMS status
 * - POST /api/gms/retrain - Trigger verifier retraining
 */

import { Router } from "express";
import { createLogger } from "../../../utils/logger.js";
import { requireAuth } from "@domain/auth/core/security.service.js";
import { getGMSOrchestrator } from "./gms-orchestrator.js";

const logger = createLogger("GMSRoutes");
const router = Router();

/**
 * POST /api/gms/score
 * 
 * Score a mission blueprint for predicted success probability
 */
router.post("/score", requireAuth, async (req, res) => {
  try {
    const { blueprint, options = {} } = req.body;
    
    if (!blueprint) {
      return res.status(400).json({
        error: "Missing required field: blueprint"
      });
    }
    
    const gms = await getGMSOrchestrator();
    const score = await gms.scoreMission(blueprint, options);
    
    res.json({
      success: true,
      score
    });
  } catch (error) {
    logger.error("Error in /api/gms/score:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to score mission"
    });
  }
});

/**
 * POST /api/gms/synthesize
 * 
 * Generate mission candidates from natural language request
 * (Phase 2 - placeholder for now)
 */
router.post("/synthesize", requireAuth, async (req, res) => {
  try {
    const { request, context, options } = req.body;
    
    if (!request) {
      return res.status(400).json({
        error: "Missing required field: request"
      });
    }
    
    const gms = await getGMSOrchestrator();
    const response = await gms.synthesizeMissions({
      request,
      context,
      options
    });
    
    res.json(response);
  } catch (error) {
    logger.error("Error in /api/gms/synthesize:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to synthesize missions"
    });
  }
});

/**
 * POST /api/gms/outcome
 * 
 * Record mission outcome for verifier training
 */
router.post("/outcome", requireAuth, async (req, res) => {
  try {
    const { traceId, outcome } = req.body;
    
    if (!traceId || !outcome) {
      return res.status(400).json({
        error: "Missing required fields: traceId, outcome"
      });
    }
    
    const gms = await getGMSOrchestrator();
    await gms.recordOutcome(traceId, outcome);
    
    res.json({
      success: true,
      message: "Outcome recorded successfully"
    });
  } catch (error) {
    logger.error("Error in /api/gms/outcome:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to record outcome"
    });
  }
});

/**
 * GET /api/gms/status
 * 
 * Get GMS health and feature status
 */
router.get("/status", requireAuth, async (_req, res) => {
  try {
    const gms = await getGMSOrchestrator();
    
    res.json({
      success: true,
      status: gms.getStatus()
    });
  } catch (error) {
    logger.error("Error in /api/gms/status:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to get status"
    });
  }
});

/**
 * POST /api/gms/shadow/validate
 * 
 * Shadow validate candidates (Phase 3)
 */
router.post("/shadow/validate", requireAuth, async (req, res) => {
  try {
    const { candidates } = req.body;
    
    if (!candidates || !Array.isArray(candidates)) {
      return res.status(400).json({
        error: "Missing required field: candidates (array)"
      });
    }
    
    const gms = await getGMSOrchestrator();
    const validation = await gms.shadowValidate(candidates, req.body.context);
    
    res.json({
      success: true,
      ...validation
    });
  } catch (error) {
    logger.error("Error in /api/gms/shadow/validate:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Shadow validation failed"
    });
  }
});

/**
 * GET /api/gms/shadow/runs
 * 
 * Get active and recent shadow runs
 */
router.get("/shadow/runs", requireAuth, async (_req, res) => {
  try {
    // This would come from the shadow orchestrator's batch history
    // For now, return empty array as placeholder
    res.json({
      success: true,
      runs: []
    });
  } catch (error) {
    logger.error("Error in /api/gms/shadow/runs:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to get shadow runs"
    });
  }
});

/**
 * GET /api/gms/shadow/metrics
 * 
 * Get ground truth metrics
 */
router.get("/shadow/metrics", requireAuth, async (_req, res) => {
  try {
    const gms = await getGMSOrchestrator();
    const metrics = gms.getShadowMetrics();

    if (!metrics) {
      return res.status(503).json({
        error: "Shadow orchestrator not available"
      });
    }

    res.json({
      success: true,
      ...metrics
    });
  } catch (error) {
    logger.error("Error in /api/gms/shadow/metrics:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to get metrics"
    });
  }
});

/**
 * GET /api/gms/skills/search
 * 
 * Search skill library
 */
router.get("/skills/search", requireAuth, async (req, res) => {
  try {
    const { q, limit = "10", minSuccessRate = "0", tags } = req.query;

    const gms = await getGMSOrchestrator();
    const results = await gms.findSkills(String(q || ""), {
      limit: parseInt(String(limit), 10),
      minSuccessRate: parseFloat(String(minSuccessRate)),
      requiredTags: tags ? String(tags).split(",") : undefined
    });

    res.json({
      success: true,
      results
    });
  } catch (error) {
    logger.error("Error in /api/gms/skills/search:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Search failed"
    });
  }
});

/**
 * GET /api/gms/skills/stats
 * 
 * Get skill library statistics
 */
router.get("/skills/stats", requireAuth, async (_req, res) => {
  try {
    const gms = await getGMSOrchestrator();
    const stats = gms.getSkillStats();
    
    if (!stats) {
      return res.status(503).json({
        error: "Skill library not available"
      });
    }
    
    res.json({
      success: true,
      ...stats
    });
  } catch (error) {
    logger.error("Error in /api/gms/skills/stats:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to get stats"
    });
  }
});

/**
 * POST /api/gms/skills/register
 * 
 * Register a new skill
 */
router.post("/skills/register", requireAuth, async (req, res) => {
  try {
    const { candidate, shadowResult } = req.body;
    
    if (!candidate || !shadowResult) {
      return res.status(400).json({
        error: "Missing required fields: candidate, shadowResult"
      });
    }
    
    const gms = await getGMSOrchestrator();
    const skill = gms.registerSkill(candidate, shadowResult);
    
    res.json({
      success: true,
      skill
    });
  } catch (error) {
    logger.error("Error in /api/gms/skills/register:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to register skill"
    });
  }
});

/**
 * POST /api/gms/skills/:id/evolve
 * 
 * Evolve a skill
 */
router.post("/skills/:id/evolve", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const gms = await getGMSOrchestrator();
    const result = await gms.evolveSkill(id);
    
    res.json(result);
  } catch (error) {
    logger.error("Error in /api/gms/skills/:id/evolve:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Evolution failed"
    });
  }
});

/**
 * POST /api/gms/compose
 * 
 * Compose mission from skills
 */
router.post("/compose", requireAuth, async (req, res) => {
  try {
    const { goal } = req.body;
    
    if (!goal) {
      return res.status(400).json({
        error: "Missing required field: goal"
      });
    }
    
    const gms = await getGMSOrchestrator();
    const composition = await gms.composeMission(goal);
    
    res.json({
      success: true,
      composition
    });
  } catch (error) {
    logger.error("Error in /api/gms/compose:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Composition failed"
    });
  }
});

/**
 * POST /api/gms/retrain
 * 
 * Trigger manual verifier retraining
 */
router.post("/retrain", requireAuth, async (req, res) => {
  try {
    const gms = await getGMSOrchestrator();
    const result = await gms.retrainVerifier();
    
    res.json({
      ...result
    });
  } catch (error) {
    logger.error("Error in /api/gms/retrain:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to retrain verifier"
    });
  }
});

/**
 * GET /api/gms/verifier/metrics
 * 
 * Get detailed verifier metrics
 */
router.get("/verifier/metrics", requireAuth, async (_req, res) => {
  try {
    const gms = await getGMSOrchestrator();
    const status = gms.getStatus();
    
    if (!status.verifier) {
      return res.status(503).json({
        error: "Verifier not available"
      });
    }
    
    res.json({
      success: true,
      metrics: status.verifier
    });
  } catch (error) {
    logger.error("Error in /api/gms/verifier/metrics:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to get metrics"
    });
  }
});

export default router;
