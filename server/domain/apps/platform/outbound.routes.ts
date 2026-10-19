import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { OutboundController } from "./outbound.controller.js";

const router = Router();

// POST /api/platform/app/outbound/draft     — generate prompt + editable draft (Act III breakpoint)
router.post("/draft", requireAppToken("missions"), asyncHandler(OutboundController.draft));

// POST /api/platform/app/outbound/dispatch  — resume: send + re-arm the deal's window
router.post("/dispatch", requireAppToken("missions"), asyncHandler(OutboundController.dispatch));

export { router as outboundRouter };
