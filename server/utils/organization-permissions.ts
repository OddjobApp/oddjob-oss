import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../database_service.js";
import {
    organizationRoleAssignments,
    orgSettings,
    userOrgs,
    type OrganizationRoleType,
} from "@shared/schema/index.js";
import { createLogger } from "./logger.js";
import { getUserOrgContext, requireOrgId, type OrgContext } from "./auth-context.js";

const logger = createLogger("OrganizationPermissions");

export const organizationPermissionTypes = [
    "mission:view",
    "mission:execute",
    "mission:approve",
    "audit:export",
    "policy:manage",
    "connector:manage",
    "users:manage",
] as const;

export type OrganizationPermission = (typeof organizationPermissionTypes)[number];

const rolePermissions: Record<OrganizationRoleType, readonly OrganizationPermission[]> = {
    operator: ["mission:view", "mission:execute"],
    approver: ["mission:view", "mission:approve"],
    auditor: ["mission:view", "audit:export"],
    administrator: organizationPermissionTypes,
};

export function permissionsForRoles(roles: readonly OrganizationRoleType[]): OrganizationPermission[] {
    return [...new Set(roles.flatMap((role) => rolePermissions[role]))];
}

export function hasOrganizationPermission(
    roles: readonly OrganizationRoleType[],
    permission: OrganizationPermission,
): boolean {
    return permissionsForRoles(roles).includes(permission);
}

export interface OrganizationAuthorization {
    organizationId: number;
    enforcement: "compatibility" | "strict";
    roles: OrganizationRoleType[];
    permissions: OrganizationPermission[];
}

/**
 * Injectable seams, so the authorization decision can be tested directly.
 *
 * These are security-relevant branches — compatibility vs strict, and who gets
 * a 403 — and reaching them through a mocked `db` module couples the tests to
 * drizzle's builder chain rather than to the decision itself.
 */
export interface OrganizationAuthorizationDeps {
    loadContext(req: Request): Promise<OrgContext>;
    /** `undefined` means NO settings row exists — distinct from a row saying false. */
    loadEnforcement(organizationId: number): Promise<boolean | undefined>;
    loadRoles(organizationId: number, userId: string): Promise<string[]>;
}

const DEFAULT_DEPS: OrganizationAuthorizationDeps = {
    loadContext: (req) => getUserOrgContext(req),
    loadEnforcement: async (organizationId) => {
        const [row] = await db
            .select({ enforced: orgSettings.enterpriseRbacEnforced })
            .from(orgSettings)
            .where(eq(orgSettings.organizationId, organizationId))
            .limit(1);
        return row?.enforced;
    },
    loadRoles: async (organizationId, userId) => {
        const rows = await db
            .select({ role: organizationRoleAssignments.role })
            .from(organizationRoleAssignments)
            .where(and(
                eq(organizationRoleAssignments.organizationId, organizationId),
                eq(organizationRoleAssignments.userId, userId),
            ));
        return rows.map(({ role }) => role);
    },
};

function isKnownRole(role: string): role is OrganizationRoleType {
    return Object.prototype.hasOwnProperty.call(rolePermissions, role);
}

/**
 * The organization roles a user actually holds, filtered to roles this code
 * understands.
 *
 * Exported for callers that need a role but have no Express request to hand —
 * the capability guardrail runs deep inside the agent loop. It deliberately
 * returns only the raw assignments: the compatibility-mode widening in
 * `resolveOrganizationAuthorization` (treating everyone as administrator when
 * enterprise RBAC is off) is a decision about HTTP route permissions, and
 * silently importing it into a capability policy check would grant every user
 * an administrator's tool access.
 */
export async function loadOrganizationRoles(
    organizationId: number,
    userId: string,
    deps: Pick<OrganizationAuthorizationDeps, "loadRoles"> = DEFAULT_DEPS,
): Promise<OrganizationRoleType[]> {
    const rawRoles = await deps.loadRoles(organizationId, userId);
    const roles = rawRoles.filter(isKnownRole);

    if (roles.length !== rawRoles.length) {
        logger.warn(
            `Org ${organizationId} user ${userId} holds unrecognised role assignments: ` +
                `${rawRoles.filter((r) => !isKnownRole(r)).join(", ")}. Ignored.`,
        );
    }

    return roles;
}

export async function resolveOrganizationAuthorization(
    req: Request,
    deps: OrganizationAuthorizationDeps = DEFAULT_DEPS,
): Promise<OrganizationAuthorization> {
    const context = await deps.loadContext(req);
    const organizationId = requireOrgId(context);

    // Enforcement is read even for admins. They bypass the role check either
    // way, but reporting `strict` to an org running in compatibility mode makes
    // the 403 body and /api/auth/permissions describe a posture the org is not
    // actually in.
    const [enforced, rawRoles] = await Promise.all([
        deps.loadEnforcement(organizationId),
        deps.loadRoles(organizationId, context.userId),
    ]);

    // Three states, not two: absent row, row=false, row=true. An absent row is
    // an org that has never configured settings, and compatibility is the right
    // reading of it — `enterpriseRbacEnforced` is NOT NULL DEFAULT false, and
    // updateOrgSettings upserts, so ENABLING strict necessarily creates the row.
    // A missing row therefore cannot mean "strict was on and we lost it" unless
    // someone deleted it by hand. That case is why this logs rather than passing
    // silently: a security control quietly reverting to permissive is precisely
    // the failure you want to see in the logs.
    if (enforced === undefined) {
        logger.warn(
            `Org ${organizationId} has no org_settings row; treating enterprise RBAC as ` +
                `unenforced (compatibility mode). Expected for an org that has never saved settings.`,
        );
    }
    const strict = enforced === true;

    const roles = rawRoles.filter(isKnownRole);
    if (roles.length !== rawRoles.length) {
        // A role the code no longer understands must not silently widen access.
        logger.warn(
            `Org ${organizationId} user ${context.userId} holds unrecognised role assignments: ` +
                `${rawRoles.filter((r) => !isKnownRole(r)).join(", ")}. Ignored.`,
        );
    }

    if (context.isSuperAdmin || context.isOrgAdmin) {
        return {
            organizationId,
            enforcement: strict ? "strict" : "compatibility",
            roles: ["administrator"],
            permissions: [...organizationPermissionTypes],
        };
    }

    // Compatibility mode intentionally preserves today's authenticated-user behavior.
    const effectiveRoles: OrganizationRoleType[] = strict ? roles : ["administrator"];
    return {
        organizationId,
        enforcement: strict ? "strict" : "compatibility",
        roles,
        permissions: permissionsForRoles(effectiveRoles),
    };
}

export function requireOrganizationPermission(
    permission: OrganizationPermission,
    deps: OrganizationAuthorizationDeps = DEFAULT_DEPS,
) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const authorization = await resolveOrganizationAuthorization(req, deps);
            if (!authorization.permissions.includes(permission)) {
                res.status(403).json({
                    error: "Forbidden",
                    requiredPermission: permission,
                    enforcement: authorization.enforcement,
                    assignedRoles: authorization.roles,
                });
                return;
            }
            (req as any).organizationAuthorization = authorization;
            next();
        } catch (error) {
            next(error);
        }
    };
}

export async function getOrganizationRoleAssignments(organizationId: number) {
    return await db
        .select()
        .from(organizationRoleAssignments)
        .where(eq(organizationRoleAssignments.organizationId, organizationId));
}

export async function setOrganizationUserRoles(
    organizationId: number,
    targetUserId: string,
    roles: OrganizationRoleType[],
    createdBy?: string
) {
    const [membership] = await db
        .select({ userId: userOrgs.userId })
        .from(userOrgs)
        .where(and(eq(userOrgs.orgId, organizationId), eq(userOrgs.userId, targetUserId)))
        .limit(1);

    if (!membership) {
        throw Object.assign(new Error("Operational roles can only be assigned to members of this organization"), { status: 400 });
    }

    await db.transaction(async (tx) => {
        await tx.delete(organizationRoleAssignments).where(and(
            eq(organizationRoleAssignments.organizationId, organizationId),
            eq(organizationRoleAssignments.userId, targetUserId),
        ));
        if (roles.length > 0) {
            await tx.insert(organizationRoleAssignments).values(roles.map((role) => ({
                organizationId,
                userId: targetUserId,
                role,
                createdBy: createdBy || null,
            })));
        }
    });
}
