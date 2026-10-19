/**
 * Adaptive Orchestrator API Routes
 * 
 * Unified API for all 4 advanced AI capabilities:
 * - ReAct with Reflection & Self-Correction
 * - Multi-Agent Swarming with Consensus
 * - Meta-Cognitive Planning & Self-Optimization
 * - Dynamic Tool Discovery & Creation
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { adaptiveOrchestrator, AdaptiveConfig } from "@domain/agents/core/adaptive-orchestrator.service.js";
import { z } from "zod";

const router = Router();

// Validation schemas
const executeSchema = z.object({
  agentId: z.string(),
  task: z.object({
    description: z.string(),
    goal: z.string(),
    tools: z.array(z.string()).optional(),
    complexity: z.enum(["low", "medium", "high"]),
  }),
  config: z.object({
    enableReflection: z.boolean().optional(),
    reflectionStrategies: z.array(z.string()).optional(),
    enableSwarming: z.boolean().optional(),
    swarmSize: z.number().min(2).max(10).optional(),
    consensusAlgorithm: z.enum(["simple_majority", "super_majority", "unanimous", "confidence_weighted", "bft_tolerant"]).optional(),
    enableMetaCognitive: z.boolean().optional(),
    strategyAdaptation: z.boolean().optional(),
    cognitiveMonitoring: z.boolean().optional(),
    enableToolDiscovery: z.boolean().optional(),
    autoCreateTools: z.boolean().optional(),
    crossCapabilityLearning: z.boolean().optional(),
  }).optional(),
});

const updateConfigSchema = z.object({
  config: z.object({
    enableReflection: z.boolean().optional(),
    enableSwarming: z.boolean().optional(),
    enableMetaCognitive: z.boolean().optional(),
    enableToolDiscovery: z.boolean().optional(),
  }),
});

// ============================================================================
// ADAPTIVE EXECUTION
// ============================================================================

/**
 * POST /api/adaptive/execute
 * Execute a task with all adaptive capabilities
 */
router.post("/execute", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

  const data = executeSchema.parse(req.body);
  
  const result = await adaptiveOrchestrator.execute(
    data.agentId,
    orgId,
    data.task,
    data.config
  );

  res.json(result);
}));

/**
 * GET /api/adaptive/sessions/:sessionId
 * Get session status and results
 */
router.get("/sessions/:sessionId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const context = adaptiveOrchestrator.getContext(req.params.sessionId);
  if (!context) return res.status(404).json({ error: "Session not found" });

  res.json({
    sessionId: context.sessionId,
    agentId: context.agentId,
    status: "active", // Would track actual status
    config: context.config,
    cognitiveHealth: context.cognitiveHealth,
    metrics: {
      reflections: context.reflectionCount,
      corrections: context.correctionsApplied,
      adaptations: context.strategySwitches,
      toolsDiscovered: context.toolsDiscovered,
    },
  });
}));

/**
 * PATCH /api/adaptive/sessions/:sessionId/config
 * Update session configuration mid-execution
 */
router.patch("/sessions/:sessionId/config", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { config } = updateConfigSchema.parse(req.body);
  
  const success = adaptiveOrchestrator.updateConfig(req.params.sessionId, config);
  if (!success) return res.status(404).json({ error: "Session not found" });

  res.json({ success: true });
}));

// ============================================================================
// CAPABILITY TOGGLES
// ============================================================================

/**
 * GET /api/adaptive/capabilities
 * List available capabilities and their status
 */
router.get("/capabilities", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    capabilities: [
      {
        id: "reflection",
        name: "ReAct Reflection",
        description: "Self-correction through explicit verification",
        status: "available",
      },
      {
        id: "swarming",
        name: "Multi-Agent Swarming",
        description: "Consensus-based multi-agent coordination",
        status: "available",
      },
      {
        id: "meta-cognitive",
        name: "Meta-Cognitive Planning",
        description: "Self-directed reasoning strategy selection",
        status: "available",
      },
      {
        id: "tool-discovery",
        name: "Tool Discovery",
        description: "Dynamic tool discovery and creation",
        status: "available",
      },
    ],
  });
}));

/**
 * GET /api/adaptive/capabilities/:capability/config
 * Get default configuration for a capability
 */
router.get("/capabilities/:capability/config", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const configs: Record<string, any> = {
    reflection: {
      enabled: true,
      strategies: ["factual", "logical", "consistency"],
      confidenceThreshold: 0.7,
      maxReflectionDepth: 3,
    },
    swarming: {
      enabled: false,
      defaultSize: 3,
      consensusAlgorithm: "confidence_weighted",
      minAgents: 2,
      maxAgents: 10,
    },
    "meta-cognitive": {
      enabled: true,
      strategyAdaptation: true,
      cognitiveMonitoring: true,
    },
    "tool-discovery": {
      enabled: true,
      autoCreateTools: false,
      maxMatches: 5,
    },
  };

  const config = configs[req.params.capability];
  if (!config) return res.status(404).json({ error: "Capability not found" });

  res.json(config);
}));

// ============================================================================
// ANALYTICS & STATS
// ============================================================================

/**
 * GET /api/adaptive/stats
 * Get orchestrator statistics
 */
router.get("/stats", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  const stats = adaptiveOrchestrator.getStats();
  res.json(stats);
}));

/**
 * GET /api/adaptive/sessions
 * List active sessions
 */
router.get("/sessions", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  // Would return list of active sessions from orchestrator
  res.json({
    sessions: [],
    count: 0,
  });
}));

// ============================================================================
// PRESET CONFIGURATIONS
// ============================================================================

/**
 * GET /api/adaptive/presets
 * List available configuration presets
 */
router.get("/presets", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  const presets: Array<{ id: string; name: string; description: string; config: Partial<AdaptiveConfig> }> = [
    {
      id: "fast",
      name: "Fast Execution",
      description: "Prioritize speed over thoroughness",
      config: {
        enableReflection: false,
        enableMetaCognitive: false,
        enableSwarming: false,
        enableToolDiscovery: true,
      },
    },
    {
      id: "thorough",
      name: "Thorough Analysis",
      description: "Maximum verification and self-correction",
      config: {
        enableReflection: true,
        reflectionStrategies: ["factual", "logical", "consistency", "hallucination"],
        enableMetaCognitive: true,
        enableSwarming: false,
        enableToolDiscovery: true,
      },
    },
    {
      id: "collaborative",
      name: "Collaborative",
      description: "Use multi-agent swarming for complex tasks",
      config: {
        enableReflection: true,
        enableMetaCognitive: true,
        enableSwarming: true,
        swarmSize: 5,
        consensusAlgorithm: "confidence_weighted",
        enableToolDiscovery: true,
      },
    },
    {
      id: "adaptive",
      name: "Fully Adaptive",
      description: "Enable all capabilities",
      config: {
        enableReflection: true,
        enableMetaCognitive: true,
        enableSwarming: true,
        enableToolDiscovery: true,
        autoCreateTools: true,
        crossCapabilityLearning: true,
      },
    },
  ];

  res.json({ presets, count: presets.length });
}));

/**
 * GET /api/adaptive/presets/:presetId
 * Get specific preset configuration
 */
router.get("/presets/:presetId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const presets: Record<string, any> = {
    fast: {
      enableReflection: false,
      enableMetaCognitive: false,
      enableSwarming: false,
      enableToolDiscovery: true,
    },
    thorough: {
      enableReflection: true,
      reflectionStrategies: ["factual", "logical", "consistency", "hallucination"],
      enableMetaCognitive: true,
      enableSwarming: false,
      enableToolDiscovery: true,
    },
    collaborative: {
      enableReflection: true,
      enableMetaCognitive: true,
      enableSwarming: true,
      swarmSize: 5,
      consensusAlgorithm: "confidence_weighted",
      enableToolDiscovery: true,
    },
    adaptive: {
      enableReflection: true,
      enableMetaCognitive: true,
      enableSwarming: true,
      enableToolDiscovery: true,
      autoCreateTools: true,
      crossCapabilityLearning: true,
    },
  };

  const preset = presets[req.params.presetId];
  if (!preset) return res.status(404).json({ error: "Preset not found" });

  res.json(preset);
}));

export default router;
