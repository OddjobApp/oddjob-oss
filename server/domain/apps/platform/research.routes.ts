import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { createLogger } from "@server/utils/logger.js";
import {
    ingestionOrchestratorService,
    progressEmitterService,
    type ResearchSubjectInput,
} from "@domain/knowledge/core/ingestion/index.js";
import type { OrgContext } from "@server/utils/auth-context.js";

/**
 * App-platform gateway for the research/ingestion feature.
 *
 * The embedded research-workbench app calls /api/oddjob/research/* which its
 * Next.js layer proxies to /api/platform/app/research/* with an app-deployment
 * token. The underlying research handlers otherwise live at /api/research behind
 * a human session (requireAuth), so they aren't reachable with an app token —
 * this router re-exposes them under the app gateway using requireAppToken.
 *
 * App tokens are scoped to a single org, so we build an org-scoped, NON-super
 * context (isSuperAdmin: false). The ingestion service filters strictly by
 * organizationId, which keeps every read/write bound to the token's tenant.
 */
const router = Router();
const logger = createLogger("AppPlatformResearchRoute");

function appTokenOrgContext(req: Request): OrgContext {
    const { orgId } = req.appTokenContext!;
    return {
        userId: "system",
        organizationId: orgId,
        isAdmin: false,
        isSuperAdmin: false,
        isOrgAdmin: true,
    };
}

// POST /api/platform/app/research/classify
router.post("/classify", requireAppToken("knowledge"), asyncHandler(async (req: Request, res: Response) => {
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
        res.status(err.status || 400).json({
            error: err.message || "Classification failed",
            suggestion: err.suggestion || "Try a different input",
        });
    }
}));

// POST /api/platform/app/research/strategy
router.post("/strategy", requireAppToken("knowledge"), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = appTokenOrgContext(req);
    const { value, maxSources, tokenBudget, enabledCollectors } = req.body;
    if (!value || typeof value !== "string") {
        return res.status(400).json({
            error: "value is required and must be a string",
            suggestion: "Provide a research subject (topic or URL)",
        });
    }
    const options: ResearchSubjectInput = { value, maxSources, tokenBudget, enabledCollectors };
    const classifiedInput = await ingestionOrchestratorService.classifyInput(value);
    const strategy = await ingestionOrchestratorService.generateStrategy(classifiedInput, orgContext, options);
    res.json(strategy);
}));

// POST /api/platform/app/research/execute
router.post("/execute", requireAppToken("knowledge"), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = appTokenOrgContext(req);
    const { strategy } = req.body;
    if (!strategy) {
        return res.status(400).json({
            error: "strategy object is required",
            suggestion: "Generate a strategy first via POST research/strategy",
        });
    }
    const result = await ingestionOrchestratorService.execute(strategy, orgContext);
    res.json(result);
}));

// GET /api/platform/app/research/runs
router.get("/runs", requireAppToken("knowledge"), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = appTokenOrgContext(req);
    const limit = parseInt(req.query.limit as string) || 20;
    const runs = await ingestionOrchestratorService.listRuns(orgContext, limit);
    res.json(runs);
}));

// GET /api/platform/app/research/runs/:executionId
router.get("/runs/:executionId", requireAppToken("knowledge"), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = appTokenOrgContext(req);
    const executionId = parseInt(req.params.executionId);
    if (isNaN(executionId)) return res.status(400).json({ error: "Invalid executionId" });
    const status = await ingestionOrchestratorService.getStatus(executionId, orgContext);
    res.json(status);
}));

// DELETE /api/platform/app/research/runs/:executionId
router.delete("/runs/:executionId", requireAppToken("knowledge"), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = appTokenOrgContext(req);
    const executionId = parseInt(req.params.executionId);
    if (isNaN(executionId)) return res.status(400).json({ error: "Invalid executionId" });
    await ingestionOrchestratorService.deleteRun(executionId, orgContext);
    res.json({ success: true });
}));

// POST /api/platform/app/research/runs/:executionId/rerun
router.post("/runs/:executionId/rerun", requireAppToken("knowledge"), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = appTokenOrgContext(req);
    const executionId = parseInt(req.params.executionId);
    if (isNaN(executionId)) return res.status(400).json({ error: "Invalid executionId" });
    const { overrides } = req.body || {};
    const result = await ingestionOrchestratorService.rerun(executionId, overrides || {}, orgContext);
    res.json(result);
}));

// GET /api/platform/app/research/runs/:executionId/progress  (SSE)
router.get("/runs/:executionId/progress", requireAppToken("knowledge"), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = appTokenOrgContext(req);
    const executionId = parseInt(req.params.executionId);
    if (isNaN(executionId)) return res.status(400).json({ error: "Invalid executionId" });

    // Verify org-scoped access before streaming.
    await ingestionOrchestratorService.getStatus(executionId, orgContext);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: "connected", pipelineExecutionId: executionId })}\n\n`);

    const listener = (event: any) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === "ingestion.completed" || event.type === "ingestion.failed") {
            setTimeout(() => res.end(), 100);
        }
    };
    progressEmitterService.subscribe(executionId, listener);
    req.on("close", () => {
        progressEmitterService.unsubscribe(executionId, listener);
        logger.info("SSE client disconnected", { executionId });
    });
}));

export { router as researchRouter };
