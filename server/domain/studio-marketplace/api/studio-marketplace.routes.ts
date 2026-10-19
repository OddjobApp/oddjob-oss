/**
 * Studio Marketplace API Routes
 *
 * GET  /api/studio-marketplace/studios          – available studios + installed status
 * POST /api/studio-marketplace/studios/:kind/install   – enable for this org
 * POST /api/studio-marketplace/studios/:kind/uninstall – disable for this org
 *
 * Installing/uninstalling is an organization-admin action because it changes
 * which CREW surfaces are available to every member of the org.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { ForbiddenError, ValidationError } from "@server/utils/errors.js";
import { studioEntitlementService, type StudioListing } from "../core/studio-entitlement.service.js";
import { STUDIO_KINDS, type StudioKind } from "@shared/studio-registry.js";
import { auditService } from "@domain/audit/core/audit-service.js";

export const studioMarketplaceRouter = Router();

studioMarketplaceRouter.use(requireAuth);

function parseStudioKind(raw: string): StudioKind {
    if (!STUDIO_KINDS.includes(raw as StudioKind)) {
        throw new ValidationError(`Unknown studio kind '${raw}'`, { field: "kind" });
    }
    return raw as StudioKind;
}

function studioKindParam(req: Request): StudioKind {
    return parseStudioKind(req.params.kind);
}

studioMarketplaceRouter.get(
    "/studios",
    asyncHandler(async (req: Request, res: Response) => {
        const orgId = requireOrgId(await getUserOrgContext(req));
        const listings: StudioListing[] = await studioEntitlementService.list(orgId);
        res.json({ studios: listings });
    }),
);

studioMarketplaceRouter.post(
    "/studios/:kind/install",
    asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        if (!orgContext.isAdmin) {
            throw new ForbiddenError("Only an organization admin can install a studio add-on");
        }
        const kind = studioKindParam(req);
        const entitlement = await studioEntitlementService.install(orgId, orgContext.userId, kind);
        await auditService.logFromRequest(req, "studio_installed", "organization_studio_entitlements", orgId, {
            studioKind: kind,
            entitlementId: entitlement.id,
        });
        res.status(201).json({ entitlement });
    }),
);

studioMarketplaceRouter.post(
    "/studios/:kind/uninstall",
    asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        if (!orgContext.isAdmin) {
            throw new ForbiddenError("Only an organization admin can uninstall a studio add-on");
        }
        const kind = studioKindParam(req);
        await studioEntitlementService.uninstall(orgId, kind);
        await auditService.logFromRequest(req, "studio_uninstalled", "organization_studio_entitlements", orgId, {
            studioKind: kind,
        });
        res.json({ success: true });
    }),
);
