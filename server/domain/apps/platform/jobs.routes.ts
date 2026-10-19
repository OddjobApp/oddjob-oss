import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { JobsController } from "./jobs.controller.js";

const router = Router();

router.get(
    "/",
    requireAppToken("missions"),
    asyncHandler(JobsController.getJobs),
);

router.post(
    "/",
    requireAppToken("missions"),
    asyncHandler(JobsController.createJob),
);

export { router as jobsRouter };
