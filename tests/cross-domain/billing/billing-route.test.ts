import express from "express";
import request from "supertest";
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
    getBillingSummary: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomerPortalSession: vi.fn(),
    handleWebhookEvent: vi.fn(),
    listPayouts: vi.fn(),
    getAccruedEarnings: vi.fn(),
    orgContext: { organizationId: 1, userId: "u1" } as { organizationId: number | null; userId: string },
}));

vi.mock("../../../server/domain/billing/stripe.service.js", () => ({
    stripeService: {
        getBillingSummary: h.getBillingSummary,
        createCheckoutSession: h.createCheckoutSession,
        createCustomerPortalSession: h.createCustomerPortalSession,
        handleWebhookEvent: h.handleWebhookEvent,
    },
}));

vi.mock("../../../server/domain/billing/payout.service.js", () => ({
    payoutService: {
        listPayouts: h.listPayouts,
        getAccruedEarnings: h.getAccruedEarnings,
    },
}));

vi.mock("../../../server/domain/auth/core/security.service.js", () => ({
    requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../server/utils/auth-context.js", () => ({
    getUserOrgContext: vi.fn(async () => h.orgContext),
    requireOrgId: (ctx: any) => {
        if (!ctx.organizationId) throw new Error("Organization context required");
        return ctx.organizationId;
    },
}));

import billingRouter from "../../../server/domain/billing/billing.route.js";

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/billing", billingRouter);
    app.use((err: any, _req: any, res: any, _next: any) => {
        res.status(err.statusCode ?? err.status ?? 500).json({ error: err.message });
    });
    return app;
}

const app = makeApp();

describe("Billing API Routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.orgContext = { organizationId: 1, userId: "u1" };
    });

    it("GET /api/billing/plans returns the available subscription plans", async () => {
        const res = await request(app).get("/api/billing/plans");
        expect(res.status).toBe(200);
        expect(res.body.plans).toBeDefined();
        expect(Array.isArray(res.body.plans)).toBe(true);
        expect(res.body.plans.some((p: any) => p.id === "pro")).toBe(true);
        expect(res.body.plans.some((p: any) => p.id === "starter")).toBe(true);
    });

    it("GET /api/billing/summary returns the org billing summary", async () => {
        const mockSummary = {
            organizationId: 1,
            organizationName: "Test Org",
            currentPlan: { id: "pro", name: "Pro" },
            subscriptionStatus: "active",
            hasCustomerAccount: true,
            usage: {
                missionsThisMonth: 10,
                missionsLimit: 1500,
                seatsUsed: 3,
                seatsLimit: 10,
            },
        };
        h.getBillingSummary.mockResolvedValue(mockSummary);

        const res = await request(app).get("/api/billing/summary");
        expect(res.status).toBe(200);
        expect(res.body).toEqual(mockSummary);
        expect(h.getBillingSummary).toHaveBeenCalledWith(1);
    });

    it("POST /api/billing/checkout initiates a checkout session", async () => {
        h.createCheckoutSession.mockResolvedValue({ url: "https://stripe.com/checkout/123" });

        const res = await request(app)
            .post("/api/billing/checkout")
            .send({ planId: "pro" });

        expect(res.status).toBe(200);
        expect(res.body.url).toBe("https://stripe.com/checkout/123");
        expect(h.createCheckoutSession).toHaveBeenCalledWith(
            1,
            "pro",
            expect.stringContaining("/workspace/settings?billing=success"),
            expect.stringContaining("/workspace/settings?billing=cancelled")
        );
    });

    it("POST /api/billing/checkout validates required planId", async () => {
        const res = await request(app)
            .post("/api/billing/checkout")
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toContain("planId is required");
    });

    it("POST /api/billing/portal creates a customer portal session", async () => {
        h.createCustomerPortalSession.mockResolvedValue({ url: "https://billing.stripe.com/portal/test" });

        const res = await request(app)
            .post("/api/billing/portal")
            .send({ returnUrl: "http://localhost:5000/workspace/settings" });

        expect(res.status).toBe(200);
        expect(res.body.url).toBe("https://billing.stripe.com/portal/test");
        expect(h.createCustomerPortalSession).toHaveBeenCalledWith(
            1,
            "http://localhost:5000/workspace/settings"
        );
    });

    it("POST /api/billing/webhook rejects requests missing signature", async () => {
        const res = await request(app)
            .post("/api/billing/webhook")
            .send({ type: "payment_intent.succeeded" });

        expect(res.status).toBe(400);
        expect(res.body.error).toContain("Missing stripe-signature header");
    });

    it("POST /api/billing/webhook delegates to stripeService with signature", async () => {
        h.handleWebhookEvent.mockResolvedValue({ received: true });

        const res = await request(app)
            .post("/api/billing/webhook")
            .set("stripe-signature", "sig_test_123")
            .send({ type: "checkout.session.completed" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ received: true });
        expect(h.handleWebhookEvent).toHaveBeenCalled();
    });
});
