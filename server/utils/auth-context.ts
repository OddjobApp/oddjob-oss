import { type Request, type Response, type NextFunction } from "express";
import { db } from "../database_service.js";
import {
    users,
    adminRoles,
    orgs,
    userOrgs,
    type User,
    type AdminRole,
} from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { logSecurityEvent } from "./security-logger.js";
import { ForbiddenError } from "./errors.js";

export interface OrgContext {
    userId: string;
    organizationId: number | null;
    isAdmin: boolean;
    isSuperAdmin: boolean;
    isOrgAdmin: boolean;
}

/**
 * Generates a high-privilege system context for automated background tasks.
 */
export function getSystemOrgContext(organizationId: number | null): OrgContext {
    return {
        userId: "system",
        organizationId,
        isAdmin: true,
        isSuperAdmin: true,
        isOrgAdmin: true
    };
}

export async function getUserOrgContext(req: Request): Promise<OrgContext> {
    // Cache per-request to avoid repeated DB hits for the same request
    if ((req as any)._orgContext) {
        return (req as any)._orgContext;
    }

    const result = await _computeOrgContext(req);
    (req as any)._orgContext = result;
    return result;
}

async function _computeOrgContext(req: Request): Promise<OrgContext> {
    try {
        // Handle internal service tokens
        const internalToken = req.headers['x-internal-token'];
        const secret = process.env.INTERNAL_API_SECRET || process.env.SESSION_SECRET;

        if (internalToken && secret && internalToken === secret) {
            const bodyOrgId = req.body?.organizationId || req.body?.organization_id;
            const queryOrgId = req.query.organizationId || req.query.organization_id;
            const requestedOrgId = bodyOrgId || (queryOrgId ? parseInt(queryOrgId as string, 10) : null);
            const orgId = requestedOrgId !== null && requestedOrgId !== undefined ? Number(requestedOrgId) : null;

            return {
                userId: "internal-service",
                organizationId: orgId !== null && isNaN(orgId) ? null : orgId,
                isAdmin: true,
                isSuperAdmin: true,
                isOrgAdmin: false
            };
        }

        // API-key authenticated request
        const apiKeyAuth = (req as any).apiKeyAuth;
        if (apiKeyAuth) {
            return {
                userId: `apikey:${apiKeyAuth.id}`,
                organizationId: apiKeyAuth.organizationId,
                isAdmin: true,
                isSuperAdmin: false,
                isOrgAdmin: true,
            };
        }

        const userId = (req.session as any)?.userId;
        if (!userId) {
            return { userId: "anonymous", organizationId: null, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
        }

        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        if (!user) {
            return { userId, organizationId: null, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
        }

        let adminRole = null;
        try {
            const [role] = await db
                .select()
                .from(adminRoles)
                .where(eq(adminRoles.userId, userId))
                .limit(1);
            adminRole = role || null;
        } catch {}

        const isSuperAdmin = adminRole?.role === "super_admin" || 
            Boolean((req.session as any)?.isSuperAdmin) || 
            Boolean((user as any)?.isSuperAdmin);
        const isOrgAdmin = adminRole?.role === "org_admin" || isSuperAdmin;

        const requestedOrg = req.query?.orgId ?? req.query?.organizationId ?? req.query?.organization_id
            ?? req.headers?.['x-organization-id'] ?? (req.session as any)?.currentOrgId
            ?? req.body?.organizationId ?? req.body?.organization_id;
        const orgIdParam = requestedOrg == null ? null : Number(requestedOrg);
        if (orgIdParam !== null && (!Number.isSafeInteger(orgIdParam) || orgIdParam <= 0)) {
            throw new ForbiddenError("Invalid organization context");
        }

        if (orgIdParam && !isNaN(orgIdParam)) {
            if (!isSuperAdmin && adminRole?.organizationId !== orgIdParam) {
                const [membership] = await db.select({ orgId: userOrgs.orgId }).from(userOrgs)
                    .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgIdParam))).limit(1);
                if (!membership) {
                    void logSecurityEvent(req, "cross_org_access_denied", { userId, requestedOrgId: orgIdParam }).catch(() => {});
                    throw new ForbiddenError("You do not belong to this organization");
                }
            }
            const canAdminister = isSuperAdmin || (isOrgAdmin && adminRole?.organizationId === orgIdParam);
            return {
                userId,
                organizationId: orgIdParam,
                isAdmin: canAdminister,
                isSuperAdmin,
                isOrgAdmin: canAdminister,
            };
        }

        if (isOrgAdmin && adminRole && adminRole.organizationId) {
            return {
                userId,
                organizationId: adminRole.organizationId,
                isAdmin: true,
                isSuperAdmin,
                isOrgAdmin: true,
            };
        }

        // A default organization counts only where the user is a member. It
        // was returned unchecked - the membership enforcement above covered the
        // ?orgId= path only - so a users.default_org_id naming another tenant
        // (registration let anyone set one) was a membership in that tenant.
        if (user.defaultOrgId) {
            const [membership] = await db.select({ orgId: userOrgs.orgId }).from(userOrgs)
                .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, user.defaultOrgId))).limit(1);
            if (membership || isSuperAdmin) {
                return {
                    userId,
                    organizationId: user.defaultOrgId,
                    isAdmin: isOrgAdmin,
                    isSuperAdmin,
                    isOrgAdmin,
                };
            }
            void logSecurityEvent(req, "cross_org_access_denied", { userId, requestedOrgId: user.defaultOrgId, via: "default_org" }).catch(() => {});
        }

        const [userOrg] = await db
            .select()
            .from(userOrgs)
            .where(eq(userOrgs.userId, userId))
            .limit(1);

        if (userOrg?.orgId) {
            return {
                userId,
                organizationId: userOrg.orgId,
                isAdmin: isOrgAdmin,
                isSuperAdmin,
                isOrgAdmin,
            };
        }

        // Fallback to the first available organization in the system if super admin
        if (isSuperAdmin) {
            const [firstOrg] = await db.select({ id: orgs.id }).from(orgs).limit(1);
            return {
                userId,
                organizationId: firstOrg?.id ?? null,
                isAdmin: true,
                isSuperAdmin: true,
                isOrgAdmin: true,
            };
        }

        return {
            userId,
            organizationId: null,
            isAdmin: false,
            isSuperAdmin: false,
            isOrgAdmin: false,
        };
    } catch (error: any) {
        throw error;
    }
}

/**
 * Asserts that the OrgContext has a valid organizationId.
 * Throws HTTP 403 if the user has no organization.
 */
export function requireOrgId(orgContext: OrgContext): number {
    if (!orgContext.organizationId) {
        throw Object.assign(new Error("Organization context required"), { status: 403 });
    }
    return orgContext.organizationId;
}

export function assertOrgId(orgId: number | null | undefined): number {
    if (orgId == null) {
        throw Object.assign(new Error("Organization context required"), { status: 403 });
    }
    return orgId;
}

export async function validateOrgAccess(organizationId: number | null, userId: string): Promise<boolean> {
    if (!organizationId) {
        return true;
    }

    const [adminRole] = await db
        .select()
        .from(adminRoles)
        .where(eq(adminRoles.userId, userId))
        .limit(1);

    if (adminRole?.role === "super_admin") {
        return true;
    }

    if (adminRole?.role === "org_admin") {
        return adminRole.organizationId === organizationId;
    }

    const [userOrg] = await db
        .select()
        .from(userOrgs)
        .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, organizationId)))
        .limit(1);

    return !!userOrg;
}

// Authorization helper functions
export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.isSuperAdmin) {
        return res.status(403).json({ message: "Super admin access required" });
    }
    (req as any).organizationId = orgContext.organizationId;
    next();
}

export async function requireOrgAdminOrSuper(req: Request, res: Response, next: NextFunction) {
    const orgContext = await getUserOrgContext(req);
    if (!orgContext.isAdmin) {
        return res.status(403).json({ message: "Admin access required" });
    }
    (req as any).organizationId = orgContext.organizationId;
    next();
}

export async function canManageOrganization(userId: string, orgId: number): Promise<boolean> {
    const [adminRole] = await db
        .select()
        .from(adminRoles)
        .where(eq(adminRoles.userId, userId))
        .limit(1);

    if (adminRole?.role === "super_admin") {
        return true;
    }

    if (adminRole?.role === "org_admin") {
        return adminRole.organizationId === orgId;
    }

    return false;
}
