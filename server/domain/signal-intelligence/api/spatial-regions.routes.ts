/**
 * Spatial Regions REST API
 *
 * Named geographic areas, so the Rule Builder can reference a stored boundary
 * (`geometry.regionId`) instead of freezing a copy of its cells into each rule.
 * Editing a region then changes every rule that points at it.
 *
 * GET    /api/spatial-regions                 — list regions for the org
 * POST   /api/spatial-regions                 — create a region from a cell set
 * GET    /api/spatial-regions/:id             — one region
 * PATCH  /api/spatial-regions/:id             — rename / re-describe / re-draw
 * DELETE /api/spatial-regions/:id             — soft delete
 * GET    /api/spatial-regions/:id/neighbours  — adjacent regions, by geometry
 * POST   /api/spatial-regions/locate          — three-valued containment test
 *
 * TENANT ISOLATION: every call resolves through `spatialRegionService`, whose
 * org filter IS the access control — there is no unscoped read path. Region ids
 * are a global serial, so filtering on id alone would read across tenants.
 *
 * NO PROJECT SCOPE: `spatial_regions` has no `project_id`, unlike `rule_suites`
 * and `event_primitives`. Regions are org-wide today. `withProjectScope()` is
 * deliberately NOT mounted here rather than mounted and ignored, so the route
 * does not imply a scoping it cannot honour.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError, ValidationError } from "@server/utils/errors.js";
import { SPATIAL_REGION_KINDS } from "@shared/schema/spatial-regions.js";
import { spatialRegionService } from "../core/spatial-region.service.js";

const logger = createLogger("SpatialRegionsRoutes");

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// SCHEMAS
// ---------------------------------------------------------------------------

const createSchema = z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    kind: z.enum(SPATIAL_REGION_KINDS).optional(),
    cells: z.array(z.string()).min(1, "A region needs at least one H3 cell."),
    parentRegionId: z.number().int().positive().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
});

const updateSchema = createSchema.partial().refine(
    (v) => Object.keys(v).length > 0,
    { message: "Supply at least one field to update." },
);

/**
 * `precisionMetres` is required and nullable, never optional.
 *
 * An absent error radius is not the same as a precise fix: it makes the
 * position unplaceable, which must read as `indeterminate` for every region.
 * Allowing the field to be omitted would let a caller silently claim precision
 * it does not have, which is how an exclusion rule fires on an asset whose
 * location is merely unknown.
 */
const locateSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    precisionMetres: z.number().nonnegative().nullable(),
});

/** Formats a Zod failure into a flat, field-addressable error body. */
function validationBody(error: z.ZodError) {
    return {
        error: "Spatial region validation failed",
        issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
}

/** Parses `:id`, rejecting anything that is not a positive integer. */
function regionId(req: Request): number {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ValidationError(`Invalid region id '${req.params.id}'.`);
    }
    return id;
}

async function ctxOf(req: Request) {
    const orgContext = await getUserOrgContext(req);
    return { organizationId: requireOrgId(orgContext), userId: orgContext.userId };
}

// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------

router.get(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
        const ctx = await ctxOf(req);
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        res.json(await spatialRegionService.list(ctx, limit));
    }),
);

router.post(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
        const ctx = await ctxOf(req);
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json(validationBody(parsed.error));

        // create() drops invalid cells and throws when none survive, so a set of
        // entirely malformed ids is a 400 rather than an empty region.
        try {
            const region = await spatialRegionService.create(ctx, parsed.data);
            logger.info(`Created region ${region.id} ('${region.name}') for org ${ctx.organizationId}`);
            return res.status(201).json(region);
        } catch (err: any) {
            return res.status(400).json({ error: err?.message ?? "Could not create region." });
        }
    }),
);

/**
 * Containment for a measured position.
 *
 * POST rather than GET because the body carries a measurement, and declared
 * before `/:id` so "locate" is never parsed as a region id.
 */
router.post(
    "/locate",
    asyncHandler(async (req: Request, res: Response) => {
        const ctx = await ctxOf(req);
        const parsed = locateSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json(validationBody(parsed.error));

        const result = await spatialRegionService.locate(ctx, parsed.data);
        // `inside` and `indeterminate` stay separate all the way to the client:
        // collapsing them is exactly the bug three-valued containment prevents.
        return res.json({
            inside: result.inside,
            indeterminate: result.indeterminate,
            placedAtResolution: result.placedAtResolution,
        });
    }),
);

router.get(
    "/:id",
    asyncHandler(async (req: Request, res: Response) => {
        const ctx = await ctxOf(req);
        const region = await spatialRegionService.get(ctx, regionId(req));
        if (!region) throw new NotFoundError("Spatial region not found");
        return res.json(region);
    }),
);

router.patch(
    "/:id",
    asyncHandler(async (req: Request, res: Response) => {
        const ctx = await ctxOf(req);
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json(validationBody(parsed.error));

        try {
            const region = await spatialRegionService.update(ctx, regionId(req), parsed.data);
            if (!region) throw new NotFoundError("Spatial region not found");
            return res.json(region);
        } catch (err: any) {
            if (err instanceof NotFoundError) throw err;
            return res.status(400).json({ error: err?.message ?? "Could not update region." });
        }
    }),
);

router.delete(
    "/:id",
    asyncHandler(async (req: Request, res: Response) => {
        const ctx = await ctxOf(req);
        const deleted = await spatialRegionService.softDelete(ctx, regionId(req));
        if (!deleted) throw new NotFoundError("Spatial region not found");
        // Soft delete: rules referencing this region stop resolving rather than
        // silently evaluating against a missing boundary.
        return res.status(204).send();
    }),
);

router.get(
    "/:id/neighbours",
    asyncHandler(async (req: Request, res: Response) => {
        const ctx = await ctxOf(req);
        const id = regionId(req);
        const region = await spatialRegionService.get(ctx, id);
        if (!region) throw new NotFoundError("Spatial region not found");

        const rings = Math.min(Math.max(Number(req.query.rings) || 1, 1), 5);
        return res.json(await spatialRegionService.neighbours(ctx, id, rings));
    }),
);

export { router as spatialRegionsRouter };
export default router;
