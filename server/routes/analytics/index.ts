/**
 * Analytics Routes Index
 * 
 * Aggregates all analytics API routes for latent feature services
 */

import { Router } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import dataLineageRoutes from "./data-lineage.route.js";
import skillEvolutionRoutes from "./skill-evolution.route.js";
import governanceImpactRoutes from "./governance-impact.route.js";
import knowledgeVerificationRoutes from "./knowledge-verification.route.js";
import blackboardAnalyticsRoutes from "./blackboard-analytics.route.js";
import testProductionCorrelationRoutes from "./test-production-correlation.route.js";
import resourceOptimizerRoutes from "./resource-optimizer.route.js";
import temporalAnalyticsRoutes from "./temporal-analytics.route.js";
import knowledgeImpactRoutes from "./knowledge-impact.route.js";
import multiAgentAnalyticsRoutes from "./multi-agent-analytics.route.js";

const router = Router();

// All analytics routes require authentication
router.use(requireAuth);

// High Priority Services
router.use("/data-lineage", dataLineageRoutes);
router.use("/skill-evolution", skillEvolutionRoutes);
router.use("/governance-impact", governanceImpactRoutes);

// Medium Priority Services
router.use("/knowledge-verification", knowledgeVerificationRoutes);
router.use("/blackboard", blackboardAnalyticsRoutes);
router.use("/test-production", testProductionCorrelationRoutes);
router.use("/resource-optimizer", resourceOptimizerRoutes);

// Low Priority Services
router.use("/temporal", temporalAnalyticsRoutes);
router.use("/knowledge-impact", knowledgeImpactRoutes);
router.use("/multi-agent", multiAgentAnalyticsRoutes);

/**
 * GET /api/analytics
 * Analytics service health check
 */
router.get("/", (req, res) => {
  res.json({
    service: "Analytics API",
    version: "1.0.0",
    services: [
      "data-lineage",
      "skill-evolution",
      "governance-impact",
      "knowledge-verification",
      "blackboard",
      "test-production",
      "resource-optimizer",
      "temporal",
      "knowledge-impact",
      "multi-agent"
    ]
  });
});

export default router;
