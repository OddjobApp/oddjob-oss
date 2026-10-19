
import { Router, Request, Response } from "express";
import { asyncHandler } from "../../middleware/error-handler.js";
import { forensicAuditService } from "./forensic-service.js";
import { z } from "zod";

const forensicRouter = Router();

const paramsSchema = z.object({
    missionId: z.coerce.number()
});

/**
 * GET /api/audit/forensics/:missionId
 * Conducts a forensic audit of a specific mission trace.
 */
forensicRouter.get("/forensics/:missionId", asyncHandler(async (req: Request, res: Response) => {
    const { missionId } = paramsSchema.parse(req.params);
    const report = await forensicAuditService.analyzeTraceDrift(missionId);
    res.json(report);
}));

export default forensicRouter;
