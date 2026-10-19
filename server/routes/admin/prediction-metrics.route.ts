import { Router } from "express";
import { requireAuth } from "../../middleware/index.js";
import { predictionMetricsService } from "../../services/prediction-metrics.service.js";

const router = Router();

router.get("/prediction-accuracy", requireAuth, async (req, res) => {
    const orgId = (req as any).organizationId;
    const stats = await predictionMetricsService.getAccuracy({ organizationId: orgId, windowDays: 7 });
    res.json({ window: "7d", ...stats });
});

export default router;
