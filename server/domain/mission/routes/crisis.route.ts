import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { crisisOrchestrationService } from "../core/crisis-orchestration.service.js";
import { z } from "zod";
import { assertOrgId } from "@server/utils/auth-context.js";

export const crisisRouter = Router();
crisisRouter.use(requireAuth);

/**
 * GET /api/missions/crises
 * Returns recent crisis events for the org.
 */
crisisRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const limit = parseInt(req.query.limit as string) || 20;
  const crises = await crisisOrchestrationService.getRecentCrises(orgId, limit);
  res.json(crises);
}));

/**
 * POST /api/missions/crises/handle/:runId
 * Manually trigger crisis handling for a given mission run.
 */
crisisRouter.post("/handle/:runId", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const missionRunId = parseInt(req.params.runId);
  const userId = (req as any).user?.id || "system";

  if (isNaN(missionRunId)) {
    return res.status(400).json({ error: "Invalid runId" });
  }

  const report = await crisisOrchestrationService.handleMissionFailure(missionRunId, orgId, userId);
  res.json(report);
}));
