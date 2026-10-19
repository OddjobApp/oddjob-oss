import { type Express, type Request, type Response } from "express";
import { AuthController } from "./auth.controller.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { authRateLimiter, requireAuth } from "../domain/auth/core/security.service.js";
import {
    resolveOrganizationAuthorization,
    getOrganizationRoleAssignments,
    setOrganizationUserRoles,
} from "@server/utils/organization-permissions.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { organizationRoleTypes } from "@shared/schema/index.js";
import { organizationInviteService } from "../domain/org/core/organization-invite.service.js";
import { z } from "zod";

export const roleAssignmentSchema = z.object({
    userId: z.string().min(1),
    // Deduplicated before it reaches the insert. `["operator", "operator"]` is a
    // harmless way to say "operator", but sending it twice violates the
    // (organization, user, role) unique index and surfaces as a 500 on what is
    // really a well-formed request.
    roles: z
        .array(z.enum(organizationRoleTypes))
        .max(organizationRoleTypes.length * 2)
        .transform((roles) => [...new Set(roles)]),
});

async function requireRoleAdministrator(req: Request): Promise<number> {
    const context = await getUserOrgContext(req);
    if (!context.isSuperAdmin && !context.isOrgAdmin) {
        throw Object.assign(new Error("Organization administrator permission required"), { status: 403 });
    }
    return requireOrgId(context);
}

export function registerAuthRoutes(app: Express) {
    app.post("/api/login", authRateLimiter, asyncHandler(AuthController.login));
    app.post("/api/auth/login", authRateLimiter, asyncHandler(AuthController.login));
    app.get("/api/user", asyncHandler(AuthController.getUser));
    app.get("/api/csrf-token", AuthController.getCsrfToken);
    app.get("/api/users/current", requireAuth, asyncHandler(AuthController.getCurrentUser));
    app.get("/api/auth/permissions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        res.json(await resolveOrganizationAuthorization(req));
    }));
    app.get("/api/auth/role-assignments", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const organizationId = await requireRoleAdministrator(req);
        const assignments = await getOrganizationRoleAssignments(organizationId);
        res.json({ organizationId, assignments });
    }));
    app.put("/api/auth/role-assignments", requireAuth, asyncHandler(async (req: Request, res: Response) => {
        const organizationId = await requireRoleAdministrator(req);
        const input = roleAssignmentSchema.parse(req.body);
        const administrator = await getUserOrgContext(req);
        await setOrganizationUserRoles(organizationId, input.userId, input.roles, administrator.userId);
        res.json({ organizationId, userId: input.userId, roles: input.roles });
    }));
    app.post("/api/logout", requireAuth, AuthController.logout);
    app.post("/api/register", authRateLimiter, asyncHandler(AuthController.register));
    app.post("/api/auth/forgot-password", authRateLimiter, asyncHandler(AuthController.forgotPassword));
    app.post("/api/auth/reset-password", authRateLimiter, asyncHandler(AuthController.resetPassword));

    // --- Public invite acceptance ---
    app.get("/api/invites/verify", authRateLimiter, asyncHandler(async (req: Request, res: Response) => {
        const token = z.string().min(1).parse(req.query.token);
        const result = await organizationInviteService.validateInviteToken(token);
        res.json(result);
    }));

    app.post("/api/invites/accept", authRateLimiter, asyncHandler(AuthController.acceptInvite));
}
