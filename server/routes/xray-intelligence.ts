import { Router, type Request, type Response } from "express";
import { xrayIntelligenceService } from "../domain/xray/core/xray-intelligence.service.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../domain/auth/core/security.service.js";
import { FORGE_WORKSPACE_ROOT } from "../domain/apps/core/forge-paths.js";

export const xrayIntelligenceRouter = Router();
xrayIntelligenceRouter.use(requireAuth);

/**
 * GET /api/xray/find
 * Fuzzy search for symbols across all forged applications.
 */
xrayIntelligenceRouter.get("/find", asyncHandler(async (req: Request, res: Response) => {
    const query = req.query.q as string;
    if (!query) {
        return res.json([]);
    }

    // Default to the main Forge workspace if no specific path provided
    // In a real multi-tenant scenario, we'd scope this to the user's organization
    const forgePath = FORGE_WORKSPACE_ROOT;
    
    const results = await xrayIntelligenceService.findSymbols(forgePath, query);
    res.json(results);
}));

/**
 * GET /api/xray/interface
 * Extract the interface skeleton for a specific file.
 */
xrayIntelligenceRouter.get("/interface", asyncHandler(async (req: Request, res: Response) => {
    const filePath = req.query.path as string;
    if (!filePath) {
        return res.status(400).json({ error: "Path is required" });
    }

    const forgePath = FORGE_WORKSPACE_ROOT;
    const symbols = await xrayIntelligenceService.extractAllSymbols(forgePath);
    
    // Filter to specific file
    const filtered = symbols.filter(s => s.filePath === filePath);
    res.json(filtered);
}));

/**
 * POST /api/xray/propagation
 * Predicts which files are likely to break when a given file breaks, blending
 * dependency-graph reachability with historical co-failure.
 */
xrayIntelligenceRouter.post("/propagation", asyncHandler(async (req: Request, res: Response) => {
    const { filePath, maxDepth, lookbackDays, coFailureWindowMinutes } = req.body ?? {};
    if (!filePath || typeof filePath !== "string") {
        return res.status(400).json({ error: "filePath is required" });
    }

    const { failurePropagationService } = await import(
        "../domain/self-improvement/failure-propagation.service.js"
    );

    const forecast = await failurePropagationService.predictPropagation(filePath, {
        repoRoot: process.cwd(),
        maxDepth,
        lookbackDays,
        coFailureWindowMinutes,
        // Failure history is tenant-scoped; the dependency graph is not
        // (the repo is the same for every tenant).
        organizationId: (req as any).organizationId ?? null,
    });

    res.json(forecast);
}));

/**
 * GET /api/xray/impact
 * Traces the structural impact of a given symbol.
 */
xrayIntelligenceRouter.post("/impact", asyncHandler(async (req: Request, res: Response) => {
    const { symbol } = req.body;
    if (!symbol) {
        return res.status(400).json({ error: "Symbol is required" });
    }

    const forgePath = FORGE_WORKSPACE_ROOT;
    const impactResults = await xrayIntelligenceService.traceImpact(forgePath, symbol);
    res.json(impactResults);
}));
