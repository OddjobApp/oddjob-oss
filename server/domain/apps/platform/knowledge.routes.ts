import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { KnowledgeController } from "./knowledge.controller.js";

const router = Router();

router.get(
    "/query",
    requireAppToken("knowledge"),
    asyncHandler(KnowledgeController.queryKnowledge),
);

export { router as knowledgeRouter };
