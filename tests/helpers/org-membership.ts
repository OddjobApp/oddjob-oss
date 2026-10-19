import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { adminRoles, userOrgs, users } from "@shared/schema/index.js";

/**
 * Make a registered user a plain member of an organization, working in it by
 * default — the shape integration suites were written against.
 *
 * Suites used to register with `defaultOrgId` in the body, which placed the
 * user in that org directly. That was the bug: public registration let anyone
 * join any tenant. Signup now provisions the user's own organization and makes
 * them its admin, and an admin role decides the working org ahead of the
 * default. So the fixture adds the membership, points the default at it, and
 * drops the signup-provisioned org_admin role.
 */
export async function grantOrgMembership(username: string, orgId: number): Promise<void> {
    const [user] = await db.select({ id: users.id }).from(users)
        .where(eq(users.username, username.toLowerCase())).limit(1);
    if (!user) throw new Error(`grantOrgMembership: no user registered as "${username}"`);
    const [existing] = await db.select({ orgId: userOrgs.orgId }).from(userOrgs)
        .where(and(eq(userOrgs.userId, user.id), eq(userOrgs.orgId, orgId))).limit(1);
    if (!existing) await db.insert(userOrgs).values({ userId: user.id, orgId });
    await db.update(users).set({ defaultOrgId: orgId }).where(eq(users.id, user.id));
    await db.delete(adminRoles).where(and(eq(adminRoles.userId, user.id), eq(adminRoles.role, "org_admin")));
}
