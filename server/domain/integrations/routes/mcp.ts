/**
 * MCP Token Management API Routes
 * 
 * Provides CRUD operations for MCP API tokens with RBAC.
 */

import { Router, Request, Response } from "express";
import { mcpService, createTokenSchema, updateTokenSchema } from "../core/mcp.service.js";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { UnauthorizedError, ValidationError } from "@server/utils/errors.js";
import { assertOrgId, getUserOrgContext } from "../../../utils/auth-context.js";
import { requireAuth } from "@domain/core/auth/security.service.js";

const router = Router();

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /api/mcp/permissions
 * List all available MCP permissions
 */
router.get("/permissions", asyncHandler(async (req: Request, res: Response) => {
    res.json(mcpService.listPermissions());
}));

/**
 * GET /api/mcp/tokens
 * List all tokens for the current user's organization
 */
router.get("/tokens", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = assertOrgId(orgContext.organizationId);

    const tokens = await mcpService.listTokens(orgId);
    res.json({ tokens });
}));

/**
 * POST /api/mcp/tokens
 * Create a new MCP token
 */
router.post("/tokens", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.session as any)?.userId;
    const orgContext = await getUserOrgContext(req);
    const orgId = assertOrgId(orgContext.organizationId);

    const validation = createTokenSchema.safeParse(req.body);
    if (!validation.success) {
        throw new ValidationError("Invalid request", validation.error.issues);
    }

    const result = await mcpService.createToken(validation.data, userId, orgId);
    res.status(201).json(result);
}));

/**
 * GET /api/mcp/tokens/:id
 * Get a specific token
 */
router.get("/tokens/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = assertOrgId(orgContext.organizationId);

    const tokenId = parseInt(req.params.id);

    const token = await mcpService.getToken(tokenId, orgId);
    res.json({ token });
}));

/**
 * PATCH /api/mcp/tokens/:id
 * Update a token (name, description, permissions, active status)
 */
router.patch("/tokens/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = assertOrgId(orgContext.organizationId);

    const tokenId = parseInt(req.params.id);

    const validation = updateTokenSchema.safeParse(req.body);
    if (!validation.success) {
        throw new ValidationError("Invalid request", validation.error.issues);
    }

    const token = await mcpService.updateToken(tokenId, orgId, validation.data);
    res.json({ token });
}));

/**
 * DELETE /api/mcp/tokens/:id
 * Permanently delete a token
 */
router.delete("/tokens/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = assertOrgId(orgContext.organizationId);

    const tokenId = parseInt(req.params.id);

    await mcpService.deleteToken(tokenId, orgId);
    res.json({ success: true, deletedId: tokenId });
}));

/**
 * POST /api/mcp/tokens/:id/revoke
 * Revoke (disable) a token without deleting it
 */
router.post("/tokens/:id/revoke", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = assertOrgId(orgContext.organizationId);

    const tokenId = parseInt(req.params.id);

    await mcpService.revokeToken(tokenId, orgId);
    res.json({ success: true, message: "Token revoked" });
}));

/**
 * GET /api/mcp/org-settings
 * Get MCP settings for the organization
 */
router.get("/org-settings", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = assertOrgId(orgContext.organizationId);

    const settings = await mcpService.getOrgSettings(orgId);
    res.json(settings);
}));

/**
 * PATCH /api/mcp/org-settings
 * Update MCP settings for the organization
 */
router.patch("/org-settings", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = assertOrgId(orgContext.organizationId);

    const { mcpHttpEnabled } = req.body;

    if (typeof mcpHttpEnabled !== "boolean") {
        throw new ValidationError("mcpHttpEnabled must be a boolean");
    }

    const result = await mcpService.updateOrgSettings(orgId, mcpHttpEnabled);
    res.json({ success: true, ...result });
}));

export default router;


