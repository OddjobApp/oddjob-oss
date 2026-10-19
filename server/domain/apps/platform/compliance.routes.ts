import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { ComplianceController } from "./compliance.controller.js";

const router = Router();
router.get("/evidence", requireAppToken("hil"), asyncHandler(ComplianceController.evidence));
router.post("/simulate", requireAppToken("hil"), asyncHandler(ComplianceController.simulate));
export { router as complianceRouter };
