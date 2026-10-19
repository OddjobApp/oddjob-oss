import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { analyticsService } from "@domain/admin/core/analytics.service.js";
import { integrationAnalyticsService } from "../domain/analytics/core/integration-analytics.js";
import { roiService } from "../domain/analytics/core/roi.service.js";
import { cacheService } from "../domain/core/cache-service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { ErrorCode, BadRequestError, UnauthorizedError } from "@server/utils/errors.js";
import { pipelineService } from "../domain/pipeline/core/pipeline.service.js";
import { DemoSeedService } from "../domain/admin/demo-seed.service.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";

const router = Router();
const logger = createLogger("AnalyticsRoutes");

// Helper for dashboard cache key (session has userId; orgId from query for super-admin org switch)
const getDashboardCacheKey = (req: Request) => {
    const userId = (req.session as any)?.userId || 'anon';
    const orgId = req.query?.orgId ? String(req.query.orgId) : 'default';
    return `dashboard:${req.path}:${userId}:${orgId}`;
};

// GET /stats - Dashboard analytics
router.get("/stats", requireAuth, cacheService.middleware({
    keyGenerator: getDashboardCacheKey,
    ttl: 30 // 30 second cache for dashboard stats
}), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const stats = await analyticsService.getDashboardStats(orgContext);
    res.json(stats);
}));

// GET /insights - Proactive Insights
router.get("/insights", requireAuth, cacheService.middleware({
    keyGenerator: getDashboardCacheKey,
    ttl: 60 // 1 minute cache for insights
}), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    // @ts-ignore - Added via Object.assign
    const insights = await analyticsService.getDashboardInsights(orgContext);
    res.json(insights);
}));

// GET /timeline - Audit Timeline
router.get("/timeline", requireAuth, cacheService.middleware({
    keyGenerator: getDashboardCacheKey,
    ttl: 15 // 15 second cache for the timeline
}), asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    // @ts-ignore - Added via Object.assign
    const timeline = await analyticsService.getAuditTimeline(orgContext);
    res.json(timeline);
}));

// POST /api/analytics/usage
router.post("/usage", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.session as any)?.userId;
    if (!userId) throw new UnauthorizedError("Required");

    const {
        pipelineId, executionId, stepExecutionId, provider, model,
        promptTokens, completionTokens, metadata
    } = req.body;

    if (!provider || !model) {
        throw new BadRequestError("Provider and model required", {}, ErrorCode.VALIDATION_FAILED);
    }

    let organizationId = null;
    if (pipelineId) {
        try {
            // We use a internal version or just query the service
            const orgContext = await getUserOrgContext(req);
            const pipeline = await pipelineService.getById(pipelineId, orgContext);
            organizationId = pipeline?.organizationId || null;
        } catch (e) {
            // If not found or not authorized, organizationId stays null
        }
    }

    await analyticsService.logAIUsage({
        pipelineId, userId, executionId, stepExecutionId, provider, model,
        promptTokens, completionTokens, metadata, organizationId
    });

    res.status(201).json({ status: "recorded" });
}));

// GET /api/analytics/cache-stats
router.get("/cache-stats", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const { cacheService } = await import("../domain/core/cache-service.js");
    const { redis } = await import("../domain/core/infrastructure/redis/redis-client.js");

    // Exact-match Redis stats
    const redisInfo = await redis.info("stats").catch(() => "");
    const keyspaceHits = parseInt(redisInfo.match(/keyspace_hits:(\d+)/)?.[1] || "0");
    const keyspaceMisses = parseInt(redisInfo.match(/keyspace_misses:(\d+)/)?.[1] || "0");
    const exactHitRate = keyspaceHits + keyspaceMisses > 0
        ? Math.round((keyspaceHits / (keyspaceHits + keyspaceMisses)) * 1000) / 10
        : null;

    // Semantic cache collection size
    let semanticPoints = 0;
    try {
        const { getClient } = await import("../integrations/qdrant-client.js");
        const qdrant = getClient();
        const info = await qdrant.getCollection("llm_semantic_cache").catch(() => null);
        semanticPoints = info?.points_count ?? 0;
    } catch { /* qdrant may not be available */ }

    res.json({
        exactCache: { hits: keyspaceHits, misses: keyspaceMisses, hitRatePct: exactHitRate },
        semanticCache: { storedEntries: semanticPoints, similarityThreshold: 0.985 },
    });
}));

router.get("/cost-dashboard", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    let stats = await analyticsService.getCostDashboardStats(orgContext);

    // Demo figures are served ONLY when someone asks for them — an explicit
    // ?demo=true, or the org's demo_mode flag.
    //
    // There used to be a third trigger: `isEmpty`. An organization that had
    // simply not spent anything was shown DemoSeedService's invented numbers —
    // roughly $1,845 a month of fabricated spend — as its own fiscal data,
    // under the page's "AUDIT OK" badge. Zero spend is a true and useful
    // answer, and substituting a plausible-looking one for it is the worst
    // possible response on a page whose whole purpose is telling you what you
    // are spending. The empty state belongs to the UI, not to a seed service.
    const isRedisDemo = orgContext.organizationId
        ? (await redis.get(`org:${orgContext.organizationId}:demo_mode`)) === "true"
        : false;
    if (req.query.demo === "true" || isRedisDemo) {
        stats = {
            ...DemoSeedService.getCostDashboardStats(),
            demo: true,
        } as any;
        logger.info(
            `Serving DEMO cost figures for org ${orgContext.organizationId} ` +
                `(${req.query.demo === "true" ? "?demo=true" : "org demo_mode"}). ` +
                `These are invented, not measured.`,
        );
    }
    res.json(stats);
}));

// GET /api/analytics/:platform/stats
router.get("/:platform/stats", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const { platform } = req.params;

    if (!platform) throw new BadRequestError("Platform is required");
    if (!orgContext.organizationId) throw new BadRequestError("Organization context required");

    const stats = await integrationAnalyticsService.getIntegrationStats(
        orgContext.organizationId,
        platform
    );

    res.json(stats);
}));

// GET /api/analytics/saas/overview
router.get("/saas/overview", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) throw new BadRequestError("Organization context required");

    const overview = await integrationAnalyticsService.getDashboardOverview(orgContext.organizationId);
    res.json(overview);
}));

// GET /api/analytics/roi
// Returns high-level ROI metrics
router.get("/roi", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    // This route resolved no org context at all, so the figures it returned were
    // platform-wide while the page around them named a single organization.
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) throw new BadRequestError("Organization context required");
    const timeframe = req.query.days ? parseInt(req.query.days as string) : 30;
    const metrics = await roiService.getSystemROI(orgContext.organizationId, timeframe);
    res.json(metrics);
}));

// GET /api/analytics/roi/trend
// Returns daily trend data for charts
router.get("/roi/trend", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) throw new BadRequestError("Organization context required");
    const timeframe = req.query.days ? parseInt(req.query.days as string) : 30;
    const trend = await roiService.getTrendData(orgContext.organizationId, timeframe);
    res.json(trend);
}));

// GET /api/analytics/saas/metrics
router.get("/usage", requireAuth, asyncHandler(async (req: any, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const userId = req.user?.id;

    if (!orgContext.organizationId) {
        throw new BadRequestError("Organization context required");
    }

    // Get pipeline info through service
    const pipelines = await pipelineService.list(orgContext);

    // Filter or aggregate usage based on pipelines
    // (Simplified for refactor)
    res.json({
        pipelinesCount: pipelines.length,
        usage: []
    });
}));

export function registerAnalyticsRoutes(app: any) {
    app.use("/api/analytics", router);
    // Properly mount dashboard routes on their own router path
    app.use("/api/dashboard", router);
}

