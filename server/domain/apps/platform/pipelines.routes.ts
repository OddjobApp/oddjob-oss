import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { PipelinesController } from "./pipelines.controller.js";

const router = Router();

router.post(
    "/execute",
    requireAppToken("pipelines"),
    asyncHandler(PipelinesController.executePipeline),
);

router.get(
    "/:runId/status",
    requireAppToken("pipelines"),
    asyncHandler(PipelinesController.getPipelineStatus),
);

router.get(
    "/",
    requireAppToken("pipelines" as any),
    asyncHandler(PipelinesController.getPipelines),
);

router.post(
    "/:pipelineId/execute",
    requireAppToken("pipelines"),
    asyncHandler(PipelinesController.executePipeline),
);

export { router as pipelinesRouter };
