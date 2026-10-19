import { describe, it, expect, beforeEach, vi } from "vitest";
import { stripeService } from "../../../server/domain/billing/stripe.service";
import { db } from "@server/database_service.js";
import { orgs } from "@shared/schema/index";

const { mockStripe } = vi.hoisted(() => {
    return {
        mockStripe: {
            customers: {
                create: vi.fn(),
            },
            checkout: {
                sessions: {
                    create: vi.fn(),
                    retrieve: vi.fn(),
                },
            },
            billingPortal: {
                sessions: {
                    create: vi.fn(),
                },
            },
            webhooks: {
                constructEvent: vi.fn(),
            },
        }
    };
});

vi.mock("stripe", () => {
    const StripeMock = vi.fn().mockImplementation(function () {
        return mockStripe;
    });
    return {
        default: StripeMock,
        Stripe: StripeMock,
    };
});

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(),
        update: vi.fn(),
    },
}));

describe("StripeService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should create a checkout session", async () => {
        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ id: 1, name: "Test Org", stripeCustomerId: null }])
                })
            })
        });

        (db.update as any).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue({})
                })
            })
        });

        mockStripe.customers.create.mockResolvedValue({ id: "cus_123" });
        mockStripe.checkout.sessions.create.mockResolvedValue({ id: "ses_123", url: "https://stripe.com/test" });

        // createCheckoutSession validates both redirect URLs against an
        // allowlist to prevent open-redirect abuse. "http://success" is not an
        // allowed origin, so the fixture was rejected before Stripe was ever
        // called — the guard is newer than the test.
        const session = await stripeService.createCheckoutSession(
            1,
            "price_123",
            "http://localhost:5000/billing/success",
            "http://localhost:5000/billing/cancel",
        );

        expect(mockStripe.customers.create).toHaveBeenCalled();
        expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
            customer: "cus_123",
            mode: "subscription",
        }));
        expect(session.url).toBe("https://stripe.com/test");
    });

    it("refuses a redirect to an origin outside the allowlist", async () => {
        await expect(
            stripeService.createCheckoutSession(
                1,
                "price_123",
                "https://evil.example/success",
                "http://localhost:5000/billing/cancel",
            ),
        ).rejects.toThrow(/not in allowed origins/);

        expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it("should handle checkout.session.completed webhook", async () => {
        const payload = JSON.stringify({ type: "checkout.session.completed" });
        const signature = "sig_123";

        mockStripe.webhooks.constructEvent.mockReturnValue({
            type: "checkout.session.completed",
            data: {
                object: {
                    metadata: { orgId: "1" },
                    subscription: "sub_123"
                }
            }
        });

        (db.update as any).mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue({})
            })
        });

        const result = await stripeService.handleWebhookEvent(payload, signature);

        expect(result.received).toBe(true);
        expect(db.update).toHaveBeenCalledWith(orgs);
    });

    it("should create a customer portal session when org has stripeCustomerId", async () => {
        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ id: 1, name: "Test Org", stripeCustomerId: "cus_123" }])
                })
            })
        });

        mockStripe.billingPortal.sessions.create.mockResolvedValue({
            id: "bps_123",
            url: "https://billing.stripe.com/portal/test",
        });

        const session = await stripeService.createCustomerPortalSession(1, "http://localhost:5000/settings");

        expect(mockStripe.billingPortal.sessions.create).toHaveBeenCalledWith({
            customer: "cus_123",
            return_url: "http://localhost:5000/settings",
        });
        expect(session.url).toBe("https://billing.stripe.com/portal/test");
    });

    it("should throw error creating portal session when org has no stripeCustomerId", async () => {
        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ id: 1, name: "Test Org", stripeCustomerId: null }])
                })
            })
        });

        await expect(
            stripeService.createCustomerPortalSession(1, "http://localhost:5000/settings")
        ).rejects.toThrow(/No billing customer record found/);
    });

    it("should return billing summary with quotas and usage", async () => {
        const mockOrg = {
            id: 1,
            name: "Test Org",
            stripeCustomerId: "cus_123",
            stripeSubscriptionId: "sub_123",
            subscriptionPlan: "pro",
            subscriptionStatus: "active",
        };

        const makeQueryResult = (data: any) => ({
            limit: vi.fn().mockResolvedValue(data),
            then: (fn: any) => Promise.resolve(data).then(fn),
            catch: (fn: any) => Promise.resolve(data).catch(fn),
        });

        let callCount = 0;
        (db.select as any).mockImplementation(() => ({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockImplementation(() => {
                    callCount++;
                    if (callCount === 1) return makeQueryResult([mockOrg]);
                    if (callCount === 2) return makeQueryResult([{ count: 42 }]);
                    return makeQueryResult([{ count: 5 }]);
                })
            })
        }));

        const summary = await stripeService.getBillingSummary(1);

        expect(summary.organizationId).toBe(1);
        expect(summary.currentPlan.id).toBe("pro");
        expect(summary.subscriptionStatus).toBe("active");
        expect(summary.hasCustomerAccount).toBe(true);
        expect(summary.usage.missionsLimit).toBe(1500);
        expect(summary.availablePlans.length).toBeGreaterThanOrEqual(4);
    });

    it("should handle customer.subscription.updated webhook", async () => {
        const payload = JSON.stringify({ type: "customer.subscription.updated" });
        const signature = "sig_123";

        mockStripe.webhooks.constructEvent.mockReturnValue({
            type: "customer.subscription.updated",
            data: {
                object: {
                    id: "sub_123",
                    status: "active",
                    items: {
                        data: [{ price: { id: "price_starter" } }]
                    }
                }
            }
        });

        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ id: 1, stripeSubscriptionId: "sub_123", subscriptionPlan: "free" }])
                })
            })
        });

        const updateSetMock = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue({})
        });
        (db.update as any).mockReturnValue({ set: updateSetMock });

        const result = await stripeService.handleWebhookEvent(payload, signature);

        expect(result.received).toBe(true);
        expect(db.update).toHaveBeenCalledWith(orgs);
        expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
            subscriptionStatus: "active",
        }));
    });

    it("should handle customer.subscription.deleted webhook", async () => {
        const payload = JSON.stringify({ type: "customer.subscription.deleted" });
        const signature = "sig_123";

        mockStripe.webhooks.constructEvent.mockReturnValue({
            type: "customer.subscription.deleted",
            data: {
                object: {
                    id: "sub_123",
                }
            }
        });

        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ id: 1, stripeSubscriptionId: "sub_123" }])
                })
            })
        });

        const updateSetMock = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue({})
        });
        (db.update as any).mockReturnValue({ set: updateSetMock });

        const result = await stripeService.handleWebhookEvent(payload, signature);

        expect(result.received).toBe(true);
        expect(updateSetMock).toHaveBeenCalledWith({ subscriptionStatus: "canceled" });
    });

    it("should handle invoice.payment_failed webhook", async () => {
        const payload = JSON.stringify({ type: "invoice.payment_failed" });
        const signature = "sig_123";

        mockStripe.webhooks.constructEvent.mockReturnValue({
            type: "invoice.payment_failed",
            data: {
                object: {
                    subscription: "sub_123",
                }
            }
        });

        (db.select as any).mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ id: 1, stripeSubscriptionId: "sub_123" }])
                })
            })
        });

        const updateSetMock = vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue({})
        });
        (db.update as any).mockReturnValue({ set: updateSetMock });

        const result = await stripeService.handleWebhookEvent(payload, signature);

        expect(result.received).toBe(true);
        expect(updateSetMock).toHaveBeenCalledWith({ subscriptionStatus: "past_due" });
    });
});
