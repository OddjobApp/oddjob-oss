/**
 * Resource Utilization Optimization API Routes
 * 
 * Exposes resource tracking, over/under-provisioning detection, and cost optimization
 */

import { Router } from "express";
import { resourceOptimizerService } from "@domain/core/analytics/resource-optimizer.service.js";

const router = Router();

/**
 * POST /api/analytics/resource-optimizer/track/job
 * Track resource usage for a job
 */
router.post("/track/job", async (req, res) => {
  try {
    const { jobId, actualCpu, actualMemory } = req.body;
    
    if (!jobId || typeof actualCpu !== "number" || typeof actualMemory !== "number") {
      return res.status(400).json({ error: "Missing required fields: jobId, actualCpu, actualMemory" });
    }

    await resourceOptimizerService.trackJobResourceUsage(jobId, actualCpu, actualMemory);
    res.json({ message: "Resource usage tracked" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/resource-optimizer/track/mission
 * Track resource usage for a mission
 */
router.post("/track/mission", async (req, res) => {
  try {
    const { missionId, actualSpend } = req.body;
    
    if (!missionId || typeof actualSpend !== "number") {
      return res.status(400).json({ error: "Missing required fields: missionId, actualSpend" });
    }

    await resourceOptimizerService.trackMissionResourceUsage(missionId, actualSpend);
    res.json({ message: "Resource usage tracked" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/resource-optimizer/over-provisioned/:organizationId
 * Identify over-provisioned resources
 */
router.get("/over-provisioned/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const recommendations = await resourceOptimizerService.identifyOverProvisioned(organizationId);
    res.json(recommendations);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/resource-optimizer/under-provisioned/:organizationId
 * Identify under-provisioned resources
 */
router.get("/under-provisioned/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const recommendations = await resourceOptimizerService.identifyUnderProvisioned(organizationId);
    res.json(recommendations);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/resource-optimizer/cost-optimization/:organizationId
 * Generate cost optimization recommendations
 */
router.get("/cost-optimization/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const optimization = await resourceOptimizerService.generateCostOptimization(organizationId);
    res.json(optimization);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/resource-optimizer/utilization/:organizationId
 * Get resource utilization statistics
 */
router.get("/utilization/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const stats = await resourceOptimizerService.getUtilizationStats(organizationId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/resource-optimizer/cache/clear
 * Clear usage cache
 */
router.post("/cache/clear", async (req, res) => {
  try {
    resourceOptimizerService.clearCache();
    res.json({ message: "Cache cleared" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
