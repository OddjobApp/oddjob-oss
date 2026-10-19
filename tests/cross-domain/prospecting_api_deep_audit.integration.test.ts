/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app, serverReady } from "../../server/index.js";
import { db, pool } from "../../server/database_service.js";
import { 
    users, 
    orgs, 
    userOrgs, 
    adminRoles, 
    prospectProperties, 
    prospectProfiles, 
    prospectLeads, 
    prospectEvents 
} from "../../shared/schema/index.js";
import { eq, and, like } from "drizzle-orm";
import { passwordService } from "@server/domain/auth/core/password-service.js";

describe("Prospecting Pod API Deep Audit", () => {
    let testUsername = `prospect_audit_${Date.now()}`;
    let testEmail = `prospect_audit_${Date.now()}@example.com`;
    let testPassword = "Password123!";
    let testOrgId: number;
    let authCookie: string[];
    let csrfToken: string;

    beforeAll(async () => {
        // The app installs a boot gate that answers 503 to every request until
        // BootstrapService.initialize finishes. Registering routes by hand does
        // not lift that gate, so the first request in this hook raced it and came
        // back as a 503 startup page. Await the promise the server exports.
        await serverReady;

        const [org] = await db.insert(orgs).values({
            // Unique per run: a fixed name collided with orgs_name_unique on any test
            // database that had seen a previous run.
            name: `Prospect Audit Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            slug: `prospect_${Date.now()}`
        }).returning();
        testOrgId = org.id;

        // Hashed, because /api/login compares against a hash. The row carried
        // the plaintext, so the login below returned no set-cookie and every
        // request in the file went out with `Cookie: undefined`.
        const [user] = await db.insert(users).values({
            username: testUsername,
            email: testEmail,
            password: await passwordService.hashPassword(testPassword),
            defaultOrgId: testOrgId,
            isAdmin: true,
        }).returning();

        await db.insert(userOrgs).values({
            userId: user.id,
            // The column is orgId. `organizationId` is not a key on this table,
            // and drizzle drops an unknown key rather than rejecting it, so the
            // insert reached postgres with org_id defaulting to null — a
            // not-null violation in beforeAll, which skipped every test in the
            // file behind it.
            orgId: testOrgId,
        });

        await db.insert(adminRoles).values({
            userId: user.id,
            role: "super_admin",
        });

        // No /api/register here: the user above already exists, so registering
        // the same username only produced a failed request whose result was
        // never checked.
        const loginRes = await request(app)
            .post("/api/login")
            .send({ username: testUsername, password: testPassword });
        
        authCookie = loginRes.header["set-cookie"] as unknown as string[];

        const userRes = await request(app)
            .get("/api/user")
            .set("Cookie", authCookie);
        
        csrfToken = userRes.body.csrfToken;
    });

    afterAll(async () => {
        await db.delete(users).where(like(users.username, 'prospect_audit_%'));
        await db.delete(orgs).where(eq(orgs.id, testOrgId));
    });

    it("should reach the server and have a consistent environment", async () => {
        const res = await request(app).get("/api/user").set("Cookie", authCookie);
        expect(res.status).toBe(200);
        const encoded = new TextEncoder().encode("");
        expect(encoded instanceof Uint8Array).toBe(true);
    });
});
