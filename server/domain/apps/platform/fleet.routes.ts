import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { FleetController } from "./fleet.controller.js";

const router = Router();

router.get("/workload", requireAppToken("missions"), asyncHandler(FleetController.workload));

export { router as fleetRouter };
