/**
 * Marketplace API Routes — the Bot Exchange.
 *
 * GET    /api/marketplace/listings          – public listings, most installed first
 * GET    /api/marketplace/listings/mine     – this org's own listings, published or not
 * GET    /api/marketplace/listings/:id      – one public listing
 * POST   /api/marketplace/listings          – publish an agent card (org admin)
 * POST   /api/marketplace/listings/:id/install – clone the snapshot into this org
 * DELETE /api/marketplace/listings/:id      – unpublish this org's listing (org admin)
 *
 * Publishing puts a card's name, description, persona, capabilities and tools in
 * front of every other organization, so it is an admin decision rather than a
 * member one. Installing is not: it only writes a card into the caller's own org.
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { ForbiddenError, ValidationError } from "@server/utils/errors.js";
import { marketplaceListingService } from "../core/marketplace-listing.service.js";

export const marketplaceRouter = Router();

marketplaceRouter.use(requireAuth);

/** The listing id in the path, or a 400 rather than a lookup for NaN. */
function listingId(req: Request): number {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ValidationError("listing id must be a positive integer", { field: "id" });
    }
    return id;
}

marketplaceRouter.get(
    "/listings",
    asyncHandler(async (req: Request, res: Response) => {
        const category = typeof req.query.category === "string" ? req.query.category : undefined;
        const limit = Number.parseInt(String(req.query.limit ?? ""), 10);
        const listings = await marketplaceListingService.listPublic(
            category,
            Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : undefined,
        );
        res.json({ listings });
    }),
);

marketplaceRouter.get(
    "/listings/mine",
    asyncHandler(async (req: Request, res: Response) => {
        const orgId = requireOrgId(await getUserOrgContext(req));
        res.json({ listings: await marketplaceListingService.listByOrg(orgId) });
    }),
);

marketplaceRouter.get(
    "/listings/:id",
    asyncHandler(async (req: Request, res: Response) => {
        res.json({ listing: await marketplaceListingService.getById(listingId(req)) });
    }),
);

marketplaceRouter.post(
    "/listings",
    asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        if (!orgContext.isAdmin) {
            throw new ForbiddenError("Only an organization admin can publish a bot to the marketplace");
        }
        const listing = await marketplaceListingService.publish(orgId, orgContext.userId, req.body);
        res.status(201).json({ listing });
    }),
);

marketplaceRouter.post(
    "/listings/:id/install",
    asyncHandler(async (req: Request, res: Response) => {
        const orgId = requireOrgId(await getUserOrgContext(req));
        res.status(201).json(await marketplaceListingService.install(listingId(req), orgId));
    }),
);

marketplaceRouter.delete(
    "/listings/:id",
    asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        if (!orgContext.isAdmin) {
            throw new ForbiddenError("Only an organization admin can unpublish a marketplace listing");
        }
        await marketplaceListingService.unpublish(orgId, listingId(req));
        res.json({ success: true });
    }),
);
