import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../auth/core/security.service.js";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { integrationReliabilityService } from "../core/integration-reliability.service.js";
const router = Router();
router.get("/", requireAuth, asyncHandler(async (_req: Request, res: Response) => {
  const integrations = integrationReliabilityService.getAssessments();
  const summary = integrations.reduce((acc, item) => {
    acc[item.health] += 1;
    return acc;
  }, { healthy: 0, attention: 0, unavailable: 0 });
  res.json({ generatedAt: new Date().toISOString(), summary, integrations });
}));
export default router;
