import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../auth/core/security.service.js";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { integrationReliabilityService } from "../core/integration-reliability.service.js";
import { orgAgentMailService } from "../core/org-agentmail.service.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
const router = Router();
router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const context = await getUserOrgContext(req);
  const mail = await orgAgentMailService.status(requireOrgId(context));
  const integrations = integrationReliabilityService.getAssessments(mail.configured);
  const summary = integrations.reduce((acc, item) => {
    acc[item.health] += 1;
    return acc;
  }, { healthy: 0, attention: 0, unavailable: 0 });
  res.json({ generatedAt: new Date().toISOString(), summary, integrations });
}));
export default router;
