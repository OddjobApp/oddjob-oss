import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { SchedulesController } from "./schedules.controller.js";

const router = Router();

router.post(
    "/",
    requireAppToken("schedules"),
    asyncHandler(SchedulesController.createSchedule),
);

export { router as schedulesRouter };
