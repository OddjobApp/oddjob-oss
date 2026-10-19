import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { playwrightSelfHealingService } from "../core/playwright-self-healing.service.js";
import { createLogger } from "@server/utils/logger.js";

const router = Router();
const logger = createLogger("PlaywrightRoute");

// POST /api/testing/playwright/report-execution
router.post("/report-execution", asyncHandler(async (req: Request, res: Response) => {
  const report = req.body;
  logger.info(`[PlaywrightRoute] Received execution report for suite '${report.suiteName || "E2E"}'`);

  const result = await playwrightSelfHealingService.processExecutionReport(report);
  res.json({ success: true, ...result });
}));

// POST /api/testing/playwright/trigger-healing
router.post("/trigger-healing", asyncHandler(async (req: Request, res: Response) => {
  const { title = "Sample Test", file = "sample.spec.ts", error = "locator timeout" } = req.body;
  logger.info(`[PlaywrightRoute] Triggering self-healing diagnosis for '${title}'`);

  const diagnosis = await playwrightSelfHealingService.diagnoseAndHeal({ title, file, error });
  res.json({ success: true, diagnosis });
}));

// GET /api/testing/playwright/health
router.get("/health", asyncHandler(async (req: Request, res: Response) => {
  const health = await playwrightSelfHealingService.getHealthMetrics();
  res.json({ success: true, health });
}));

export default router;
export { router as playwrightRouter };
