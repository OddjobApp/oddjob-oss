import { Router, Request, Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { db } from "@server/database_service.js";
import { CyclePredictiveService } from "../domain/mission/core/cycle-predictive.service.js";
import { CycleAnalyticsService, type PredictiveMetrics } from "../domain/mission/core/cycle-analytics.service.js";
import { createLogger } from "@server/utils/logger.js";
import { operationalCycles, missionRuns, aiUsageLogs } from "@shared/schema/index.js";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { sidecarFetch, sidecarConfigured } from "@server/integrations/sidecar-client.js";

const router = Router();
const logger = createLogger("PredictiveProxy");
const SIDECAR_TIMEOUT_MS = 3000;
const ACTIVE_CYCLE_STATUSES = new Set(["planning", "pending_approval", "active", "paused", "reviewing"]);

let monitoringEnabled = true;
let serviceMode = "monitoring";

function clamp(value: number, min = 0, max = 1): number {
    return Math.max(min, Math.min(max, value));
}

function getScopedOrgId(req: Request): number {
    const value = (req as any).organizationId ?? (req as any).user?.defaultOrgId;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        throw Object.assign(new Error("Organization context required"), { status: 403 });
    }
    return parsed;
}

async function isSidecarHealthy(): Promise<boolean> {
    try {
        if (!sidecarConfigured()) return false;
        const res = await sidecarFetch("/health", { timeoutMs: SIDECAR_TIMEOUT_MS });
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * The sidecar's predictive engine keeps its state in process memory, across
 * every organization: it is platform analytics, so only a platform super
 * administrator may reach it. Everyone else is answered by the
 * organization-scoped routes in this file.
 */
async function proxySidecar(req: Request, res: Response): Promise<boolean> {
    const context = await getUserOrgContext(req);
    if (!context.isSuperAdmin) {
        res.status(403).json({ message: "Platform administrator required" });
        return true;
    }
    if (!sidecarConfigured()) return false;
    try {
        const response = await sidecarFetch(req.originalUrl, {
            method: req.method as any,
            body: ["POST", "PUT", "PATCH"].includes(req.method) ? req.body : undefined,
            timeoutMs: SIDECAR_TIMEOUT_MS,
        });
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
            res.status(response.status).json(await response.json());
        } else {
            res.status(response.status).send(await response.text());
        }
        return true;
    } catch (err: any) {
        logger.warn(`[PredictiveProxy] Sidecar unreachable (${req.method} ${req.path}): ${err.message}`);
        return false;
    }
}

async function getCyclesForOrg(orgId: number, limit = 20) {
    return db.select()
        .from(operationalCycles)
        .where(and(eq(operationalCycles.organizationId, orgId), isNull(operationalCycles.deletedAt)))
        .orderBy(desc(operationalCycles.updatedAt))
        .limit(limit);
}

async function getResourceSnapshot(orgId: number) {
    const cycles = await getCyclesForOrg(orgId, 200);
    const activeCycles = cycles.filter(cycle => ACTIVE_CYCLE_STATUSES.has(String(cycle.status)));
    const totalBudget = activeCycles.reduce((sum, cycle) => sum + parseFloat(String(cycle.budgetLimitUsd || 0)), 0);
    const currentCycleSpend = activeCycles.reduce((sum, cycle) => sum + parseFloat(String(cycle.currentSpendUsd || 0)), 0);

    const [runAgg] = await db.select({
        totalRuns: sql<number>`count(*)::int`,
        completedRuns: sql<number>`count(*) filter (where ${missionRuns.status} = 'completed')::int`,
        failedRuns: sql<number>`count(*) filter (where ${missionRuns.status} = 'failed')::int`,
        activeRuns: sql<number>`count(*) filter (where ${missionRuns.status} in ('active', 'paused', 'waiting_on_human', 'waiting_on_file'))::int`,
    })
        .from(missionRuns)
        .where(and(eq(missionRuns.organizationId, orgId), isNull(missionRuns.deletedAt)));

    const [usageAgg] = await db.select({
        totalCost: sql<string>`coalesce(sum(${aiUsageLogs.costUsd}::numeric), 0)`,
        totalTokens: sql<string>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`,
    })
        .from(aiUsageLogs)
        .where(eq(aiUsageLogs.organizationId, orgId));

    const totalSpend = Math.max(currentCycleSpend, parseFloat(String(usageAgg?.totalCost ?? 0)));
    const budgetUsage = totalBudget > 0 ? clamp(totalSpend / totalBudget, 0, 2) * 100 : 0;
    const totalRuns = runAgg?.totalRuns ?? 0;
    const failedRuns = runAgg?.failedRuns ?? 0;
    const reliability = totalRuns > 0 ? ((runAgg?.completedRuns ?? 0) / totalRuns) * 100 : 100;

    return {
        cycles,
        activeCycles,
        totalBudget,
        totalSpend,
        budgetUsage,
        totalTokens: parseInt(String(usageAgg?.totalTokens ?? 0), 10),
        totalRuns,
        completedRuns: runAgg?.completedRuns ?? 0,
        failedRuns,
        activeRuns: runAgg?.activeRuns ?? 0,
        reliability,
    };
}

function riskLevel(metric: PredictiveMetrics): "low" | "medium" | "high" | "critical" {
    if (metric.successProbability < 35 || metric.riskFactors.length >= 3) return "critical";
    if (metric.successProbability < 55 || metric.riskFactors.length >= 2) return "high";
    if (metric.successProbability < 70 || metric.riskFactors.length >= 1) return "medium";
    return "low";
}

function toActivePrediction(metric: PredictiveMetrics, cycle: Awaited<ReturnType<typeof getCyclesForOrg>>[number]) {
    const intervalWidth = Math.max(0, metric.confidenceInterval[1] - metric.confidenceInterval[0]);
    const confidence = clamp(1 - intervalWidth / 100, 0.35, 0.95);
    const risk = riskLevel(metric);

    return {
        prediction_type: risk === "low" ? "trajectory" : "failure",
        target_entity: `Cycle #${cycle.id}: ${cycle.name}`,
        predicted_value: {
            success_probability: metric.successProbability,
            estimated_cost: metric.estimatedCost,
            estimated_completion_ms: metric.estimatedCompletionTime,
        },
        confidence,
        risk_level: risk,
        prediction_horizon_hours: 24 * 7,
        timestamp: new Date().toISOString(),
        features_used: [
            { name: "success_rate", value: metric.successProbability, weight: 0.35, importance: 0.9 },
            { name: "risk_factor_count", value: metric.riskFactors.length, weight: -0.25, importance: 0.8 },
            { name: "cycle_priority", value: cycle.priority ?? 5, weight: 0.15, importance: 0.6 },
            { name: "budget_limit_usd", value: cycle.budgetLimitUsd, weight: 0.1, importance: 0.5 },
        ],
        recommendations: metric.recommendations,
        preventive_actions: metric.riskFactors.map(factor => `Investigate ${factor.toLowerCase()} before the next run`),
    };
}

function buildResourceMetrics(snapshot: Awaited<ReturnType<typeof getResourceSnapshot>>, modelCoveragePct: number) {
    const failureRate = snapshot.totalRuns > 0 ? (snapshot.failedRuns / snapshot.totalRuns) * 100 : 0;
    return {
        budget: {
            resource_type: "budget",
            usage_percentage: Math.round(snapshot.budgetUsage),
            trend: snapshot.budgetUsage > 80 ? "increasing" : "stable",
            anomalies_detected: snapshot.budgetUsage > 100 ? 1 : 0,
        },
        mission_reliability: {
            resource_type: "mission_reliability",
            usage_percentage: Math.round(100 - snapshot.reliability),
            trend: failureRate > 40 ? "increasing" : "stable",
            anomalies_detected: failureRate > 50 ? 1 : 0,
        },
        operations_queue: {
            resource_type: "operations_queue",
            usage_percentage: Math.min(100, snapshot.activeCycles.length * 3),
            trend: snapshot.activeCycles.length > 20 ? "increasing" : "stable",
            anomalies_detected: snapshot.activeRuns > 10 ? 1 : 0,
        },
        model_coverage: {
            resource_type: "model_coverage",
            usage_percentage: Math.round(modelCoveragePct),
            trend: modelCoveragePct < 40 ? "decreasing" : "stable",
            anomalies_detected: modelCoveragePct < 25 ? 1 : 0,
        },
    };
}

function buildScalingRecommendations(snapshot: Awaited<ReturnType<typeof getResourceSnapshot>>) {
    const recommendations = [];
    const failureRate = snapshot.totalRuns > 0 ? (snapshot.failedRuns / snapshot.totalRuns) * 100 : 0;

    if (failureRate > 40) {
        recommendations.push({
            resource_type: "review_capacity",
            current_usage: Math.round(failureRate),
            recommended_limit: 35,
            action: "scale_up",
            reason: "Recent mission failure pressure is high; add review or intervention capacity before approving more cycles.",
        });
    }

    if (snapshot.activeCycles.length > 20) {
        recommendations.push({
            resource_type: "operations_queue",
            current_usage: Math.min(100, snapshot.activeCycles.length * 3),
            recommended_limit: 60,
            action: "scale_down",
            reason: "Many cycles are queued or awaiting approval; reduce active queue width or batch approvals by priority.",
        });
    }

    if (snapshot.budgetUsage > 80) {
        recommendations.push({
            resource_type: "budget_guardrail",
            current_usage: Math.round(snapshot.budgetUsage),
            recommended_limit: 75,
            action: "scale_up",
            reason: "Budget utilization is approaching the guardrail; raise review strictness for expensive runs.",
        });
    }

    if (recommendations.length === 0) {
        recommendations.push({
            resource_type: "operations_queue",
            current_usage: Math.min(100, snapshot.activeCycles.length * 3),
            recommended_limit: 60,
            action: "maintain",
            reason: "Current predictive resource posture is stable.",
        });
    }

    return recommendations;
}

function buildCostRecommendations(snapshot: Awaited<ReturnType<typeof getResourceSnapshot>>) {
    const recommendations = [];
    if (snapshot.budgetUsage > 80) {
        recommendations.push({
            resource_type: "budget",
            action: "Pause non-critical cycles until budget usage returns below the guardrail.",
            estimated_savings: Math.round(Math.max(0, snapshot.totalSpend - snapshot.totalBudget * 0.75)),
            impact: "high",
            confidence: 0.82,
        });
    }

    if (snapshot.totalTokens > 0 && snapshot.completedRuns > 0) {
        const tokensPerCompletedRun = snapshot.totalTokens / snapshot.completedRuns;
        if (tokensPerCompletedRun > 500_000) {
            recommendations.push({
                resource_type: "tokens",
                action: "Review high-token mission blueprints and shorten prompt/output contracts.",
                estimated_savings: Math.round((tokensPerCompletedRun - 300_000) / 1000),
                impact: "medium",
                confidence: 0.76,
            });
        }
    }

    return recommendations;
}

async function buildWorkflowEffectiveness(orgId: number) {
    const cycles = (await getCyclesForOrg(orgId, 8)).filter(cycle => ACTIVE_CYCLE_STATUSES.has(String(cycle.status)));
    const metrics = [];

    for (const cycle of cycles) {
        const predictive = await CycleAnalyticsService.generatePredictiveMetrics(cycle.id, orgId);
        const riskPenalty = Math.min(0.5, predictive.riskFactors.length * 0.15);
        metrics.push({
            workflow_id: String(cycle.id),
            execution_time_improvement: clamp(predictive.successProbability / 100 - 0.45, 0, 0.5),
            error_rate_reduction: clamp(0.65 - riskPenalty, 0.05, 0.75),
            resource_savings: clamp((100 - predictive.estimatedCost) / 100, 0, 0.4),
        });
    }

    const overall = metrics.length > 0
        ? metrics.reduce((sum, item) => sum + item.execution_time_improvement + item.error_rate_reduction, 0) / (metrics.length * 2)
        : 0;

    return {
        overall_improvement: clamp(overall, 0, 1),
        workflows_optimized: metrics.length,
        metrics,
    };
}

router.get("/health", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = getScopedOrgId(req);
    const sidecarHealthy = await isSidecarHealthy();
    const program = await CycleAnalyticsService.getProgramAnalytics(orgId);
    const stats = CyclePredictiveService.getModelStats(orgId);

    res.json({
        status: sidecarHealthy ? "sidecar_online" : "local_fallback",
        healthy: true,
        source: sidecarHealthy ? "sidecar" : "local",
        sidecar: { healthy: sidecarHealthy, url: sidecarConfigured() ? "configured" : "not configured" },
        local: {
            healthy: true,
            organization_id: orgId,
            service_mode: serviceMode,
            monitoring_enabled: monitoringEnabled,
            total_cycles: program.totalCycles,
            trained_models: stats.totalModels,
        },
    });
}));

router.get("/analytics/summary", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = getScopedOrgId(req);
    const [program, snapshot] = await Promise.all([
        CycleAnalyticsService.getProgramAnalytics(orgId),
        getResourceSnapshot(orgId),
    ]);
    const stats = CyclePredictiveService.getModelStats(orgId);
    const modelCoveragePct = program.totalCycles > 0 ? (stats.totalModels / program.totalCycles) * 100 : 0;
    const healthScore = clamp(
        (program.overallSuccessRate / 100) * 0.45 +
        (1 - Math.min(1, program.highRiskCycles / Math.max(1, program.totalCycles))) * 0.25 +
        (program.averageAlignment / 100) * 0.2 +
        (modelCoveragePct / 100) * 0.1,
        0,
        1
    );

    res.json({
        timestamp: new Date().toISOString(),
        system_health: {
            overall_score: healthScore,
            active_alerts: program.highRiskCycles + (snapshot.failedRuns > snapshot.completedRuns ? 1 : 0),
            pending_actions: snapshot.activeCycles.filter(cycle => cycle.status === "pending_approval").length,
        },
        predictions: {
            active_predictions: snapshot.activeCycles.length,
            prediction_types: ["failure", "trajectory", "resource", "cost"],
        },
        resources: {
            monitored_resources: snapshot.activeCycles.length,
            scaling_recommendations: buildScalingRecommendations(snapshot).length,
        },
        workflows: {
            total_workflows: snapshot.activeCycles.length,
            total_optimizations: program.highRiskCycles,
        },
        service_mode: monitoringEnabled ? serviceMode : "paused",
        source: "local",
    });
}));

router.get("/predictions/active", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = getScopedOrgId(req);
    const cycles = (await getCyclesForOrg(orgId, 12)).filter(cycle => ACTIVE_CYCLE_STATUSES.has(String(cycle.status)));
    const predictions = [];

    for (const cycle of cycles) {
        const metric = await CycleAnalyticsService.generatePredictiveMetrics(cycle.id, orgId);
        predictions.push(toActivePrediction(metric, cycle));
    }

    predictions.sort((a, b) => {
        const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
        return (rank[b.risk_level] ?? 0) - (rank[a.risk_level] ?? 0) || b.confidence - a.confidence;
    });

    res.json({ predictions, total: predictions.length, source: "local" });
}));

router.get("/resources/metrics", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = getScopedOrgId(req);
    const snapshot = await getResourceSnapshot(orgId);
    const stats = CyclePredictiveService.getModelStats(orgId);
    const modelCoveragePct = snapshot.cycles.length > 0 ? (stats.totalModels / snapshot.cycles.length) * 100 : 0;
    res.json({ metrics: buildResourceMetrics(snapshot, modelCoveragePct), source: "local" });
}));

router.get("/resources/efficiency", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = getScopedOrgId(req);
    const snapshot = await getResourceSnapshot(orgId);
    const stats = CyclePredictiveService.getModelStats(orgId);
    const modelCoverage = snapshot.cycles.length > 0 ? stats.totalModels / snapshot.cycles.length : 0;

    res.json({
        efficiency_scores: {
            budget: clamp(1 - snapshot.budgetUsage / 125),
            mission_reliability: clamp(snapshot.reliability / 100),
            operations_queue: clamp(1 - snapshot.activeCycles.length / 60),
            model_coverage: clamp(modelCoverage),
        },
        source: "local",
    });
}));

router.get("/resources/scaling-recommendations", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const snapshot = await getResourceSnapshot(getScopedOrgId(req));
    res.json({ recommendations: buildScalingRecommendations(snapshot), source: "local" });
}));

router.get("/resources/cost-optimization", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const snapshot = await getResourceSnapshot(getScopedOrgId(req));
    res.json({ recommendations: buildCostRecommendations(snapshot), source: "local" });
}));

router.get("/workflows/optimization-effectiveness", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = getScopedOrgId(req);
    res.json({ effectiveness: await buildWorkflowEffectiveness(orgId), source: "local" });
}));

router.post("/service/start-monitoring", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    monitoringEnabled = true;
    serviceMode = serviceMode === "paused" ? "monitoring" : serviceMode;
    res.json({ service_mode: serviceMode, monitoring_enabled: monitoringEnabled, source: "local" });
}));

router.post("/service/stop-monitoring", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
    monitoringEnabled = false;
    serviceMode = "paused";
    res.json({ service_mode: serviceMode, monitoring_enabled: monitoringEnabled, source: "local" });
}));

router.put("/service/mode", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const allowed = new Set(["monitoring", "advisory", "learning", "automated", "paused"]);
    const nextMode = String(req.body?.mode || "").toLowerCase();
    if (!allowed.has(nextMode)) {
        return res.status(400).json({ error: "Unsupported predictive service mode" });
    }
    serviceMode = nextMode;
    monitoringEnabled = nextMode !== "paused";
    res.json({ service_mode: serviceMode, monitoring_enabled: monitoringEnabled, source: "local" });
}));

router.get("/stats", requireAuth, asyncHandler(async (req: Request, res: Response) => {

    const stats = CyclePredictiveService.getModelStats(getScopedOrgId(req));
    res.json({ ...stats, source: "local" });
}));

router.get("/cycles/:cycleId", requireAuth, asyncHandler(async (req: Request, res: Response) => {

    const cycleId = parseInt(req.params.cycleId, 10);
    const prediction = await CyclePredictiveService.predictSuccess(cycleId, getScopedOrgId(req));
    res.json({ ...prediction, source: "local" });
}));

router.post("/train", requireAuth, asyncHandler(async (req: Request, res: Response) => {

    await CyclePredictiveService.trainModels(getScopedOrgId(req));
    res.json({ message: "Models trained successfully (local fallback)", source: "local" });
}));

router.post("/update/:cycleId", requireAuth, asyncHandler(async (req: Request, res: Response) => {

    const cycleId = parseInt(req.params.cycleId, 10);
    const { actualOutcome } = req.body;
    await CyclePredictiveService.updateModelAccuracy(cycleId, actualOutcome, getScopedOrgId(req));
    res.json({ message: "Model accuracy updated (local fallback)", source: "local" });
}));

router.all("/*", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (await proxySidecar(req, res)) return;

    res.status(503).json({
        error: "Predictive sidecar is currently unavailable",
        fallback: "local",
        message: "The Python predictive analytics sidecar is offline. Local operational prediction endpoints are available for health, summary, active predictions, resource optimization, cycle forecasts, and model stats.",
    });
}));

export default router;
