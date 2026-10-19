/**
 * Blueprint Evolution API Routes
 * 
 * Endpoints for blueprint self-improvement and evolution.
 */
import { Router } from "express";
import { blueprintEvolutionService } from "./core/blueprint-evolution.service.js";
import { createLogger } from "@server/utils/logger.js";

const router = Router();
const logger = createLogger("BlueprintEvolutionRoutes");

/**
 * GET /api/blueprints/:blueprintId/metrics
 * Get blueprint metrics
 */
router.get("/:blueprintId/metrics", async (req, res) => {
  try {
    const { blueprintId } = req.params;
    
    const metrics = await blueprintEvolutionService.collectMetrics(blueprintId);
    
    res.json(metrics);
  } catch (error) {
    logger.error("[BlueprintEvolutionAPI] Error getting metrics:", error);
    res.status(500).json({
      error: "Failed to get metrics",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/blueprints/:blueprintId/suggestions
 * Get evolution suggestions
 */
router.get("/:blueprintId/suggestions", async (req, res) => {
  try {
    const { blueprintId } = req.params;
    
    const suggestions = await blueprintEvolutionService.generateSuggestions(blueprintId);
    
    res.json({
      blueprintId,
      suggestions,
      count: suggestions.length
    });
  } catch (error) {
    logger.error("[BlueprintEvolutionAPI] Error generating suggestions:", error);
    res.status(500).json({
      error: "Failed to generate suggestions",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/blueprints/:blueprintId/evolve
 * Create a new evolution generation
 */
router.post("/:blueprintId/evolve", async (req, res) => {
  try {
    const { blueprintId } = req.params;
    const { suggestion, author } = req.body;
    
    if (!suggestion) {
      return res.status(400).json({ error: "suggestion required" });
    }

    const generation = await blueprintEvolutionService.evolveBlueprint(
      blueprintId,
      suggestion,
      author || "system"
    );

    res.status(201).json(generation);
  } catch (error) {
    logger.error("[BlueprintEvolutionAPI] Error evolving blueprint:", error);
    res.status(500).json({
      error: "Failed to evolve blueprint",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/blueprints/:blueprintId/generations
 * Get evolution history
 */
router.get("/:blueprintId/generations", (req, res) => {
  try {
    const { blueprintId } = req.params;
    
    const generations = blueprintEvolutionService.getEvolutionHistory(blueprintId);
    
    res.json({
      blueprintId,
      generations,
      count: generations.length
    });
  } catch (error) {
    logger.error("[BlueprintEvolutionAPI] Error getting generations:", error);
    res.status(500).json({
      error: "Failed to get generations",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/blueprints/:blueprintId/latest-approved
 * Get latest approved generation
 */
router.get("/:blueprintId/latest-approved", (req, res) => {
  try {
    const { blueprintId } = req.params;
    
    const generation = blueprintEvolutionService.getLatestApprovedGeneration(blueprintId);
    
    if (!generation) {
      return res.status(404).json({ error: "No approved generation found" });
    }
    
    res.json(generation);
  } catch (error) {
    logger.error("[BlueprintEvolutionAPI] Error getting latest generation:", error);
    res.status(500).json({
      error: "Failed to get latest generation",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/blueprints/:blueprintId/compare
 * Compare two generations
 */
router.get("/:blueprintId/compare", async (req, res) => {
  try {
    const { blueprintId } = req.params;
    const { gen1, gen2 } = req.query;
    
    if (!gen1 || !gen2) {
      return res.status(400).json({ error: "gen1 and gen2 query params required" });
    }

    const comparison = await blueprintEvolutionService.compareGenerations(
      blueprintId,
      gen1 as string,
      gen2 as string
    );

    res.json(comparison);
  } catch (error) {
    logger.error("[BlueprintEvolutionAPI] Error comparing generations:", error);
    res.status(500).json({
      error: "Failed to compare generations",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/blueprints/generations/:generationId/approve
 * Approve or reject a generation
 */
router.post("/generations/:generationId/approve", async (req, res) => {
  try {
    const { generationId } = req.params;
    const { approved } = req.body;
    
    if (typeof approved !== "boolean") {
      return res.status(400).json({ error: "approved boolean required" });
    }

    await blueprintEvolutionService.approveGeneration(generationId, approved);

    res.json({
      success: true,
      generationId,
      approved,
      message: approved ? "Generation approved" : "Generation rejected"
    });
  } catch (error) {
    logger.error("[BlueprintEvolutionAPI] Error approving generation:", error);
    res.status(500).json({
      error: "Failed to approve generation",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
