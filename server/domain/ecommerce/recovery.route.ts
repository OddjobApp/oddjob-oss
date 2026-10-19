
import { Router, Request, Response } from "express";
import { asyncHandler } from "../../middleware/error-handler.js";
import { cartRecoveryService } from "./recovery-service.js";
import { getUserOrgContext } from "../../utils/auth-context.js";

const recoveryRouter = Router();

/**
 * GET /api/ecommerce/recovery-stats
 * Returns checkout conversion and recovery statistics.
 */
recoveryRouter.get("/recovery-stats", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) throw new Error("Organization context missing");
    const stats = await cartRecoveryService.getRecoveryStats(orgContext.organizationId);
    res.json(stats);
}));

export default recoveryRouter;
