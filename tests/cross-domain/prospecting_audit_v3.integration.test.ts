/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.setConfig({ testTimeout: 60000 });
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
    prospectEvents,
    errorDiagnoses
} from "../../shared/schema/index.js";
import { eq, and, like } from "drizzle-orm";
import { prospectingService } from "../../server/domain/prospecting/prospecting.service.js";
import { grantOrgMembership } from "../helpers/org-membership.js";

// Environment sync repair
if (typeof TextEncoder !== 'undefined' && typeof Uint8Array !== 'undefined') {
    const encoded = new TextEncoder().encode("");
    if (!(encoded instanceof Uint8Array)) {
        (global as any).Uint8Array = encoded.constructor;
    }
}

describe("Prospecting Pod API Deep Audit", () => {
    let testUsername = `prospect_audit_${Date.now()}`;
    let testEmail = `prospect_audit_${Date.now()}@example.com`;
    let testPassword = "Password123!";
    let testOrgId: number;
    let testProperty: any;
    let authCookie: string[];
    let csrfToken: string;
    let prospectingCookie: string;

    const testPropUid = `prop_${Date.now()}`;

    beforeAll(async () => {
        // The app installs a boot gate that answers 503 to every request until
        // BootstrapService.initialize finishes. Registering routes by hand does
        // not lift that gate, so the first request in this hook raced it and came
        // back as a 503 startup page. Await the promise the server exports.
        await serverReady;

        // 2. Ensure Test Database Connection & Context
        const [org] = await db.insert(orgs).values({
            name: "Prospect Audit Org",
            slug: `prospect_${Date.now()}`
        }).returning();
        testOrgId = org.id;

        // 3. Register user properly (handles password hashing).
        //    The response is checked: an unasserted setup request meant a
        //    failed registration surfaced later as "cannot read properties of
        //    undefined (reading 'id')" when the lookup below found no user.
        const registration = await request(app).post('/api/register').send({
            username: testUsername,
            email: testEmail,
            password: testPassword,
        });
        if (registration.status >= 400) {
            throw new Error(`Registration failed (${registration.status}): ${JSON.stringify(registration.body)}`);
        }

        // 4. Promote to Admin and associate with Org
        const [user] = await db.select().from(users).where(eq(users.username, testUsername)).limit(1);
        await db.update(users).set({ isAdmin: true, defaultOrgId: testOrgId }).where(eq(users.id, user.id));

        await db.insert(userOrgs).values({
            userId: user.id,
            orgId: testOrgId,
        });

        // One admin role per user: replace the org_admin role signup provisions.
        await db.delete(adminRoles).where(eq(adminRoles.userId, user.id));
        await db.insert(adminRoles).values({
            userId: user.id,
            role: "super_admin",
        });

        // 3. Create a test property
        [testProperty] = await db.insert(prospectProperties).values({
            organizationId: testOrgId,
            uid: testPropUid,
            name: "Audit Property",
            domain: "audit.test",
        }).returning();

        // 4. Setup Authentication (Login + CSRF)
        await request(app).post('/api/register').send({
            username: testUsername,
            email: testEmail,
            password: testPassword,
        });
        await grantOrgMembership(testUsername, testOrgId);

        const loginRes = await request(app)
            .post("/api/login")
            .send({ username: testUsername, password: testPassword });
        
        authCookie = loginRes.header["set-cookie"] as unknown as string[];

        const userRes = await request(app)
            .get("/api/user")
            .set("Cookie", authCookie);
        
        csrfToken = userRes.body.csrfToken;
        expect(csrfToken).toBeDefined();
    });

    afterAll(async () => {
        // Cleanup resources
        await db.delete(prospectEvents).where(eq(prospectEvents.organizationId, testOrgId));
        await db.delete(prospectLeads).where(eq(prospectLeads.organizationId, testOrgId));
        await db.delete(prospectProfiles).where(eq(prospectProfiles.organizationId, testOrgId));
        await db.delete(prospectProperties).where(eq(prospectProperties.organizationId, testOrgId));
        
        const testUser = (await db.select().from(users).where(eq(users.username, testUsername)).limit(1))[0];
        if (testUser) {
            await db.delete(adminRoles).where(eq(adminRoles.userId, testUser.id));
            await db.delete(userOrgs).where(eq(userOrgs.userId, testUser.id));
            await db.delete(users).where(eq(users.id, testUser.id));
        }
        await db.delete(orgs).where(eq(orgs.id, testOrgId));
    });

    describe("Anonymous Event Tracking & Lead Generation", () => {
        let prospectUid: string;

        it("should ingest an anonymous page_view event and generate a lead (SYNC)", async () => {
            // We use the service directly for SYNC validation of the logic pod
            const result = await prospectingService.processEvent({
                propertyUid: testPropUid,
                activity: "page_view",
                url: "https://audit.test/home",
                payload: { sessionId: "sess_123" }
            });

            expect(result.uid).toBeDefined();
            expect(result.leadId).toBeDefined();
            prospectUid = result.uid;

            // Verify DB state immediately
            const [lead] = await db.select().from(prospectLeads).where(eq(prospectLeads.id, result.leadId));
            console.log("[PROSPECTING AUDIT] Lead in DB:", lead);
            expect(lead).toBeDefined();

            const [profile] = await db.select().from(prospectProfiles).where(eq(prospectProfiles.id, lead.profileId));
            console.log("[PROSPECTING AUDIT] Profile in DB:", profile);
            expect(profile).toBeDefined();
            expect(profile.propertyId).toBe(testProperty.id);

            expect(lead.status).toBe("anonymous");
        });

        it("should link subsequent events to the same prospect profile", async () => {
            const result = await prospectingService.processEvent({
                propertyUid: testPropUid,
                prospectUid: prospectUid,
                activity: "click",
                url: "https://audit.test/pricing",
                payload: { element: "pricing_matrix" }
            });

            expect(result.uid).toBe(prospectUid);
            
            const events = await db.select().from(prospectEvents).where(eq(prospectEvents.profileId, (await db.select().from(prospectLeads).where(eq(prospectLeads.id, result.leadId)))[0].profileId));
            expect(events.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe("Identity Bridge & Merging (Functional)", () => {
        it("should identify an anonymous prospect and link to a system user", async () => {
            const authUserId = `user_${Date.now()}`;
            const result = await prospectingService.identify({
                propertyUid: testPropUid,
                prospectUid: (await db.select().from(prospectProfiles).where(eq(prospectProfiles.organizationId, testOrgId))).find(p => p.uid.startsWith("v_"))?.uid || "mock-uid",
                userId: authUserId,
                email: "identified@audit.test"
            });

            expect(result.masterUid).toBeDefined();

            const profile = await db.select().from(prospectProfiles).where(eq(prospectProfiles.userId, authUserId));
            expect(profile.length).toBe(1);
            
            const [lead] = await db.select().from(prospectLeads).where(eq(prospectLeads.profileId, profile[0].id));
            expect(lead.status).toBe("identified");
        });
    });

    describe("Property & Lead Management (API Access)", () => {
        it("should list properties for the organization with auth required", async () => {
            const res = await request(app)
                .get("/api/prospecting/properties")
                .set("Cookie", authCookie);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.some((p: any) => p.uid === testPropUid)).toBe(true);
        });

        it("should retrieve leads for a property", async () => {
            const res = await request(app)
                .get(`/api/prospecting/properties/${testProperty.id}/leads`)
                .set("Cookie", authCookie);

            expect(res.status).toBe(200);
            expect(res.body.length).toBeGreaterThan(0);
        });

        it("should update property settings using CSRF protection", async () => {
            const res = await request(app)
                .put(`/api/prospecting/properties/${testProperty.id}`)
                .set("Cookie", authCookie)
                .set("x-csrf-token", csrfToken)
                .send({
                    name: "Updated Audit Prop",
                    uiConfig: { hydration: "on_load", themeColor: "#00ff00" }
                });

            expect(res.status).toBe(200);
            expect(res.body.name).toBe("Updated Audit Prop");
            expect(res.body.uiConfig.themeColor).toBe("#00ff00");
        });

        it("should retrieve leads for a property with proper ownership enforcement", async () => {
            const res = await request(app)
                .get(`/api/prospecting/properties/${testProperty.id}/leads`)
                .set("Cookie", authCookie);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeGreaterThan(0);
        });

        it("should prevent unauthorized cross-organization lead access", async () => {
            const otherPrefix = `other_${Date.now()}`;
            const otherUserUsername = `${otherPrefix}_user`;
            const otherUserEmail = `${otherPrefix}@test.com`;
            const otherUserPassword = "Password123!";

            const [otherOrg] = await db.insert(orgs).values({ name: `Other Org ${otherPrefix}`, slug: otherPrefix }).returning();
            
            await request(app).post('/api/register').send({
                username: otherUserUsername,
                email: otherUserEmail,
                password: otherUserPassword,
            });
            await grantOrgMembership(otherUserUsername, otherOrg.id);

            const otherLogin = await request(app).post("/api/login").send({ username: otherUserUsername, password: otherUserPassword });
            const otherAuth = otherLogin.header["set-cookie"] as unknown as string[];

            const res = await request(app)
                .get(`/api/prospecting/properties/${testProperty.id}/leads`)
                .set("Cookie", otherAuth);

            if (res.status === 200) {
                console.error("[PROSPECTING AUDIT] SECURITY LEAK: Unauthorized user accessed cross-org leads!");
            }
            // Exact, not a set that admitted 500. The boundary held, but the
            // service threw a bare Error, so this denial was served as an
            // INTERNAL_ERROR — indistinguishable from a crash, and it filed an
            // error_diagnoses row on every probe (which is what used to break the
            // cleanup below). 404 rather than 403: the reply must not confirm that
            // a property with this id exists in some other org.
            expect(res.status).toBe(404);
            
            const [otherUser] = await db.select().from(users).where(eq(users.username, otherUserUsername)).limit(1);
            if (otherUser) {
                await db.delete(userOrgs).where(eq(userOrgs.userId, otherUser.id));
                await db.delete(users).where(eq(users.id, otherUser.id));
            }
            await db.delete(errorDiagnoses).where(eq(errorDiagnoses.organizationId, otherOrg.id));
            await db.delete(orgs).where(eq(orgs.id, otherOrg.id));
        });
    });
});
