import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth/core/security.service.js";
import { getUserOrgContext } from "../../utils/auth-context.js";
import { asyncHandler } from "../../middleware/error-handler.js";
import { BadRequestError, ForbiddenError } from "@server/utils/errors.js";
import { adminService } from "./admin.service.js";

const router = Router();

router.get("/org-settings", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    
    // Instead of throwing 400, we return default settings if org is not yet determined
    // to prevent initialization hangs in the frontend.
    if (!orgContext.organizationId) {
        return res.json({
            organizationId: null,
            knowledgeStoreEnabled: true,
            knowledgeGraphEnabled: true,
            psychologistEnabled: true,
            skillImportEnabled: false,
            autoresearchEnabled: true,
            trustgraphEnabled: true,
            mcpHttpEnabled: false,
            trycuaEnabled: false,
            trycuaDefaultOs: "linux",
            trycuaMaxSessionTime: 60,
        });
    }

    const settings = await adminService.getOrgSettings(orgContext.organizationId);
    res.json(settings);
}));

router.put("/org-settings", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.organizationId) throw new BadRequestError("Organization context required");
    if (!orgContext.isAdmin && !orgContext.isSuperAdmin) throw new ForbiddenError("Admin access required");
    const settings = await adminService.updateOrgSettings(orgContext.organizationId, req.body);
    res.json(settings);
}));

export default router;


