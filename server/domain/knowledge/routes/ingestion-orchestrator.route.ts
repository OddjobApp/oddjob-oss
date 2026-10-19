import { Router, type Request, type Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { ingestionOrchestratorService, progressEmitterService } from "../core/ingestion/index.js";
import type { ResearchSubjectInput } from "../core/ingestion/index.js";

const router = Router();
const logger = createLogger("IngestionOrchestratorRoute");

// POST /api/research/classify
// Body: { input: string }
// Response: ClassifiedInput | { error: string, suggestion: string }
router.post("/classify", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { input } = req.body;

  if (!input || typeof input !== "string") {
    return res.status(400).json({
      error: "Input is required and must be a string",
      suggestion: "Provide a research topic or paste a URL",
    });
  }

  try {
    const classified = await ingestionOrchestratorService.classifyInput(input);
    res.json(classified);
  } catch (err: any) {
    const status = err.status || 400;
    res.status(status).json({
      error: err.message || "Classification failed",
      suggestion: err.suggestion || "Try a different input",
    });
  }
}));

// POST /api/research/strategy
// Body: ResearchSubjectInput
// Response: GatheringStrategy
router.post("/strategy", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const { value, maxSources, tokenBudget, enabledCollectors } = req.body;

  if (!value || typeof value !== "string") {
    return res.status(400).json({
      error: "value is required and must be a string",
      suggestion: "Provide a research subject (topic or URL)",
    });
  }

  const options: ResearchSubjectInput = {
    value,
    maxSources,
    tokenBudget,
    enabledCollectors,
  };

  // Classify the input first
  const classifiedInput = await ingestionOrchestratorService.classifyInput(value);

  // Generate strategy
  const strategy = await ingestionOrchestratorService.generateStrategy(
    classifiedInput,
    orgContext,
    options,
  );

  res.json(strategy);
}));

// POST /api/research/execute
// Body: { strategyId: string, adjustments?: Partial<ResearchSubjectInput> }
// Response: IngestionOrchestrationResult
router.post("/execute", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const { strategyId, strategy, adjustments } = req.body;

  if (!strategy) {
    return res.status(400).json({
      error: "strategy object is required",
      suggestion: "Generate a strategy first via POST /api/research/strategy",
    });
  }

  const result = await ingestionOrchestratorService.execute(strategy, orgContext);
  res.json(result);
}));

// GET /api/research/runs
// Query: ?limit=20&offset=0
// Response: IngestionRunSummary[]
router.get("/runs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const limit = parseInt(req.query.limit as string) || 20;

  const runs = await ingestionOrchestratorService.listRuns(orgContext, limit);
  res.json(runs);
}));

// GET /api/research/runs/:executionId
// Response: IngestionRunStatus
router.get("/runs/:executionId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const executionId = parseInt(req.params.executionId);

  if (isNaN(executionId)) {
    return res.status(400).json({ error: "Invalid executionId" });
  }

  const status = await ingestionOrchestratorService.getStatus(executionId, orgContext);
  res.json(status);
}));

// DELETE /api/research/runs/:executionId
// Response: { success: boolean }
router.delete("/runs/:executionId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const executionId = parseInt(req.params.executionId);

  if (isNaN(executionId)) {
    return res.status(400).json({ error: "Invalid executionId" });
  }

  await ingestionOrchestratorService.deleteRun(executionId, orgContext);
  res.json({ success: true });
}));

// POST /api/research/runs/:executionId/rerun
// Body: { overrides?: Partial<ResearchSubjectInput> }
// Response: IngestionOrchestrationResult
router.post("/runs/:executionId/rerun", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const executionId = parseInt(req.params.executionId);

  if (isNaN(executionId)) {
    return res.status(400).json({ error: "Invalid executionId" });
  }

  const { overrides } = req.body || {};
  const result = await ingestionOrchestratorService.rerun(executionId, overrides || {}, orgContext);
  res.json(result);
}));

// GET /api/research/runs/:executionId/progress
// Response: SSE stream of IngestionProgressEvent
router.get("/runs/:executionId/progress", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const executionId = parseInt(req.params.executionId);

  if (isNaN(executionId)) {
    return res.status(400).json({ error: "Invalid executionId" });
  }

  // Verify access to the execution
  await ingestionOrchestratorService.getStatus(executionId, orgContext);

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: "connected", pipelineExecutionId: executionId })}\n\n`);

  // Subscribe to progress events
  const listener = (event: any) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);

    // Close the connection on terminal events
    if (event.type === "ingestion.completed" || event.type === "ingestion.failed") {
      setTimeout(() => {
        res.end();
      }, 100);
    }
  };

  progressEmitterService.subscribe(executionId, listener);

  // Clean up on client disconnect
  req.on("close", () => {
    progressEmitterService.unsubscribe(executionId, listener);
    logger.info("SSE client disconnected", { executionId });
  });
}));

export default router;
