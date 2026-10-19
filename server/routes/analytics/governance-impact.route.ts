/**
 * Governance Impact Analysis API Routes
 * 
 * Exposes policy impact analysis, recommendations, and coverage gap detection
 */

import { Router } from "express";
import { governanceImpactService } from "@domain/governor/core/governance-impact.service.js";

const router = Router();

/**
 * GET /api/analytics/governance-impact/policy/:policyId
 * Analyze impact of a policy change
 */
router.get("/policy/:policyId", async (req, res) => {
  try {
    const policyId = parseInt(req.params.policyId);
    if (isNaN(policyId)) {
      return res.status(400).json({ error: "Invalid policy ID" });
    }

    const impact = await governanceImpactService.analyzePolicyImpact(policyId);
    res.json(impact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/governance-impact/all/:organizationId
 * Get all policy impacts for an organization
 */
router.get("/all/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const impacts = await governanceImpactService.getAllPolicyImpacts(organizationId);
    res.json(impacts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/governance-impact/recommendations/:organizationId
 * Generate policy recommendations based on violation patterns
 */
router.get("/recommendations/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const recommendations = await governanceImpactService.generatePolicyRecommendations(organizationId);
    res.json(recommendations);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/governance-impact/gaps/:organizationId
 * Identify governance coverage gaps
 */
router.get("/gaps/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const gaps = await governanceImpactService.identifyCoverageGaps(organizationId);
    res.json(gaps);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/governance-impact/stats/:organizationId
 * Get governance statistics
 */
router.get("/stats/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const stats = await governanceImpactService.getGovernanceStats(organizationId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/governance-impact/cache/clear
 * Clear governance impact cache
 */
router.post("/cache/clear", async (req, res) => {
  try {
    governanceImpactService.clearCache();
    res.json({ message: "Cache cleared" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
