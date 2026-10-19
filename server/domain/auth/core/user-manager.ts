import { db } from "@server/database_service.js";
import { users, adminRoles } from "@shared/schema/index.js";
import { eq, or } from "drizzle-orm";
import { NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("UserManager");

/**
 * Service for user data management and role resolution.
 */
export const userManager = {
    /**
     * Find a user by username or email.
     */
    async findByUsernameOrEmail(identifier: string) {
        console.log(`[UserManager] Searching for: ${identifier}`);
        const result = await db
            .select()
            .from(users)
            .where(or(eq(users.username, identifier), eq(users.email, identifier)))
            .limit(1);
        console.log(`[UserManager] Found user:`, !!result[0], result[0]?.id);
        return result[0];
    },

    /**
     * Get full user details including admin roles.
     */
    async getUserWithRoles(userId: string | number) {
        const userIdStr = String(userId);

        const [user] = await db.select().from(users).where(eq(users.id, userIdStr)).limit(1);
        if (!user) throw new NotFoundError("User not found");

        // Neither credential leaves the server. The PIN hash used to ride along to
        // /api/login, /api/user and /api/users/current; a 6-digit PIN's hash falls
        // to offline brute force in seconds. PIN checks read it themselves.
        const { password: _, pin: _pin, ...userWithoutPassword } = user;

        let adminRole = null;
        try {
            const [role] = await db
                .select()
                .from(adminRoles)
                .where(eq(adminRoles.userId, userIdStr))
                .limit(1);
            adminRole = role || null;
        } catch (e: any) {
            logger.error(`Error querying adminRoles: ${e.message}`);
        }

        const adminRoleResponse = adminRole ? {
            isSuperAdmin: adminRole.role === "super_admin",
            isOrgAdmin: adminRole.role === "org_admin",
            organizationId: adminRole.organizationId,
        } : {
            isSuperAdmin: false,
            isOrgAdmin: false,
            organizationId: null,
        };

        return { ...userWithoutPassword, adminRole: adminRoleResponse };
    },

    /**
     * Check if a user exists by username or email.
     */
    async exists(username: string, email?: string) {
        const [existing] = await db
            .select()
            .from(users)
            .where(or(eq(users.username, username), eq(users.email, email || "")))
            .limit(1);
        return !!existing;
    },

    /**
     * Create a new user record.
     */
    async createUser(values: any, executor: Pick<typeof db, "insert"> = db) {
        const [newUser] = await executor.insert(users).values(values).returning();
        const { password: _, ...userWithoutPassword } = newUser;
        return userWithoutPassword;
    },

    /**
     * Update a user record.
     */
    async updateUser(userId: string, values: any) {
        await db.update(users).set(values).where(eq(users.id, userId));
    }
};


