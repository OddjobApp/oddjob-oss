import { Router } from "express";
import { codeGraphService } from "../core/code-graph.service.js";
import { xrayIntelligenceService } from "../core/xray-intelligence.service.js";
import { requireAuth } from "@domain/auth/core/security.service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("XRayRoute");
export const xrayRouter = Router();

// All code-graph routes require authentication
xrayRouter.use(requireAuth);

/**
 * Verify the caller's org owns (or has access to) the given app slug.
 * Super admins bypass the check.
 */
async function assertSlugAccess(req: any, slug: string): Promise<boolean> {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);
    if (isSuperAdmin) return true;
    if (!organizationId) return false;
    const { xrayCompositionService } = await import("../core/xray-composition.service.js");
    return xrayCompositionService.verifyScopeAccess(slug, organizationId);
}

/**
 * GET /api/xray/graph/:slug
 * Returns code graph nodes + edges for a forged app workspace.
 */
xrayRouter.get("/xray/graph/:slug", async (req: any, res) => {
    try {
        const { slug } = req.params;
        if (!await assertSlugAccess(req, slug)) return res.status(403).json({ error: "Access denied" });
        const graph = await codeGraphService.queryGraph(slug);
        res.json(graph);
    } catch (err: any) {
        logger.error(`[XRayRoute] graph query failed: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/xray/metrics/:slug
 * Returns code health metrics for a forged app workspace.
 */
xrayRouter.get("/xray/metrics/:slug", async (req: any, res) => {
    try {
        const { slug } = req.params;
        if (!await assertSlugAccess(req, slug)) return res.status(403).json({ error: "Access denied" });
        const metrics = await codeGraphService.getMetrics(slug);
        res.json(metrics);
    } catch (err: any) {
        logger.error(`[XRayRoute] metrics failed: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/xray/trace/:slug
 * Traces the impact of a specific symbol within a workspace.
 */
xrayRouter.post("/xray/trace/:slug", async (req: any, res) => {
    try {
        const { slug } = req.params;
        if (!await assertSlugAccess(req, slug)) return res.status(403).json({ error: "Access denied" });
        const { symbol } = req.body;
        if (!symbol) return res.status(400).json({ error: "Missing symbol for tracing" });
        const workspacePath = `${process.env.FORGE_WORKSPACE ?? "C:\\LocalData\\forge\\workspace"}\\${slug}`;
        const impacts = await xrayIntelligenceService.traceImpact(workspacePath, symbol);
        res.json(impacts);
    } catch (err: any) {
        logger.error(`[XRayRoute] trace failed: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/xray/index/:slug
 * Manually trigger re-indexing of a workspace. Requires org ownership of the slug.
 */
xrayRouter.post("/xray/index/:slug", async (req: any, res) => {
    try {
        const { slug } = req.params;
        if (!await assertSlugAccess(req, slug)) return res.status(403).json({ error: "Access denied" });
        await codeGraphService.indexWorkspace(slug);
        res.json({ success: true, message: `Workspace ${slug} re-indexed` });
    } catch (err: any) {
        logger.error(`[XRayRoute] index failed: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});
