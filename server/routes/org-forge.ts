import { Router, type Request, type Response } from "express";
import { requireAuth } from "../domain/auth/core/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { orgMaturityService } from "../domain/org/core/org-maturity.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger('OrgForgeRouter');
const router = Router();

/**
 * GET /api/org-forge/maturity
 * Returns the Agency Maturity Report for the current organization.
 */
router.get("/maturity", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) return res.status(400).json({ error: "No organization context found" });

    const report = await orgMaturityService.getMaturityReport(orgContext.organizationId);
    res.json(report);
}));

/**
 * POST /api/org-forge/soul/synthesize
 * Triggers an AI-driven synthesis of the organization's Soul Traits.
 */
router.post("/soul/synthesize", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) return res.status(400).json({ error: "No organization context found" });

    const result = await orgMaturityService.synthesizeSoulTraits(orgContext.organizationId);
    res.json(result);
}));

export { router as orgForgeRouter };

