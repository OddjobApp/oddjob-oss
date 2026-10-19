import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { OnboardingController } from "./onboarding.controller.js";

const router = Router();

// POST /api/platform/app/onboarding/provision — CLOSED_WON → onboarding scaffold (Act IV)
router.post("/provision", requireAppToken("missions"), asyncHandler(OnboardingController.provision));

export { router as onboardingRouter };
