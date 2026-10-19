/**
 * Temporal Pattern Detection API Routes
 * 
 * Exposes temporal pattern detection, anomaly detection, resource prediction, and scheduling optimization
 */

import { Router } from "express";
import { temporalAnalyticsService } from "@domain/core/analytics/temporal-analytics.service.js";

const router = Router();

/**
 * GET /api/analytics/temporal/patterns/:organizationId
 * Detect temporal patterns in job execution
 */
router.get("/patterns/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const patterns = await temporalAnalyticsService.detectJobPatterns(organizationId);
    res.json(patterns);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/temporal/anomalies/:organizationId
 * Detect anomalies in execution timing
 */
router.get("/anomalies/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const anomalies = await temporalAnalyticsService.detectAnomalies(organizationId);
    res.json(anomalies);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/temporal/predict/:organizationId
 * Predict resource needs based on temporal patterns
 */
router.get("/predict/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const hoursAhead = parseInt(req.query.hoursAhead as string) || 24;
    
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const predictions = await temporalAnalyticsService.predictResourceNeeds(organizationId, hoursAhead);
    res.json(predictions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/temporal/scheduling/:organizationId
 * Generate scheduling recommendations
 */
router.get("/scheduling/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const recommendations = await temporalAnalyticsService.generateSchedulingRecommendations(organizationId);
    res.json(recommendations);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/temporal/stats/:organizationId
 * Get temporal analytics statistics
 */
router.get("/stats/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const stats = await temporalAnalyticsService.getTemporalStats(organizationId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/temporal/cache/clear
 * Clear temporal analytics caches
 */
router.post("/cache/clear", async (req, res) => {
  try {
    temporalAnalyticsService.clearCaches();
    res.json({ message: "Caches cleared" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
