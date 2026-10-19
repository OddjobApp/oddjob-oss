import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { appCopilotService } from "../core/app-copilot.service.js";
import { z } from "zod";
import { assertOrgId } from "@server/utils/auth-context.js";

export const appCopilotRouter = Router();
appCopilotRouter.use(requireAuth);

const provisionSchema = z.object({
  appId: z.number().int().positive(),
  appSlug: z.string().min(1),
  blueprint: z.string().min(1),
  persona: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
});

/**
 * POST /api/apps/copilot/provision
 * Provisions a scoped AI co-pilot agent for a forged app.
 */
appCopilotRouter.post("/provision", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const userId = (req as any).user?.id || "system";
  const { appId, appSlug, blueprint, persona, allowedTools } = provisionSchema.parse(req.body);

  const result = await appCopilotService.provisionCopilot(
    appId, appSlug, blueprint, orgId, userId, persona, allowedTools
  );
  res.json(result);
}));

/**
 * GET /api/apps/copilot/:slug/config
 * Returns the co-pilot widget config for a given app slug.
 */
appCopilotRouter.get("/:slug/config", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const config = await appCopilotService.getCopilotConfig(req.params.slug, orgId);
  if (!config) return res.status(404).json({ error: "No co-pilot provisioned for this app" });
  res.json(config);
}));

/**
 * GET /api/apps/copilot/:slug/widget-code
 * Returns the JSX widget injection snippet for the forged app.
 */
appCopilotRouter.get("/:slug/widget-code", asyncHandler(async (req: Request, res: Response) => {
  const orgId = assertOrgId(req.organizationId);
  const config = await appCopilotService.getCopilotConfig(req.params.slug, orgId);
  if (!config) return res.status(404).json({ error: "No co-pilot provisioned for this app" });

  const widgetCode = appCopilotService.generateWidgetCode(
    config.agentJobId,
    config.appSlug,
    config.welcomeMessage
  );
  const componentCode = appCopilotService.generateCopilotComponent();

  res.json({ widgetCode, componentCode });
}));
