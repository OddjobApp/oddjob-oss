/**
 * Data Lineage API Routes
 * 
 * Exposes cross-domain data lineage tracking and impact analysis endpoints
 */

import { Router } from "express";
import { dataLineageService } from "@domain/core/analytics/data-lineage.service.js";

const router = Router();

/**
 * GET /api/analytics/data-lineage/job/:jobId
 * Trace lineage from a job to all downstream consumers
 */
router.get("/job/:jobId", async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    if (isNaN(jobId)) {
      return res.status(400).json({ error: "Invalid job ID" });
    }

    const lineage = await dataLineageService.traceJobLineage(jobId);
    res.json(lineage);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/data-lineage/node/:nodeId
 * Trace lineage from a knowledge node to upstream sources
 */
router.get("/node/:nodeId", async (req, res) => {
  try {
    const nodeId = parseInt(req.params.nodeId);
    if (isNaN(nodeId)) {
      return res.status(400).json({ error: "Invalid node ID" });
    }

    const lineage = await dataLineageService.traceKnowledgeNodeLineage(nodeId);
    res.json(lineage);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/data-lineage/job/:jobId/impact
 * Analyze impact of changing a job
 */
router.get("/job/:jobId/impact", async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    if (isNaN(jobId)) {
      return res.status(400).json({ error: "Invalid job ID" });
    }

    const impact = await dataLineageService.analyzeJobChangeImpact(jobId);
    res.json(impact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/data-lineage/stats/:organizationId
 * Get lineage statistics for an organization
 */
router.get("/stats/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const stats = await dataLineageService.getLineageStats(organizationId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/data-lineage/cache/clear
 * Clear lineage cache
 */
router.post("/cache/clear", async (req, res) => {
  try {
    dataLineageService.clearCache();
    res.json({ message: "Cache cleared" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
