/**
 * Test-to-Production Correlation API Routes
 * 
 * Exposes test vs production correlation, poor predictor identification, and coverage analytics
 */

import { Router } from "express";
import { testProductionCorrelationService } from "@domain/core/analytics/test-production-correlation.service.js";

const router = Router();

/**
 * GET /api/analytics/test-production/test/:jobId
 * Get test results for a job
 */
router.get("/test/:jobId", async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    if (isNaN(jobId)) {
      return res.status(400).json({ error: "Invalid job ID" });
    }

    const result = await testProductionCorrelationService.getTestResult(jobId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/test-production/production/:jobId
 * Get production results for a job
 */
router.get("/production/:jobId", async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    if (isNaN(jobId)) {
      return res.status(400).json({ error: "Invalid job ID" });
    }

    const result = await testProductionCorrelationService.getProductionResult(jobId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/test-production/correlation/:jobId
 * Calculate correlation between test and production results
 */
router.get("/correlation/:jobId", async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId);
    if (isNaN(jobId)) {
      return res.status(400).json({ error: "Invalid job ID" });
    }

    const correlation = await testProductionCorrelationService.calculateCorrelation(jobId);
    res.json(correlation);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/test-production/poor-predictors/:organizationId
 * Identify tests that don't predict production issues
 */
router.get("/poor-predictors/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const predictors = await testProductionCorrelationService.identifyPoorPredictors(organizationId);
    res.json(predictors);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/test-production/improvements/:organizationId
 * Suggest test improvements based on production failures
 */
router.get("/improvements/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const improvements = await testProductionCorrelationService.suggestTestImprovements(organizationId);
    res.json(improvements);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/test-production/coverage/:organizationId
 * Get test coverage analytics
 */
router.get("/coverage/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const coverage = await testProductionCorrelationService.getTestCoverage(organizationId);
    res.json(coverage);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/test-production/stats/:organizationId
 * Get correlation statistics
 */
router.get("/stats/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const stats = await testProductionCorrelationService.getCorrelationStats(organizationId);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/test-production/cache/clear
 * Clear correlation cache
 */
router.post("/cache/clear", async (req, res) => {
  try {
    testProductionCorrelationService.clearCache();
    res.json({ message: "Cache cleared" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
