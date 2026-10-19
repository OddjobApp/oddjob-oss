/**
 * Tool Discovery API Routes
 * 
 * REST API for tool discovery and dynamic tool creation.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { toolCapabilityIndex, dynamicToolCreator } from "@domain/agents/core/tool-discovery/index.js";
import { z } from "zod";

const router = Router();

// Validation schemas
const findToolsSchema = z.object({
  description: z.string(),
  requiredCapabilities: z.array(z.string()),
  inputConstraints: z.object({
    type: z.string().optional(),
    format: z.string().optional(),
    size: z.string().optional(),
  }).optional(),
  outputRequirements: z.object({
    type: z.string().optional(),
    format: z.string().optional(),
    latency: z.number().optional(),
  }).optional(),
  qualityThreshold: z.number().min(0).max(1).optional(),
});

const createToolSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  description: z.string(),
  requiredCapabilities: z.array(z.string()),
  inputDescription: z.string(),
  outputDescription: z.string(),
  examples: z.array(z.object({
    input: z.any(),
    expectedOutput: z.any(),
    explanation: z.string(),
  }).required()),
  existingToolsTried: z.array(z.string()).optional(),
  failureReasons: z.array(z.string()).optional(),
  constraints: z.object({
    maxLatencyMs: z.number().optional(),
    deterministic: z.boolean().optional(),
    requiresExternalCall: z.boolean().optional(),
  }).optional(),
});

const validateToolSchema = z.object({
  testCases: z.array(z.object({
    input: z.any(),
    expectedOutput: z.any(),
  })),
});

// ============================================================================
// TOOL DISCOVERY
// ============================================================================

/**
 * POST /api/tool-discovery/find
 * Find tools matching requirements
 */
router.post("/find", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { description, requiredCapabilities, topK = 5 } = req.body;
  
  const matches = await toolCapabilityIndex.findTools(
    { description, requiredCapabilities },
    topK
  );

  res.json({
    matches,
    count: matches.length,
    query: { description, requiredCapabilities },
  });
}));

/**
 * GET /api/tool-discovery/tools/:toolId
 * Get tool details
 */
router.get("/tools/:toolId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const tool = toolCapabilityIndex.getTool(req.params.toolId);
  if (!tool) return res.status(404).json({ error: "Tool not found" });

  res.json(tool);
}));

/**
 * GET /api/tool-discovery/tools
 * List all tools
 */
router.get("/tools", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { category } = req.query;
  
  const tools = category 
    ? toolCapabilityIndex.getToolsByCategory(category as string)
    : toolCapabilityIndex.listAllTools();

  res.json({ tools, count: tools.length });
}));

/**
 * GET /api/tool-discovery/categories/:category
 * Get tools by category
 */
router.get("/categories/:category", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const tools = toolCapabilityIndex.getToolsByCategory(req.params.category);
  res.json({ tools, count: tools.length });
}));

/**
 * GET /api/tool-discovery/capabilities/:capability
 * Get tools by capability
 */
router.get("/capabilities/:capability", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const tools = toolCapabilityIndex.getToolsByCapability(req.params.capability);
  res.json({ tools, count: tools.length });
}));

/**
 * POST /api/tool-discovery/compositions
 * Find tool compositions for complex tasks
 */
router.post("/compositions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { taskDescription, requiredSteps } = z.object({
    taskDescription: z.string(),
    requiredSteps: z.array(z.string()),
  }).parse(req.body);

  const compositions = await toolCapabilityIndex.findComposition(taskDescription, requiredSteps);

  res.json({
    compositions,
    count: compositions.length,
  });
}));

// ============================================================================
// DYNAMIC TOOL CREATION
// ============================================================================

/**
 * POST /api/tool-discovery/tools
 * Create a new dynamic tool
 */
router.post("/tools", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const data = createToolSchema.parse(req.body);
  
  const result = await dynamicToolCreator.createTool(data as any); 

  if (result.success) {
    res.status(201).json(result);
  } else {
    res.status(422).json(result);
  }
}));

/**
 * GET /api/tool-discovery/dynamic-tools
 * List dynamic tools
 */
router.get("/dynamic-tools", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { category, validationStatus, createdBy } = req.query;
  
  const tools = dynamicToolCreator.listTools({
    category: category as string,
    validationStatus: validationStatus as string,
    createdBy: createdBy as string,
  });

  res.json({ tools, count: tools.length });
}));

/**
 * GET /api/tool-discovery/dynamic-tools/:toolId
 * Get dynamic tool details
 */
router.get("/dynamic-tools/:toolId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const tool = dynamicToolCreator.getTool(req.params.toolId);
  if (!tool) return res.status(404).json({ error: "Tool not found" });

  res.json(tool);
}));

/**
 * POST /api/tool-discovery/dynamic-tools/:toolId/validate
 * Validate a dynamic tool
 */
router.post("/dynamic-tools/:toolId/validate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { testCases } = validateToolSchema.parse(req.body);
  const orgContext = await getUserOrgContext(req);
  
  const result = await dynamicToolCreator.validateTool(
    req.params.toolId,
    orgContext.userId.toString(),
    testCases as any
  );

  res.json(result);
}));

/**
 * POST /api/tool-discovery/dynamic-tools/:toolId/execute
 * Execute a dynamic tool
 */
router.post("/dynamic-tools/:toolId/execute", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { input, context } = z.object({
    input: z.any(),
    context: z.record(z.any()).optional(),
  }).parse(req.body);

  try {
    const result = await dynamicToolCreator.executeTool(req.params.toolId, input, context);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}));

/**
 * GET /api/tool-discovery/pending-validations
 * Get tools pending validation
 */
router.get("/pending-validations", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const tools = dynamicToolCreator.getPendingValidations();
  res.json({ tools, count: tools.length });
}));

// ============================================================================
// STATS & ANALYTICS
// ============================================================================

/**
 * GET /api/tool-discovery/stats
 * Get tool discovery statistics
 */
router.get("/stats", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const indexStats = toolCapabilityIndex.getStats();
  const creatorStats = dynamicToolCreator.getStats();

  res.json({
    indexed: indexStats,
    dynamic: creatorStats,
  });
}));

/**
 * GET /api/tool-discovery/tools/:toolId/performance
 * Get tool performance metrics
 */
router.get("/tools/:toolId/performance", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const tool = toolCapabilityIndex.getTool(req.params.toolId);
  if (!tool) return res.status(404).json({ error: "Tool not found" });

  res.json({
    toolId: tool.toolId,
    name: tool.name,
    performance: tool.performance,
    usageCount: tool.usageCount,
    lastUsed: tool.lastUsed,
  });
}));

export default router;
