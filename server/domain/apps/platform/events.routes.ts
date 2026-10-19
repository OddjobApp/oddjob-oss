import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { EventsController } from "./events.controller.js";

const router = Router();

router.get(
    "/history",
    requireAppToken("telemetry" as any),
    asyncHandler(EventsController.getEventsHistory),
);

router.get(
    "/stream",
    requireAppToken("telemetry" as any),
    asyncHandler(EventsController.streamEvents),
);

export { router as eventsRouter };
