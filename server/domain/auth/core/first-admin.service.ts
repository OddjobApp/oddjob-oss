import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { adminRoles, orgs, userOrgs, users } from "@shared/schema/index.js";
import type * as schema from "@shared/schema/index.js";
import { passwordService } from "./password-service.js";

/**
 * Creates the first organization and its super-admin on a fresh install.
 *
 * Sign-up deliberately gives a new user no organization, and only a
 * super-admin can create one, so without this a fresh database has no way in.
 * The only other paths were the destructive demo seed (fixed demo passwords)
 * and an e2e fixture that resets admin@example.com to a known password.
 *
 * It does nothing once any super-admin exists, so running setup again — for
 * example to apply new migrations — never creates a second one.
 */

export interface FirstAdminInput {
    email: string;
    password: string;
    username: string;
    organizationName: string;
}

export type FirstAdminResult =
    | { created: true; userId: string; organizationId: number }
    | { created: false; reason: "super_admin_exists" };

export const MIN_ADMIN_PASSWORD_LENGTH = 12;

/** The user id that system-initiated work runs as (queues, system knowledge). */
export const SYSTEM_USER_ID = "oddjob-system";

/** Problems with the input, as messages; empty when it is usable. */
export function validateFirstAdminInput(input: Partial<FirstAdminInput>): string[] {
    const problems: string[] = [];
    if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
        problems.push("a valid admin email is required");
    }
    if (!input.password || input.password.length < MIN_ADMIN_PASSWORD_LENGTH) {
        problems.push(`the admin password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
    }
    if (!input.username || input.username.length < 3) {
        problems.push("the admin username must be at least 3 characters");
    }
    const org = input.organizationName?.trim() ?? "";
    if (!org || org.length > 120) {
        problems.push("the organization name must be 1–120 characters");
    }
    return problems;
}

/** "jane.doe@example.com" → "jane.doe". */
export function defaultUsernameFor(email: string): string {
    return email.split("@")[0] ?? email;
}

export async function hasSuperAdmin(database: PgDatabase<any, typeof schema, any>): Promise<boolean> {
    const [row] = await database
        .select({ id: adminRoles.id })
        .from(adminRoles)
        .where(eq(adminRoles.role, "super_admin"))
        .limit(1);
    return Boolean(row);
}

export async function bootstrapFirstAdmin(
    database: PgDatabase<any, typeof schema, any>,
    input: FirstAdminInput,
): Promise<FirstAdminResult> {
    const problems = validateFirstAdminInput(input);
    if (problems.length) throw new Error(`Cannot create the first admin: ${problems.join("; ")}.`);

    const passwordHash = await passwordService.hashPassword(input.password);
    const organizationName = input.organizationName.trim();
    // Login lowercases the identifier and compares exactly (user-manager.ts),
    // so a mixed-case email stored as typed could never sign in.
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim().toLowerCase();

    return database.transaction(async (tx) => {
        // Two setups racing on one database must not both see "no super-admin".
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('oddjob:first-admin'))`);
        if (await hasSuperAdmin(tx)) return { created: false, reason: "super_admin_exists" } as const;

        const [existingUser] = await tx
            .select({ id: users.id })
            .from(users)
            .where(sql`lower(${users.email}) = ${email} or lower(${users.username}) = ${username}`)
            .limit(1);
        if (existingUser) {
            throw new Error(
                `A user with email ${email} or username ${username} already exists. ` +
                "Choose another, or remove that account first.",
            );
        }

        const [existingOrg] = await tx.select().from(orgs).where(eq(orgs.name, organizationName)).limit(1);
        const org = existingOrg ?? (await tx.insert(orgs).values({ name: organizationName }).returning())[0];

        const [user] = await tx
            .insert(users)
            .values({
                username,
                email,
                password: passwordHash,
                defaultOrgId: org.id,
            })
            .returning({ id: users.id });

        await tx.insert(userOrgs).values({ userId: user.id, orgId: org.id });
        await tx.insert(adminRoles).values({ userId: user.id, role: "super_admin", organizationId: null });

        // System-initiated work runs as this id; make sure it is a real user.
        await tx
            .insert(users)
            .values({
                id: SYSTEM_USER_ID,
                username: "system",
                password: await passwordService.hashPassword(randomUUID()),
                firstName: "Oddjob",
                lastName: "System",
                defaultOrgId: org.id,
            })
            .onConflictDoNothing();

        return { created: true, userId: user.id, organizationId: org.id } as const;
    });
}
