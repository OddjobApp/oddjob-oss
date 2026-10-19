/**
 * Execution Flow API Routes
 * 
 * REST API for capturing and retrieving execution flow diagrams.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { executionFlowService } from "@domain/agents/core/execution-visualizer/index.js";
import { z } from "zod";

const router = Router();

// Validation schemas
const startFlowSchema = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  layout: z.enum(["horizontal", "vertical", "auto"]).optional(),
  showDetails: z.boolean().optional(),
});

const recordStepSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  strategy: z.string().optional(),
});

const recordDecisionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
  choice: z.enum(["yes", "no"]),
  confidence: z.number().optional(),
});

const completeFlowSchema = z.object({
  success: z.boolean(),
  output: z.any().optional(),
});

// ============================================================================
// FLOW MANAGEMENT
// ============================================================================

/**
 * POST /api/execution-flow/start
 * Start a new execution flow
 */
router.post("/start", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = orgContext.organizationId;
  if (!orgId) return res.status(400).json({ error: "Organization required" });

  const { sessionId, agentId, layout, showDetails } = startFlowSchema.parse(req.body);

  const flow = executionFlowService.startFlow(sessionId, agentId, orgId, {
    layout,
    showDetails,
  });

  res.status(201).json({
    flowId: flow.id,
    sessionId: flow.sessionId,
    agentId: flow.agentId,
    status: flow.status,
  });
}));

/**
 * GET /api/execution-flow/:sessionId
 * Get active flow by session ID
 */
router.get("/:sessionId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const flow = executionFlowService.getFlow(req.params.sessionId);
  
  if (!flow) {
    return res.status(404).json({ error: "Flow not found" });
  }

  res.json(flow);
}));

/**
 * POST /api/execution-flow/:sessionId/complete
 * Complete an execution flow
 */
router.post("/:sessionId/complete", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { success, output } = completeFlowSchema.parse(req.body);

  const flow = executionFlowService.completeFlow(req.params.sessionId, { success, output });
  
  if (!flow) {
    return res.status(404).json({ error: "Flow not found" });
  }

  res.json({
    flowId: flow.id,
    status: flow.status,
    stats: flow.stats,
  });
}));

// ============================================================================
// EVENT RECORDING
// ============================================================================

/**
 * POST /api/execution-flow/:sessionId/step
 * Record a step execution
 */
router.post("/:sessionId/step", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const data = recordStepSchema.parse(req.body);

  const node = executionFlowService.recordStep(req.params.sessionId, data);
  
  if (!node) {
    return res.status(404).json({ error: "Flow not found" });
  }

  res.json({ nodeId: node.id, timestamp: node.timestamp });
}));

/**
 * POST /api/execution-flow/:sessionId/decision
 * Record a decision point
 */
router.post("/:sessionId/decision", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const data = recordDecisionSchema.parse(req.body);

  const result = executionFlowService.recordDecision(req.params.sessionId, data);
  
  if (!result) {
    return res.status(404).json({ error: "Flow not found" });
  }

  res.json({
    yesNodeId: result.yesNode.id,
    noNodeId: result.noNode.id,
  });
}));

/**
 * POST /api/execution-flow/:sessionId/reflection
 * Record a reflection event
 */
router.post("/:sessionId/reflection", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const data = z.object({
    issuesFound: z.number(),
    confidence: z.number(),
    passed: z.boolean(),
  }).parse(req.body);

  const node = executionFlowService.recordReflection(req.params.sessionId, data);
  
  if (!node) {
    return res.status(404).json({ error: "Flow not found" });
  }

  res.json({ nodeId: node.id });
}));

/**
 * POST /api/execution-flow/:sessionId/correction
 * Record a correction event
 */
router.post("/:sessionId/correction", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const data = z.object({
    success: z.boolean(),
    strategy: z.string(),
  }).parse(req.body);

  const node = executionFlowService.recordCorrection(req.params.sessionId, data);
  
  if (!node) {
    return res.status(404).json({ error: "Flow not found" });
  }

  res.json({ nodeId: node.id });
}));

/**
 * POST /api/execution-flow/:sessionId/tool-call
 * Record a tool call
 */
router.post("/:sessionId/tool-call", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const data = z.object({
    toolName: z.string(),
    success: z.boolean(),
    durationMs: z.number(),
  }).parse(req.body);

  const node = executionFlowService.recordToolCall(req.params.sessionId, data);
  
  if (!node) {
    return res.status(404).json({ error: "Flow not found" });
  }

  res.json({ nodeId: node.id });
}));

/**
 * POST /api/execution-flow/:sessionId/adaptation
 * Record a strategy adaptation
 */
router.post("/:sessionId/adaptation", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const data = z.object({
    fromStrategy: z.string(),
    toStrategy: z.string(),
    reason: z.string(),
  }).parse(req.body);

  const node = executionFlowService.recordAdaptation(req.params.sessionId, data);
  
  if (!node) {
    return res.status(404).json({ error: "Flow not found" });
  }

  res.json({ nodeId: node.id });
}));

/**
 * POST /api/execution-flow/:sessionId/error
 * Record an error
 */
router.post("/:sessionId/error", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const data = z.object({
    message: z.string(),
    recoverable: z.boolean(),
  }).parse(req.body);

  const node = executionFlowService.recordError(req.params.sessionId, data);
  
  if (!node) {
    return res.status(404).json({ error: "Flow not found" });
  }

  res.json({ nodeId: node.id });
}));

// ============================================================================
// EXPORT
// ============================================================================

/**
 * GET /api/execution-flow/:flowId/export
 * Export flow to various formats
 */
router.get("/:flowId/export", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { format } = z.object({
    format: z.enum(["json", "mermaid", "dot"]),
  }).parse(req.query);

  const result = executionFlowService.exportFlow(req.params.flowId, format);
  
  if (!result) {
    return res.status(404).json({ error: "Flow not found" });
  }

  if (format === "json") {
    res.json(result);
  } else {
    res.set("Content-Type", "text/plain");
    res.send(result);
  }
}));

// ============================================================================
// HISTORY & STATS
// ============================================================================

/**
 * GET /api/execution-flow/agents/:agentId/history
 * Get flow history for an agent
 */
router.get("/agents/:agentId/history", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  
  const history = executionFlowService.getFlowHistory(req.params.agentId, limit);

  res.json({
    flows: history,
    count: history.length,
  });
}));

/**
 * GET /api/execution-flow/stats
 * Get service statistics
 */
router.get("/stats", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  const stats = executionFlowService.getStats();
  res.json(stats);
}));

export default router;
