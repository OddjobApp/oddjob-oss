import { COMPANY_SIZES, INDUSTRIES } from "@shared/company-profile.js";
import { userManager } from "./user-manager.js";
import { passwordService } from "./password-service.js";
import {
    BadRequestError,
    UnauthorizedError,
    ConflictError
} from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AuthEngine");

/** Postgres unique violation on orgs.name. */
function isOrgNameTaken(err: unknown): boolean {
    const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
    const code = e?.code ?? e?.cause?.code;
    const constraint = e?.constraint ?? e?.cause?.constraint ?? "";
    return code === "23505" && /orgs?_name/.test(constraint);
}

/**
 * The new user's organization. A name they chose must be free - org names are
 * unique platform-wide - and a taken one is a conflict they can fix. Without
 * one, the default is derived from the (unique) username and suffixed if
 * someone already named an org that.
 *
 * Each attempt runs in a savepoint: a failed insert inside a Postgres
 * transaction aborts the whole transaction unless it is rolled back to one.
 */
async function insertSignupOrganization(
    tx: any,
    organizationService: { insertOrganizationRecord: (executor: any, data: { name: string; companySize?: string; industry?: string }) => Promise<{ id: number }> },
    requestedName: string,
    username: string,
    profile: { companySize?: string; industry?: string } = {},
): Promise<{ id: number }> {
    const attempt = (name: string) => tx.transaction((sp: any) => organizationService.insertOrganizationRecord(sp, { name, ...profile }));
    if (requestedName) {
        try {
            return await attempt(requestedName);
        } catch (err) {
            if (isOrgNameTaken(err)) throw new ConflictError("That organization name is already taken");
            throw err;
        }
    }
    const base = `${username}'s organization`.slice(0, 110);
    for (let i = 0; i < 5; i++) {
        const name = i === 0 ? base : `${base} ${Math.random().toString(36).slice(2, 7)}`;
        try {
            return await attempt(name);
        } catch (err) {
            if (!isOrgNameTaken(err)) throw err;
        }
    }
    throw new ConflictError("Could not choose an organization name; enter one");
}

/**
 * Orchestrator for high-level authentication workflows.
 */
export const authEngine = {
    /**
     * Handle user login.
     */
    async login(username: string, password: string) {
        if (!username || !password) {
            throw new BadRequestError("Username and password are required");
        }

        const user = await userManager.findByUsernameOrEmail(username.toLowerCase());
        
        if (!user) {
            throw new UnauthorizedError("Invalid credentials");
        }

        const isValid = await passwordService.verifyPassword(password, user.password);
        
        if (!isValid) {
            throw new UnauthorizedError("Invalid credentials");
        }

        const { password: _, ...userWithoutPassword } = user;
        return { user: userWithoutPassword, internalUser: user };
    },

    /**
     * Handle user registration.
     */
    async register(input: any) {
        const { username, password, email } = input;

        if (!username || !password || !email) {
            throw new BadRequestError("Username, password, and email are required");
        }

        const passValidation = passwordService.validatePassword(password);
        if (!passValidation.valid) {
            throw new BadRequestError(passValidation.errors[0]);
        }

        const exists = await userManager.exists(username, email);
        if (exists) {
            throw new ConflictError("Username or email already exists");
        }

        const profile: { companySize?: string; industry?: string } = {};
        for (const [field, allowed] of [['companySize', COMPANY_SIZES], ['industry', INDUSTRIES]] as const) {
            const value = input[field];
            if (value === undefined || value === '') continue;
            if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new BadRequestError(`Invalid ${field}`);
            profile[field] = value;
        }

        const hashedPassword = await passwordService.hashPassword(password);

        const requestedOrgName = typeof input.organizationName === "string" ? input.organizationName.trim() : "";
        if (requestedOrgName.length > 120) {
            throw new BadRequestError("Organization name must be 120 characters or fewer");
        }

        // Self-serve signup provisions the person's own organization and makes
        // them its admin - all in one transaction, so a failure leaves neither
        // a user without an org nor an org without its admin.
        //
        // Registration is public, so only identity and legal-acceptance fields
        // come from the request. It used to spread the whole body into the users
        // row and take `defaultOrgId` from it - or, without one, the FIRST
        // organization in the table - which made any visitor a member of any
        // tenant they named. A new user never joins an existing organization
        // here; existing organizations add people themselves.
        const { db } = await import("@server/database_service.js");
        const { users, userOrgs, adminRoles } = await import("@shared/schema/index.js");
        const { eq } = await import("drizzle-orm");
        const { organizationService } = await import("@domain/org/core/organization.service.js");

        const { user, organizationId } = await db.transaction(async (tx) => {
            const created = await userManager.createUser({
                username: username.toLowerCase(),
                password: hashedPassword,
                email,
                firstName: typeof input.firstName === "string" ? input.firstName : undefined,
                lastName: typeof input.lastName === "string" ? input.lastName : undefined,
                privacyPolicyAccepted: input.privacyPolicyAccepted === true,
                privacyPolicyVersion: typeof input.privacyPolicyVersion === "string" ? input.privacyPolicyVersion : undefined,
                tosAccepted: input.tosAccepted === true,
                tosVersion: typeof input.tosVersion === "string" ? input.tosVersion : undefined,
                legalAcceptedAt: new Date(),
            }, tx);

            const org = await insertSignupOrganization(tx, organizationService, requestedOrgName, username, profile);
            await tx.insert(userOrgs).values({ userId: created.id, orgId: org.id });
            await tx.insert(adminRoles).values({ userId: created.id, role: "org_admin", organizationId: org.id });
            await tx.update(users).set({ defaultOrgId: org.id }).where(eq(users.id, created.id));
            return { user: { ...created, defaultOrgId: org.id }, organizationId: org.id };
        });

        await organizationService.seedOrganizationDefaults(organizationId, user.id);
        logger.info(`Self-serve signup provisioned organization ${organizationId} for user ${user.id}`);
        return user;
    },

    /**
     * Initiate password reset.
     */
    async requestPasswordReset(email: string) {
        const user = await userManager.findByUsernameOrEmail(email.toLowerCase());
        if (!user) return null;

        const { rawToken } = await passwordService.createResetToken(user.id);
        return { token: rawToken, email: user.email };
    },

    /**
     * Complete password reset.
     */
    async resetPassword(token: string, newPassword: string) {
        const passValidation = passwordService.validatePassword(newPassword);
        if (!passValidation.valid) {
            throw new BadRequestError(passValidation.errors[0]);
        }

        const result = await passwordService.consumeResetToken(token);
        if (!result.valid) {
            throw new BadRequestError(result.reason || "Invalid token");
        }

        const hashedPassword = await passwordService.hashPassword(newPassword);
        await userManager.updateUser(result.userId!, { password: hashedPassword });

        return { userId: result.userId };
    }
};



