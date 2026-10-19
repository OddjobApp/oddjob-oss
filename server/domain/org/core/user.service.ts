import { db } from "@server/database_service.js";
import { users, userOrgs, adminRoles, orgs, type User } from "@shared/schema/index.js";
import { eq, or, and, inArray, sql, desc } from "drizzle-orm";
import { hashPassword } from "@server/domain/auth/index.js";
import { BadRequestError, NotFoundError, ForbiddenError } from "@server/utils/errors.js";
import { type OrgContext } from "../../../utils/auth-context.js";
import { parseAdminUserUpdate, parseSelfProfileUpdate } from "./self-profile.service.js";

export class UserService {
    /**
     * List users based on organization context.
     */
    async listUsers(context: OrgContext, filterOrgId?: number) {
        let allUsers: User[];
        const targetOrgId = filterOrgId || context.organizationId;

        // Super Admin Case
        if (context.isSuperAdmin) {
            if (targetOrgId) {
                // Filter by specific org
                const orgUserIds = await db.select({ userId: userOrgs.userId }).from(userOrgs).where(eq(userOrgs.orgId, targetOrgId));
                const userIds = orgUserIds.map(u => u.userId);

                if (userIds.length > 0) {
                    allUsers = await db.select().from(users).where(or(inArray(users.id, userIds), eq(users.defaultOrgId, targetOrgId)));
                } else {
                    allUsers = await db.select().from(users).where(eq(users.defaultOrgId, targetOrgId));
                }
            } else {
                // Return all users
                allUsers = await db.select().from(users);
            }
        }
        // Org Admin / Regular User Case (Scoped to their Org)
        else if (context.organizationId !== null) {
            // Ensure they are strictly scoped to their own org, regardless of param
            const scopedOrgId = context.organizationId;

            const orgUserIds = await db.select({ userId: userOrgs.userId }).from(userOrgs).where(eq(userOrgs.orgId, scopedOrgId));
            const userIds = orgUserIds.map(u => u.userId);

            if (userIds.length > 0) {
                allUsers = await db.select().from(users).where(or(inArray(users.id, userIds), eq(users.defaultOrgId, scopedOrgId)));
            } else {
                allUsers = await db.select().from(users).where(eq(users.defaultOrgId, scopedOrgId));
            }
        } else {
            allUsers = [];
        }

        // Return users without passwords
        return allUsers.map(({ password, pin, ...user }) => user);
    }

    /**
     * Get a single user by ID.
     */
    async getUser(userId: string, context: OrgContext) {
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!user) throw new NotFoundError("User not found");

        // Access Check
        if (context.isSuperAdmin) {
            const { password, pin, ...safeUser } = user;
            return safeUser;
        }

        if (context.organizationId !== null) {
            // Check if user belongs to the same org
            const [userOrg] = await db.select().from(userOrgs)
                .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, context.organizationId)))
                .limit(1);

            // Or if it's their default org (edge case)
            if (!userOrg && user.defaultOrgId !== context.organizationId) {
                throw new ForbiddenError("Access denied");
            }

            const { password, pin, ...safeUser } = user;
            return safeUser;
        }

        throw new ForbiddenError("Access denied");
    }

    /**
     * Get a user by username (Internal use primarily)
     */
    async getUserByUsername(username: string): Promise<any> {
        const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
        if (!user) return undefined;
        // Strip password
        const { password, pin, ...safeUser } = user;
        return safeUser;
    }

    /**
     * Get a user by Slack handle (for Slack integration user recognition)
     */
    async getUserBySlackHandle(slackHandle: string, organizationId?: number): Promise<any> {
        // First find by slack handle
        const slackUsers = await db.select().from(users).where(eq(users.slackHandle, slackHandle));

        if (slackUsers.length === 0) return undefined;

        // If organization specified, filter to users in that org
        let matchingUsers = slackUsers;
        if (organizationId && slackUsers.length > 0) {
            const userIds = slackUsers.map(u => u.id);

            // Get users that belong to this org (via defaultOrgId or userOrgs)
            const orgUserIds = await db
                .select({ userId: userOrgs.userId })
                .from(userOrgs)
                .where(and(
                    inArray(userOrgs.userId, userIds),
                    eq(userOrgs.orgId, organizationId)
                ));
            const orgUserIdSet = new Set(orgUserIds.map(u => u.userId));

            matchingUsers = slackUsers.filter(u =>
                u.defaultOrgId === organizationId || orgUserIdSet.has(u.id)
            );
        }

        const user = matchingUsers[0];
        if (!user) return undefined;

        // Strip password
        const { password, pin, ...safeUser } = user;
        return safeUser;
    }

    /**
     * Create a new user.
     */
    async createUser(data: Partial<User> & { organizationId: number }, context: OrgContext) {
        // Permission Check: Must be Admin
        if (!context.isAdmin) throw new ForbiddenError("Admin access required to create users");

        // Scope Check: Org Admins can only create in their org
        if (context.isOrgAdmin && context.organizationId !== data.organizationId) {
            throw new ForbiddenError("Cannot create users outside your organization");
        }

        const [org] = await db.select().from(orgs).where(eq(orgs.id, data.organizationId)).limit(1);
        if (!org) throw new NotFoundError("Organization not found");

        if (!data.username || !data.password) throw new BadRequestError("Username and password are required");

        const hashedPassword = await hashPassword(data.password);
        const [newUser] = await db.insert(users).values({
            username: data.username,
            password: hashedPassword,
            email: data.email || null,
            firstName: data.firstName || null,
            lastName: data.lastName || null,
            defaultOrgId: data.organizationId,
        }).returning();

        await db.insert(userOrgs).values({ userId: newUser.id, orgId: data.organizationId });

        const { password: _, ...safeUser } = newUser;
        return safeUser;
    }

    /**
     * Update a user.
     */
    async updateUser(targetUserId: string, updates: unknown, context: OrgContext, currentSessionUserId: string) {
        const [existingUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
        if (!existingUser) throw new NotFoundError("User not found");

        // Permission Check
        const isSelf = targetUserId === currentSessionUserId;
        if (!context.isAdmin && !isSelf) {
            throw new ForbiddenError("You can only update your own profile");
        }

        // Scope Check for Org Admins
        if (context.isOrgAdmin && !isSelf && context.organizationId !== null) {
            const [userOrg] = await db.select().from(userOrgs)
                .where(and(eq(userOrgs.userId, targetUserId), eq(userOrgs.orgId, context.organizationId)))
                .limit(1);

            if (!userOrg && existingUser.defaultOrgId !== context.organizationId) {
                throw new ForbiddenError("Access denied");
            }
        }

        // Allow-listed, never the raw body: this used to `.set(req.body)`, so a
        // user could rewrite their own password, pin, username, defaultOrgId or
        // legal flags. A non-admin gets the self-service fields; an admin gets
        // what the admin UI edits. Unknown fields are rejected by name.
        const allowed = context.isAdmin
            ? parseAdminUserUpdate(updates)
            : parseSelfProfileUpdate(updates, existingUser.email);

        const [updatedUser] = Object.keys(allowed).length > 0
            ? await db.update(users).set(allowed).where(eq(users.id, targetUserId)).returning()
            : [existingUser];

        const { password, pin, ...safeUser } = updatedUser;
        return safeUser;
    }

    /**
     * Delete a user.
     */
    async deleteUser(targetUserId: string, context: OrgContext) {
        if (!context.isAdmin) throw new ForbiddenError("Admin access required");

        const [existingUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
        if (!existingUser) throw new NotFoundError("User not found");

        // Safety Checks for Last Admin
        if (context.isOrgAdmin && context.organizationId !== null) {
            // Ensure target is in this org
            const [userOrg] = await db.select().from(userOrgs)
                .where(and(eq(userOrgs.userId, targetUserId), eq(userOrgs.orgId, context.organizationId)))
                .limit(1);
            if (!userOrg && existingUser.defaultOrgId !== context.organizationId) throw new ForbiddenError("Access denied");

            // Check if removing last admin
            const [userAdminRole] = await db.select().from(adminRoles)
                .where(and(eq(adminRoles.userId, targetUserId), eq(adminRoles.role, "org_admin"), eq(adminRoles.organizationId, context.organizationId)))
                .limit(1);

            if (userAdminRole) {
                const otherAdmins = await db.select().from(adminRoles)
                    .where(and(
                        eq(adminRoles.role, "org_admin"),
                        eq(adminRoles.organizationId, context.organizationId),
                        sql`${adminRoles.userId} != ${targetUserId}`
                    ));
                if (otherAdmins.length === 0) throw new BadRequestError("Cannot delete the last admin in an organization");
            }
        }
        else if (context.isSuperAdmin) {
            // General "Last Admin" check if they have a role
            const [userAdminRole] = await db.select().from(adminRoles).where(eq(adminRoles.userId, targetUserId)).limit(1);
            if (userAdminRole?.role === "org_admin" && userAdminRole.organizationId) {
                const otherAdmins = await db.select().from(adminRoles)
                    .where(and(
                        eq(adminRoles.role, "org_admin"),
                        eq(adminRoles.organizationId, userAdminRole.organizationId),
                        sql`${adminRoles.userId} != ${targetUserId}`
                    ));
                if (otherAdmins.length === 0) throw new BadRequestError("Cannot delete the last admin in an organization");
            }
        }

        await db.delete(users).where(eq(users.id, targetUserId));
    }
}

export const userService = new UserService();


