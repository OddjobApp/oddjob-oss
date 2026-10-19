/**
 * Knowledge Graph Impact Analysis API Routes
 * 
 * Exposes knowledge dependency tracing, critical node identification, and impact prediction
 */

import { Router } from "express";
import { knowledgeImpactService } from "@domain/knowledge/core/knowledge-impact.service.js";

const router = Router();

/**
 * GET /api/analytics/knowledge-impact/dependencies/:nodeId
 * Trace knowledge dependencies for a node
 */
router.get("/dependencies/:nodeId", async (req, res) => {
  try {
    const nodeId = parseInt(req.params.nodeId);
    if (isNaN(nodeId)) {
      return res.status(400).json({ error: "Invalid node ID" });
    }

    const dependencies = await knowledgeImpactService.traceDependencies(nodeId);
    res.json(dependencies);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/knowledge-impact/critical/:organizationId
 * Identify critical knowledge nodes by centrality
 */
router.get("/critical/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const criticalNodes = await knowledgeImpactService.identifyCriticalNodes(organizationId);
    res.json(criticalNodes);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/knowledge-impact/predict
 * Predict impact of a knowledge change
 */
router.post("/predict", async (req, res) => {
  try {
    const { nodeId, changeType } = req.body;
    
    if (!nodeId || !changeType || !["update", "delete", "deprecate"].includes(changeType)) {
      return res.status(400).json({ error: "Missing required fields: nodeId, changeType (update/delete/deprecate)" });
    }

    const prediction = await knowledgeImpactService.predictImpact(nodeId, changeType);
    res.json(prediction);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/knowledge-impact/stats/:organizationId
 * Get impact analysis statistics
 */
router.get("/stats/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const stats = await knowledgeImpactService.getImpactStats(organizationId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/knowledge-impact/cache/clear
 * Clear impact analysis caches
 */
router.post("/cache/clear", async (req, res) => {
  try {
    knowledgeImpactService.clearCaches();
    res.json({ message: "Caches cleared" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
