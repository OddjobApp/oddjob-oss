/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock stripe module — must use regular function not arrow function for constructor
vi.mock("stripe", () => {
    class MockStripe {
        customers = { create: vi.fn().mockResolvedValue({ id: "cus_mock_123" }) };
        checkout = { sessions: { create: vi.fn().mockResolvedValue({ url: "https://stripe.com/checkout/mock_123" }) } };
        webhooks = {
            constructEvent: vi.fn().mockImplementation((payload: string) => {
                const parsed = JSON.parse(payload);
                return {
                    type: parsed.type || "checkout.session.completed",
                    data: {
                        object: parsed.data?.object || { metadata: { orgId: "1" }, subscription: "sub_mock_123" }
                    }
                };
            })
        };
    }
    return { default: MockStripe };
});

import request from "supertest";
import { app, serverReady } from "@server/index.js";
import { db } from "@server/database_service.js";
import { orgs, userOrgs, appPayouts, apps } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
import { stripeService } from "@domain/billing/stripe.service.js";
import { grantOrgMembership } from "../../../../../tests/helpers/org-membership.js";

describe("Billing Pod API Deep Audit", () => {
    let testUsername = `billing_audit_${Date.now()}`;
    let testEmail = `billing_audit_${Date.now()}@example.com`;
    let testPassword = "Password123!";
    let testOrgId: number;
    let authCookie: string[];

    /** A real app row: app_payouts.app_id has an FK, so "mock app ID 1" fails. */
    let testAppId: number;

    beforeAll(async () => {
        await serverReady;

        // 1. Create Organization (use unique name to avoid duplicate key conflicts)
        const [org] = await db.insert(orgs).values({
            name: `Billing Audit Org ${Date.now()}`
        }).returning();
        testOrgId = org.id;

        // 2. Register/Login User
        await request(app).post('/api/register').send({
            username: testUsername,
            email: testEmail,
            password: testPassword,
        });
        await grantOrgMembership(testUsername, testOrgId);

        const loginRes = await request(app).post('/api/login').send({
            username: testUsername,
            password: testPassword
        });
        authCookie = loginRes.header["set-cookie"] as unknown as string[];

        // 3. Create the app the payouts below are attributed to. name and slug
        //    are unique, so they carry the same suffix as the org.
        const suffix = `${testOrgId}-${Date.now()}`;
        const [appRow] = await db.insert(apps).values({
            name: `Billing Audit App ${suffix}`,
            slug: `billing-audit-app-${suffix}`,
        }).returning();
        testAppId = appRow.id;
    });

    afterAll(async () => {
        await db.delete(appPayouts).where(eq(appPayouts.developerOrgId, testOrgId));
        // Payouts reference the app, so it goes after them.
        if (testAppId) await db.delete(apps).where(eq(apps.id, testAppId));
        await db.delete(userOrgs).where(eq(userOrgs.orgId, testOrgId));
        await db.delete(orgs).where(eq(orgs.id, testOrgId));
    });

    describe("Checkout Session Lifecycle", () => {
        it("should create a checkout session and return a Stripe URL", async () => {
            const res = await request(app)
                .post("/api/billing/checkout")
                .set("Cookie", authCookie)
                .send({
                    planId: "price_pro_monthly",
                    successUrl: "http://localhost:5000/success",
                    cancelUrl: "http://localhost:5000/cancel"
                });

            expect(res.status).toBe(200);
            expect(res.body.url).toContain("stripe.com/checkout");

            // Verify customer ID was saved to org
            const [org] = await db.select().from(orgs).where(eq(orgs.id, testOrgId));
            expect(org.stripeCustomerId).toBe("cus_mock_123");
        });

        it("should reject checkout without organization context", async () => {
            // Unauthenticated request
            const res = await request(app)
                .post("/api/billing/checkout")
                .send({ planId: "price_pro" });

            expect(res.status).toBe(401);
        });
    });

    describe("Webhook Event Processing", () => {
        it("should activate subscription on checkout.session.completed", async () => {
            const payload = JSON.stringify({
                type: "checkout.session.completed",
                data: {
                    object: {
                        metadata: { orgId: testOrgId.toString() },
                        subscription: "sub_active_123"
                    }
                }
            });

            const res = await request(app)
                .post("/api/billing/webhook")
                .set("stripe-signature", "mock_signature")
                .send(payload);

            expect(res.status).toBe(200);
            expect(res.body.received).toBe(true);

            // Verify DB state
            const [org] = await db.select().from(orgs).where(eq(orgs.id, testOrgId));
            expect(org.subscriptionStatus).toBe("active");
            expect(org.stripeSubscriptionId).toBe("sub_active_123");
        });

        it("should cancel subscription on customer.subscription.deleted", async () => {
            const payload = JSON.stringify({
                type: "customer.subscription.deleted",
                data: {
                    object: {
                        id: "sub_active_123"
                    }
                }
            });

            const res = await request(app)
                .post("/api/billing/webhook")
                .set("stripe-signature", "mock_signature")
                .send(payload);

            expect(res.status).toBe(200);

            // Verify DB state
            const [org] = await db.select().from(orgs).where(eq(orgs.id, testOrgId));
            expect(org.subscriptionStatus).toBe("canceled");
        });
    });

    describe("Payouts & Earnings Management", () => {
        it("should track accrued earnings accurately", async () => {
            // Seed some payouts
            await db.insert(appPayouts).values([
                {
                    developerOrgId: testOrgId,
                    appId: testAppId,
                    amountUsd: "50.000000",
                    status: "pending",
                    createdAt: new Date()
                },
                {
                    developerOrgId: testOrgId,
                    appId: testAppId,
                    amountUsd: "25.500000",
                    status: "completed",
                    createdAt: new Date()
                }
            ]);

            const res = await request(app)
                .get("/api/billing/accrued")
                .set("Cookie", authCookie);

            expect(res.status).toBe(200);
            expect(res.body.total).toBe(75.5);
        });

        it("should list payout history", async () => {
            const res = await request(app)
                .get("/api/billing/payouts")
                .set("Cookie", authCookie);

            expect(res.status).toBe(200);
            expect(res.body.length).toBe(2);
            expect(parseFloat(res.body[0].amountUsd)).toBeDefined();
        });

        it("should enforce tenant isolation for payouts", async () => {
            // Create another org and user
            const otherOrgId = testOrgId + 999; // Mock ID or create real
            const otherOrgTs = Date.now();
            const [otherOrg] = await db.insert(orgs).values({
                name: `Other Org ${otherOrgTs}`
            }).returning();

            // Registered user login for other org
            await request(app).post('/api/register').send({
                username: `other_user_${otherOrgTs}`,
                email: `other_${otherOrgTs}@test.com`,
                password: "Password123!",
            });
            await grantOrgMembership(`other_user_${otherOrgTs}`, otherOrg.id);
            const loginRes = await request(app).post('/api/login').send({
                username: `other_user_${otherOrgTs}`,
                password: "Password123!"
            });
            const otherCookie = loginRes.header["set-cookie"];

            // Try to access testOrgId's accrued earnings (should be 0 for this new org)
            const res = await request(app)
                .get("/api/billing/accrued")
                .set("Cookie", otherCookie);

            expect(res.status).toBe(200);
            expect(res.body.total).toBe(0);

            // Cleanup
            await db.delete(userOrgs).where(eq(userOrgs.orgId, otherOrg.id));
            await db.delete(orgs).where(eq(orgs.id, otherOrg.id));
        });
    });
});
