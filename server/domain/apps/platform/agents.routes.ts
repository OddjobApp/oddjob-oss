import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { AgentsController } from "./agents.controller.js";

const router = Router();

router.post(
    "/:agentId/chat",
    requireAppToken("missions"),
    asyncHandler(AgentsController.chat),
);

router.get(
    "/:agentId/history",
    requireAppToken("missions"),
    asyncHandler(AgentsController.getHistory),
);

router.post(
    "/pause-all",
    requireAppToken("missions"),
    asyncHandler(AgentsController.pauseAll),
);

export { router as agentsRouter };
