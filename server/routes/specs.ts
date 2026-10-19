import { validateIdParam } from "@server/utils/api-utils.js";
import { Router, Request, Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { AppError, BadRequestError, NotFoundError, ForbiddenError, ErrorCode } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { apiSpecs, insertApiSpecSchema, orgSpecAccess } from "@shared/schema/index.js";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { getAgentTools } from "@domain/tools/v1/capabilities/index.js";
import { zodToJsonSchema } from "zod-to-json-schema";

const router = Router();
const logger = createLogger("ApiSpecs");

/**
 * Middleware to require Super Admin access for admin endpoints
 */
async function requireSuperAdmin(req: Request, res: Response, next: Function) {
    try {
        const orgContext = await getUserOrgContext(req);
        if (!orgContext.isSuperAdmin) {
            throw new ForbiddenError("Super Admin access required for this endpoint");
        }
        next();
    } catch (error) {
        next(error);
    }
}

// List all builtin hardcoded agent tools (Authenticated only, Super Admin filtered in UI but safe for all to see names?)
// Actually, keep it protected for now.
router.get("/tools/builtin", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.isSuperAdmin) {
        throw new ForbiddenError("Super Admin access required to list builtin tools");
    }

    const tools = getAgentTools();
    const result = Object.values(tools).map(tool => {
        const schema = tool.parameters
            ? (typeof (tool.parameters as any).safeParse === 'function'
                ? zodToJsonSchema(tool.parameters as any)
                : tool.parameters)
            : null;
        console.log(`[Builtin Tool Debug] ${tool.name} schema generated:`, !!schema);
        return {
            name: tool.name,
            label: tool.label || tool.name,
            group: tool.group || "Uncategorized",
            description: tool.description,
            adminOnly: tool.adminOnly || false,
            source: "builtin",
            riskLevel: tool.riskLevel || "low",
            schema,
        };
    });

    res.json(result);
}));

// List all specs (Super Admin only)
router.get("/specs/management", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.isSuperAdmin) {
        throw new ForbiddenError("Super Admin access required to list all specs");
    }

    const specs = await db.select().from(apiSpecs).orderBy(desc(apiSpecs.createdAt));
    logger.debug(`GET /admin/specs returning ${specs.length} specs.`, { correlationId: req.correlationId });
    res.json(specs);
}));

// Create a new Spec
router.post("/specs/management", asyncHandler(async (req: Request, res: Response) => {
    const data = insertApiSpecSchema.parse(req.body);

    // Basic Validation: Ensure it looks like OpenAPI/Swagger
    const content = data.content as any;
    if (!content.openapi && !content.swagger) {
        throw new BadRequestError("Invalid Spec: Must contain 'openapi' or 'swagger' version field.", {}, ErrorCode.VALIDATION_FAILED);
    }

    const [spec] = await db.insert(apiSpecs).values(data).returning();
    res.status(201).json(spec);
}));

// Get single spec
router.get("/specs/management/:id", asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid ID", { id: req.params.id }, ErrorCode.INVALID_INPUT);

    const [spec] = await db.select().from(apiSpecs).where(eq(apiSpecs.id, id));
    if (!spec) throw new NotFoundError("Spec not found", ErrorCode.NOT_FOUND, { id });

    res.json(spec);
}));

// Update Spec
router.put("/specs/management/:id", asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid ID", { id: req.params.id }, ErrorCode.INVALID_INPUT);

    const data = insertApiSpecSchema.partial().parse(req.body);

    if (data.content) {
        const content = data.content as any;
        if (!content.openapi && !content.swagger) {
            throw new BadRequestError("Invalid Spec: Must contain 'openapi' or 'swagger' version field.", {}, ErrorCode.VALIDATION_FAILED);
        }
    }

    const [spec] = await db
        .update(apiSpecs)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(apiSpecs.id, id))
        .returning();

    if (!spec) throw new NotFoundError("Spec not found", ErrorCode.NOT_FOUND, { id });
    res.json(spec);
}));

// Publish / Assign Access
router.post("/specs/management/:id/access", asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    const { orgIds } = req.body; // orgIds: number[]

    if (isNaN(id)) throw new BadRequestError("Invalid ID", { id: req.params.id }, ErrorCode.INVALID_INPUT);

    try {
        await db.transaction(async (tx) => {
            // 1. Revoke access for orgs NOT in the list
            if (orgIds && Array.isArray(orgIds)) {
                if (orgIds.length === 0) {
                    // Revoke all
                    await tx.delete(orgSpecAccess).where(eq(orgSpecAccess.specId, id));
                } else {
                    // Revoke those not in list
                    // drizzle doesn't perfectly support "NOT IN".
                    // We can fetch existing, calculate diff, and delete.
                    const existing = await tx.select().from(orgSpecAccess).where(eq(orgSpecAccess.specId, id));
                    const toRemove = existing
                        .filter(r => !orgIds.includes(r.orgId))
                        .map(r => r.orgId);

                    if (toRemove.length > 0) {
                        // Delete one by one or use inArray if possible
                        // simple loop for MVP
                        for (const rmId of toRemove) {
                            await tx.delete(orgSpecAccess).where(and(eq(orgSpecAccess.specId, id), eq(orgSpecAccess.orgId, rmId)));
                        }
                    }
                }

                // 2. Grant access for new orgs
                for (const orgId of orgIds) {
                    const [existing] = await tx.select().from(orgSpecAccess).where(and(eq(orgSpecAccess.specId, id), eq(orgSpecAccess.orgId, orgId)));
                    if (!existing) {
                        await tx.insert(orgSpecAccess).values({
                            specId: id,
                            orgId: orgId
                        });
                    }
                }
            }
        });

        res.json({ success: true });
    } catch (error: any) {
        logger.error("Access Update Error:", error, { correlationId: req.correlationId });
        throw new AppError("Failed to update access", 500, ErrorCode.INTERNAL_ERROR, { details: { originalError: error.message } });
    }
}));

// Get Access List for a Spec (Admin)
router.get("/specs/management/:id/access", asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid ID", { id: req.params.id }, ErrorCode.INVALID_INPUT);

    // Return list of orgs that have access + settings
    const accessList = await db
        .select({
            orgId: orgSpecAccess.orgId,
            settings: orgSpecAccess.settings,
            enabledAt: orgSpecAccess.enabledAt
        })
        .from(orgSpecAccess)
        .where(eq(orgSpecAccess.specId, id));

    res.json(accessList);
}));

// Update Access Settings for an Org (Admin)
router.put("/specs/management/:id/access/:orgId", asyncHandler(async (req: Request, res: Response) => {
    const specId = validateIdParam(req.params.id);
    const orgId = validateIdParam(req.params.orgId, 'orgId');

    const { settings } = req.body; // { baseURL: string, ... }

    const [updated] = await db
        .update(orgSpecAccess)
        .set({ settings })
        .where(
            and(
                eq(orgSpecAccess.specId, specId),
                eq(orgSpecAccess.orgId, orgId)
            )
        )
        .returning();

    if (!updated) {
        throw new NotFoundError("Access not granted yet. Grant access first.", ErrorCode.NOT_FOUND);
    }

    res.json(updated);
}));

// Org-facing API: Get available specs
router.get("/orgs/:orgId/available-specs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = validateIdParam(req.params.orgId, 'orgId');
    if (isNaN(orgId)) throw new BadRequestError("Invalid Org ID", { orgId: req.params.orgId }, ErrorCode.INVALID_INPUT);

    // Join apiSpecs and orgSpecAccess
    const specs = await db
        .select({
            id: apiSpecs.id,
            name: apiSpecs.name,
            description: apiSpecs.description,
            status: apiSpecs.status,
            createdAt: apiSpecs.createdAt
        })
        .from(apiSpecs)
        .innerJoin(orgSpecAccess, eq(apiSpecs.id, orgSpecAccess.specId))
        .where(
            and(
                eq(orgSpecAccess.orgId, orgId),
                eq(apiSpecs.status, 'published')
            )
        );

    res.json(specs);
}));

// Org-facing API: Get all available specs for the current context (shortcut for /api/specs)
router.get("/specs", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, isSuperAdmin } = await getUserOrgContext(req);

    // If not super admin and no org ID, they shouldn't see anything (or maybe global specs?)
    if (!organizationId && !isSuperAdmin) {
        return res.json([]);
    }

    let specs;
    if (isSuperAdmin && !organizationId) {
        // Super Admin viewing globally
        specs = await db
            .select({
                id: apiSpecs.id,
                name: apiSpecs.name,
                description: apiSpecs.description,
                status: apiSpecs.status,
                createdAt: apiSpecs.createdAt
            })
            .from(apiSpecs)
            .where(eq(apiSpecs.status, 'published'))
            .orderBy(desc(apiSpecs.createdAt));
    } else {
        // Filtered by Org
        specs = await db
            .select({
                id: apiSpecs.id,
                name: apiSpecs.name,
                description: apiSpecs.description,
                status: apiSpecs.status,
                createdAt: apiSpecs.createdAt
            })
            .from(apiSpecs)
            .innerJoin(orgSpecAccess, eq(apiSpecs.id, orgSpecAccess.specId))
            .where(
                and(
                    eq(orgSpecAccess.orgId, organizationId!),
                    eq(apiSpecs.status, 'published')
                )
            );
    }

    res.json(specs);
}));

// Org-facing API: Get FULL Spec Content
router.get("/orgs/:orgId/specs/:specId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = validateIdParam(req.params.orgId, 'orgId');
    const specId = validateIdParam(req.params.specId, 'specId');

    if (isNaN(orgId) || isNaN(specId)) throw new BadRequestError("Invalid IDs", { orgId: req.params.orgId, specId: req.params.specId }, ErrorCode.INVALID_INPUT);

    // 1. Verify Access
    const [access] = await db
        .select()
        .from(orgSpecAccess)
        .where(and(eq(orgSpecAccess.orgId, orgId), eq(orgSpecAccess.specId, specId)));

    if (!access) {
        throw new ForbiddenError("Organization does not have access to this tool.");
    }

    // 2. Fetch Content
    const [spec] = await db
        .select()
        .from(apiSpecs)
        .where(eq(apiSpecs.id, specId));

    if (!spec) throw new NotFoundError("Spec not found", ErrorCode.NOT_FOUND, { specId });

    res.json(spec);
}));

// Delete a spec
router.delete("/specs/management/:id", asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    if (isNaN(id)) throw new BadRequestError("Invalid ID", { id: req.params.id }, ErrorCode.INVALID_INPUT);

    // First delete access grants
    await db.delete(orgSpecAccess).where(eq(orgSpecAccess.specId, id));
    // Then delete the spec
    await db.delete(apiSpecs).where(eq(apiSpecs.id, id));

    logger.debug(`Deleted spec ${id}`, { correlationId: req.correlationId });
    res.json({ success: true });
}));

export default router;

