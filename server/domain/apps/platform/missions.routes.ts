import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { MissionsController } from "./missions.controller.js";
import { reconcileDeploymentLaunch } from '../core/sdlc-deployment-launch.service.js';

const router = Router();
router.post('/deployments/:id/reconcile', requireAppToken('missions'), asyncHandler(async (req: Request, res: Response) => {
    res.json(await reconcileDeploymentLaunch(req.appTokenContext!, req.query.crewRoom, req.params.id));
}));

router.post(
    "/trigger",
    requireAppToken("missions"),
    asyncHandler(MissionsController.triggerMission),
);

export { router as missionsRouter };
