import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { TelemetryController } from "./telemetry.controller.js";

const router = Router();

router.post(
    "/",
    requireAppToken("telemetry" as any),
    asyncHandler(TelemetryController.recordTelemetry),
);

export { router as telemetryRouter };
