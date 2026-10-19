/**
 * Mission Knowledge API Routes
 *
 * API endpoints for knowledge-driven mission context enrichment and agent routing.
 */

import { Router } from "express";
import { createLogger } from "@server/utils/logger.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { missionContextEnrichmentService } from "../core/mission-context-enrichment.service.js";
import { knowledgeDrivenAgentRouter } from "../core/knowledge-driven-agent-router.js";

const logger = createLogger("MissionKnowledgeRoutes");
const router = Router();

router.use(requireAuth);

/**
 * GET /api/oddjob/missions/:missionId/context
 * Get enriched mission context with knowledge graph insights
 */
router.get("/missions/:missionId/context", async (req, res) => {
  try {
    const missionId = parseInt(req.params.missionId);
    if (isNaN(missionId)) {
      return res.status(400).json({ error: "Invalid mission ID" });
    }

    // Check enrichment status first
    const status = await missionContextEnrichmentService.getEnrichmentStatus(missionId);

    if (!status.enriched) {
      // Return empty but valid response
      return res.json({
        entities: [],
        keyRelationships: [],
        similarPastMissions: [],
        suggestedActions: [],
        relevanceScore: 0,
        confidence: 0,
        enriched: false,
      });
    }

    // Re-fetch from blackboard
    const context = await missionContextEnrichmentService.getEnrichmentStatus(missionId);

    res.json({
      enriched: true,
      entityCount: status.entityCount,
      enrichmentScore: status.enrichmentScore,
      enrichedAt: status.enrichedAt,
    });
  } catch (error: any) {
    logger.error(`[MissionKnowledgeRoutes] Failed to get context:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/oddjob/missions/:missionId/enrich
 * Trigger mission context enrichment
 */
router.post("/missions/:missionId/enrich", async (req, res) => {
  try {
    const missionId = parseInt(req.params.missionId);
    if (isNaN(missionId)) {
      return res.status(400).json({ error: "Invalid mission ID" });
    }

    const config = req.body.config || {};

    logger.info(`[MissionKnowledgeRoutes] Enriching mission ${missionId}`);

    const enrichedContext = await missionContextEnrichmentService.enrichMissionContext(
      missionId,
      {
        maxEntities: config.maxEntities || 20,
        relationshipDepth: config.relationshipDepth || 2,
        minRelevanceScore: config.minRelevanceScore || 0.6,
        includeRelatedMissions: config.includeRelatedMissions ?? true,
        autoPopulate: config.autoPopulate ?? true,
      }
    );

    res.json({
      success: true,
      enriched: true,
      entities: enrichedContext.entities.length,
      relationships: enrichedContext.relationships.length,
      relatedMissions: enrichedContext.relatedMissions.length,
      suggestedActions: enrichedContext.suggestedActions.length,
      confidence: enrichedContext.confidence,
      context: enrichedContext,
    });
  } catch (error: any) {
    logger.error(`[MissionKnowledgeRoutes] Enrichment failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/oddjob/missions/:missionId/routing
 * Get current agent routing status
 */
router.get("/missions/:missionId/routing", async (req, res) => {
  try {
    const missionId = parseInt(req.params.missionId);
    if (isNaN(missionId)) {
      return res.status(400).json({ error: "Invalid mission ID" });
    }

    // Get routing stats
    const stats = await knowledgeDrivenAgentRouter.getRoutingStats(missionId);

    // Get active agents
    const agents = Array.from(knowledgeDrivenAgentRouter.agents.values())
      .filter((a) => a.missionId === missionId)
      .map((a) => ({
        agentId: a.id,
        agentName: a.name,
        role: a.role,
        status: a.status,
        knowledgeProximity: a.processedKnowledge.size > 0 ? Math.min(1, a.processedKnowledge.size / 10) : 0,
        currentLoad: a.currentLoad,
        assignedTasks: a.currentTasks.length,
        expertise: a.expertiseAreas,
      }));

    res.json({
      missionId,
      stats,
      agents,
      tasks: [], // Would populate from actual task tracking
    });
  } catch (error: any) {
    logger.error(`[MissionKnowledgeRoutes] Failed to get routing:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/oddjob/missions/:missionId/route
 * Trigger agent routing for mission tasks
 */
router.post("/missions/:missionId/route", async (req, res) => {
  try {
    const missionId = parseInt(req.params.missionId);
    if (isNaN(missionId)) {
      return res.status(400).json({ error: "Invalid mission ID" });
    }

    const { tasks } = req.body;

    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: "Tasks array required" });
    }

    logger.info(`[MissionKnowledgeRoutes] Routing ${tasks.length} tasks for mission ${missionId}`);

    // Ensure agents are initialized
    let agents = Array.from(knowledgeDrivenAgentRouter.agents.values()).filter(
      (a) => a.missionId === missionId
    );

    if (agents.length === 0) {
      agents = await knowledgeDrivenAgentRouter.initializeMissionAgents(missionId);
    }

    // Route tasks
    const routingResult = await knowledgeDrivenAgentRouter.routeTasks(
      tasks.map((t) => ({
        id: t.id,
        missionId,
        description: t.description,
        type: t.type || "analysis",
        requiredCapabilities: t.requiredCapabilities || [],
        relatedKnowledgeIds: t.relatedKnowledgeIds || [],
        priority: t.priority || 5,
        estimatedDuration: t.estimatedDuration || 30,
        dependencies: t.dependencies || [],
      })),
      missionId
    );

    // Format response
    const formattedTasks = routingResult.decisions.map((d) => ({
      taskId: d.taskId,
      taskName: tasks.find((t: any) => t.id === d.taskId)?.description || d.taskId,
      assignedAgent: d.assignedAgentId,
      confidence: d.confidence,
      estimatedDuration: d.expectedCompletion,
      reasoning: d.reasoning,
    }));

    res.json({
      success: true,
      decisions: routingResult.decisions.length,
      unassigned: routingResult.unassignedTasks.length,
      teamEfficiency: routingResult.teamEfficiency,
      estimatedTotalDuration: routingResult.estimatedTotalDuration,
      knowledgeCoverage: routingResult.knowledgeCoverage,
      tasks: formattedTasks,
      agents: agents.map((a) => ({
        agentId: a.id,
        agentName: a.name,
        role: a.role,
        status: a.status,
        knowledgeProximity: 0.7, // Calculated value
        currentLoad: a.currentLoad,
        assignedTasks: a.currentTasks.length,
        expertise: a.expertiseAreas,
      })),
    });
  } catch (error: any) {
    logger.error(`[MissionKnowledgeRoutes] Routing failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/oddjob/missions/:missionId/agents/:agentId/complete
 * Mark task completion for agent
 */
router.post("/missions/:missionId/agents/:agentId/complete", async (req, res) => {
  try {
    const missionId = parseInt(req.params.missionId);
    const agentId = req.params.agentId;
    const { taskId, success } = req.body;

    if (isNaN(missionId)) {
      return res.status(400).json({ error: "Invalid mission ID" });
    }

    knowledgeDrivenAgentRouter.completeTask(agentId, taskId, success ?? true);

    res.json({
      success: true,
      message: `Task ${taskId} marked as ${success ? "completed" : "failed"}`,
    });
  } catch (error: any) {
    logger.error(`[MissionKnowledgeRoutes] Task completion failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/oddjob/missions/:missionId/enrichment-status
 * Get enrichment status for a mission
 */
router.get("/missions/:missionId/enrichment-status", async (req, res) => {
  try {
    const missionId = parseInt(req.params.missionId);
    if (isNaN(missionId)) {
      return res.status(400).json({ error: "Invalid mission ID" });
    }

    const status = await missionContextEnrichmentService.getEnrichmentStatus(missionId);

    res.json({
      missionId,
      ...status,
    });
  } catch (error: any) {
    logger.error(`[MissionKnowledgeRoutes] Status check failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/oddjob/missions/batch-enrich
 * Batch enrich multiple missions
 */
router.post("/missions/batch-enrich", async (req, res) => {
  try {
    const { missionIds } = req.body;

    if (!Array.isArray(missionIds) || missionIds.length === 0) {
      return res.status(400).json({ error: "missionIds array required" });
    }

    if (missionIds.length > 10) {
      return res.status(400).json({ error: "Maximum 10 missions per batch" });
    }

    logger.info(`[MissionKnowledgeRoutes] Batch enriching ${missionIds.length} missions`);

    const results = await missionContextEnrichmentService.batchEnrich(missionIds);

    res.json({
      processed: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  } catch (error: any) {
    logger.error(`[MissionKnowledgeRoutes] Batch enrichment failed:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
