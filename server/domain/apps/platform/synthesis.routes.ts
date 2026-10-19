import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { SynthesisController } from "./synthesis.controller.js";

const router = Router();

// POST /api/platform/app/synthesis  — 3-bullet grounded deal synthesis (Act II)
router.post(
    "/",
    requireAppToken("knowledge"),
    asyncHandler(SynthesisController.synthesize),
);

export { router as synthesisRouter };
