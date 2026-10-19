import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema/index.js";
import { adminRoles, orgs, userOrgs, users } from "@shared/schema/index.js";
import { requireTestDatabaseUrl } from "../../../../tests/configure-test-environment.js";
import { bootstrapFirstAdmin, SYSTEM_USER_ID } from "../core/first-admin.service.js";
import { passwordService } from "../core/password-service.js";

// Every case runs inside a transaction that is rolled back, so the test
// database (which already has seeded super-admins) is left exactly as found.
class Rollback extends Error {}

describe("bootstrapFirstAdmin (integration)", () => {
    let pool: Pool;
    let db: ReturnType<typeof drizzle<typeof schema>>;

    beforeAll(() => {
        pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 2 });
        db = drizzle(pool, { schema });
    });

    afterAll(async () => {
        await pool.end();
    });

    async function inRolledBackTransaction(fn: (tx: any) => Promise<void>) {
        await expect(
            db.transaction(async (tx) => {
                await fn(tx);
                throw new Rollback();
            }),
        ).rejects.toBeInstanceOf(Rollback);
    }

    it("creates the organization, a member super-admin and the system user, once", async () => {
        const suffix = Date.now().toString(36);
        await inRolledBackTransaction(async (tx) => {
            // Simulate a fresh install: no super-admin yet.
            await tx.delete(adminRoles).where(eq(adminRoles.role, "super_admin"));

            const result = await bootstrapFirstAdmin(tx, {
                email: `Owner-${suffix}@Example.com`,
                password: "correct horse battery staple",
                username: `owner-${suffix}`,
                organizationName: `First Org ${suffix}`,
            });
            expect(result.created).toBe(true);
            if (!result.created) return;

            const [user] = await tx.select().from(users).where(eq(users.id, result.userId));
            expect(user.email).toBe(`owner-${suffix}@example.com`);
            expect(user.defaultOrgId).toBe(result.organizationId);
            expect(await passwordService.verifyPassword("correct horse battery staple", user.password)).toBe(true);

            const [org] = await tx.select().from(orgs).where(eq(orgs.id, result.organizationId));
            expect(org.name).toBe(`First Org ${suffix}`);

            const memberships = await tx.select().from(userOrgs).where(eq(userOrgs.userId, result.userId));
            expect(memberships.map((m: any) => m.orgId)).toEqual([result.organizationId]);

            const [role] = await tx.select().from(adminRoles).where(eq(adminRoles.userId, result.userId));
            expect(role).toMatchObject({ role: "super_admin", organizationId: null });

            const [system] = await tx.select().from(users).where(eq(users.id, SYSTEM_USER_ID));
            expect(system).toBeDefined();

            // A second run is a no-op.
            const again = await bootstrapFirstAdmin(tx, {
                email: `second-${suffix}@example.com`,
                password: "another long password",
                username: `second-${suffix}`,
                organizationName: `Second Org ${suffix}`,
            });
            expect(again).toEqual({ created: false, reason: "super_admin_exists" });
        });
    });

    it("does nothing when a super-admin already exists", async () => {
        await inRolledBackTransaction(async (tx) => {
            const before = await tx.select().from(adminRoles).where(eq(adminRoles.role, "super_admin"));
            if (before.length === 0) {
                const [anyUser] = await tx.select({ id: users.id }).from(users).limit(1);
                await tx.insert(adminRoles).values({ userId: anyUser.id, role: "super_admin", organizationId: null })
                    .onConflictDoNothing();
            }
            const result = await bootstrapFirstAdmin(tx, {
                email: "nobody@example.com",
                password: "a long enough password",
                username: "nobody-setup",
                organizationName: "Never Created",
            });
            expect(result).toEqual({ created: false, reason: "super_admin_exists" });
            const [org] = await tx.select().from(orgs).where(eq(orgs.name, "Never Created"));
            expect(org).toBeUndefined();
        });
    });
});
