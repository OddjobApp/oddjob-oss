import { Router, Request, Response } from "express";
import { CycleAnalyticsService } from "../domain/mission/core/cycle-analytics.service.js";
import { CyclePredictiveService } from "../domain/mission/core/cycle-predictive.service.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../domain/core/auth/security.service.js";

const router = Router();

function getOrgId(req: Request): number | undefined {
    // The cycles list intentionally lets super admins inspect cycles across
    // organizations. Keep the analytics endpoints on the same scope; otherwise
    // a cycle visible in the UI is immediately rejected by the prediction query
    // when it does not belong to the admin's default organization.
    const isSuperAdmin =
        (req as any).user?.adminRole?.isSuperAdmin === true ||
        (req as any).session?.isSuperAdmin === true;
    if (isSuperAdmin) return undefined;

    const value = (req as any).organizationId ?? (req as any).user?.defaultOrgId;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

router.get("/analytics/program", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const analytics = await CycleAnalyticsService.getProgramAnalytics(getOrgId(req));
    res.json(analytics);
}));

router.get("/analytics/cycles/:cycleId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { cycleId } = req.params;
    const metrics = await CycleAnalyticsService.calculateCycleMetrics(parseInt(cycleId), getOrgId(req));
    res.json(metrics);
}));

router.get("/analytics/trends", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const days = parseInt(String(req.query.days || "30"));
    const trends = await CycleAnalyticsService.getHistoricalTrends(days, getOrgId(req));
    res.json(trends);
}));

router.get("/predictive/cycles/:cycleId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { cycleId } = req.params;
    const prediction = await CyclePredictiveService.predictSuccess(parseInt(cycleId), getOrgId(req));
    res.json(prediction);
}));

router.post("/predictive/train", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    await CyclePredictiveService.trainModels(getOrgId(req));
    res.json({ message: "Models trained successfully" });
}));

router.get("/predictive/stats", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const stats = CyclePredictiveService.getModelStats(getOrgId(req));
    res.json(stats);
}));

router.post("/predictive/update/:cycleId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { cycleId } = req.params;
    const { actualOutcome } = req.body;
    await CyclePredictiveService.updateModelAccuracy(parseInt(cycleId), actualOutcome, getOrgId(req));
    res.json({ message: "Model accuracy updated" });
}));

router.get("/cost-optimization/:cycleId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { cycleId } = req.params;
    const optimization = await CycleAnalyticsService.generateCostOptimization(parseInt(cycleId), getOrgId(req));
    res.json(optimization);
}));

export default router;
