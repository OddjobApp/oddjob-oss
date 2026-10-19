/**
 * Xray Lineage API Routes
 *
 * API endpoints for data lineage tracking and impact analysis.
 */

import { Router } from "express";
import { createLogger } from "@server/utils/logger.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { xrayLineageService } from "../core/xray-lineage.service.js";

const logger = createLogger("XrayLineageRoutes");
const router = Router();

router.use(requireAuth);

/**
 * GET /api/oddjob/lineage/datasets/:datasetId
 * Get lineage graph for a dataset
 */
router.get("/datasets/:datasetId", async (req, res) => {
  try {
    const datasetId = parseInt(req.params.datasetId);
    if (isNaN(datasetId)) {
      return res.status(400).json({ error: "Invalid dataset ID" });
    }

    const maxDepth = Math.min(req.query.depth ? parseInt(req.query.depth as string) : 5, 10);
    const direction = (req.query.direction as any) || "both";
    const includeMissions = req.query.missions !== "false";

    logger.info(`[XrayLineageRoutes] Lineage graph requested for dataset ${datasetId}`);

    const graph = await xrayLineageService.buildLineageGraph(datasetId, {
      maxDepth,
      direction,
      includeMissions,
    });

    res.json({
      success: true,
      datasetId,
      rootNode: {
        id: graph.rootNode.id,
        name: graph.rootNode.name,
        type: graph.rootNode.type,
        description: graph.rootNode.description,
      },
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        depth: n.depth,
        metadata: n.metadata,
      })),
      edges: graph.edges.map((e) => ({
        source: e.source,
        target: e.target,
        relation: e.relation,
      })),
      statistics: {
        totalNodes: graph.nodes.length,
        totalEdges: graph.edges.length,
        maxDepth: graph.maxDepth,
        totalPaths: graph.totalPaths,
      },
    });
  } catch (error: any) {
    logger.error(`[XrayLineageRoutes] Lineage graph failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/oddjob/lineage/datasets/:datasetId/impact
 * Get impact analysis for a dataset
 */
router.get("/datasets/:datasetId/impact", async (req, res) => {
  try {
    const datasetId = parseInt(req.params.datasetId);
    if (isNaN(datasetId)) {
      return res.status(400).json({ error: "Invalid dataset ID" });
    }

    const maxDepth = Math.min(req.query.depth ? parseInt(req.query.depth as string) : 5, 10);
    const includeIndirect = req.query.indirect !== "false";

    logger.info(`[XrayLineageRoutes] Impact analysis requested for dataset ${datasetId}`);

    const impact = await xrayLineageService.analyzeImpact(datasetId, {
      maxDepth,
      includeIndirect,
    });

    res.json({
      success: true,
      sourceDatasetId: impact.sourceDatasetId,
      blastRadius: impact.blastRadius,
      totalImpactScore: impact.totalImpactScore,
      directlyAffected: impact.directlyAffected.map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name,
        path: e.path,
        depth: e.depth,
        impactType: e.impactType,
        confidence: e.confidence,
      })),
      indirectlyAffected: impact.indirectlyAffected.map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name,
        path: e.path,
        depth: e.depth,
        impactType: e.impactType,
        confidence: e.confidence,
      })),
      recommendedActions: impact.recommendedActions,
    });
  } catch (error: any) {
    logger.error(`[XrayLineageRoutes] Impact analysis failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/oddjob/lineage/datasets/:datasetId/visualization
 * Get lineage visualization data
 */
router.get("/datasets/:datasetId/visualization", async (req, res) => {
  try {
    const datasetId = parseInt(req.params.datasetId);
    if (isNaN(datasetId)) {
      return res.status(400).json({ error: "Invalid dataset ID" });
    }

    const maxDepth = req.query.depth ? parseInt(req.query.depth as string) : 3;

    const viz = await xrayLineageService.getLineageVisualization(datasetId, maxDepth);

    res.json(viz);
  } catch (error: any) {
    logger.error(`[XrayLineageRoutes] Visualization failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/oddjob/lineage/batch-analysis
 * Batch lineage analysis for multiple datasets
 */
router.post("/batch-analysis", async (req, res) => {
  try {
    const { datasetIds } = req.body;
    const maxDepth = req.body.maxDepth || 3;

    if (!Array.isArray(datasetIds) || datasetIds.length === 0) {
      return res.status(400).json({ error: "datasetIds array required" });
    }

    if (datasetIds.length > 10) {
      return res.status(400).json({ error: "Maximum 10 datasets per batch" });
    }

    logger.info(`[XrayLineageRoutes] Batch analysis for ${datasetIds.length} datasets`);

    const results = await xrayLineageService.batchLineageAnalysis(datasetIds, maxDepth);

    res.json({
      processed: results.length,
      results: results.map((r) => ({
        datasetId: r.datasetId,
        error: r.error,
        lineage: r.lineage
          ? {
              totalNodes: r.lineage.nodes.length,
              totalEdges: r.lineage.edges.length,
              maxDepth: r.lineage.maxDepth,
            }
          : undefined,
        impact: r.impact
          ? {
              blastRadius: r.impact.blastRadius,
              totalImpactScore: r.impact.totalImpactScore,
              directlyAffectedCount: r.impact.directlyAffected.length,
              indirectlyAffectedCount: r.impact.indirectlyAffected.length,
            }
          : undefined,
      })),
    });
  } catch (error: any) {
    logger.error(`[XrayLineageRoutes] Batch analysis failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/oddjob/lineage/hot-datasets
 * Find datasets with highest downstream impact
 */
router.get("/hot-datasets", async (req, res) => {
  try {
    // From the session, not the query string: see the matching comment in
    // rescue-prevention.routes.ts. getUserOrgContext honours an explicit orgId
    // only for an organization the user is a member of.
    const organizationId = requireOrgId(await getUserOrgContext(req));
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

    logger.info(`[XrayLineageRoutes] Finding hot datasets for org ${organizationId}`);

    const hotDatasets = await xrayLineageService.findHotDatasets(organizationId, limit);

    res.json({
      count: hotDatasets.length,
      datasets: hotDatasets,
    });
  } catch (error: any) {
    logger.error(`[XrayLineageRoutes] Hot datasets query failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
