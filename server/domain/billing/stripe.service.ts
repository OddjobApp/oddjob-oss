import Stripe from "stripe";
import { db } from "@server/database_service.js";
import { orgs } from "@shared/schema/index.js";
import { eq, and, gte, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import {
    SUBSCRIPTION_PLANS,
    getPlanById,
    resolvePlanFromPrice,
    type SubscriptionPlanId,
} from "../../config/plans.js";

const logger = createLogger("StripeService");
const stripeKey = process.env.STRIPE_SECRET_KEY || (process.env.NODE_ENV === "test" || process.env.VITEST === "true" ? "mock_key" : "");
let stripe: Stripe | null = null;

if (stripeKey) {
    stripe = new Stripe(stripeKey, {
        apiVersion: "2024-12-18.acacia" as any,
    });
} else {
    logger.warn("STRIPE_SECRET_KEY is not set — Stripe calls will fail but server will continue to boot.");
}

export const stripeService = {
    /**
     * Create a checkout session for an organization to subscribe to a plan
     */
    async createCheckoutSession(orgId: number, planId: string, successUrl: string, cancelUrl: string) {
        // Validate redirect URLs to prevent open-redirect abuse
        const baseAllowed = process.env.APP_URL || "http://localhost:5000";
        const allowedOrigins = (process.env.NODE_ENV === "test" || process.env.VITEST === "true"
            ? `${baseAllowed},https://audit.test,http://localhost:5000`
            : baseAllowed)
            .split(",")
            .map(u => u.trim());
        for (const url of [successUrl, cancelUrl]) {
            try {
                const parsed = new URL(url);
                if (!allowedOrigins.some(origin => url.startsWith(origin))) {
                    throw new Error(`Redirect URL not in allowed origins: ${parsed.origin}`);
                }
            } catch (e: any) {
                throw new Error(`Invalid redirect URL: ${e.message}`);
            }
        }

        const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
        if (!org) throw new Error("Organization not found");

        let customerId = org.stripeCustomerId;

        // Create customer if doesn't exist
        if (!customerId) {
            if (!stripe) throw new Error("Stripe is not configured");
            const customer = await stripe.customers.create({
                name: org.name,
                metadata: { orgId: orgId.toString() },
            });
            customerId = customer.id;
            await db.update(orgs).set({ stripeCustomerId: customerId }).where(eq(orgs.id, orgId));
        }

        if (!stripe) throw new Error("Stripe is not configured");

        // Resolve plan price ID (allows passing 'starter', 'pro', etc. or explicit Stripe price ID)
        const matchedPlan = SUBSCRIPTION_PLANS[planId.toLowerCase() as SubscriptionPlanId];
        const resolvedPriceId = matchedPlan?.stripePriceId || planId;

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ["card"],
            line_items: [
                {
                    price: resolvedPriceId,
                    quantity: 1,
                },
            ],
            mode: "subscription",
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: {
                orgId: orgId.toString(),
                planName: matchedPlan ? matchedPlan.id : planId,
            },
        });

        return session;
    },

    /**
     * Create a Stripe Customer Portal session for managing payment methods & subscriptions
     */
    async createCustomerPortalSession(orgId: number, returnUrl: string) {
        const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
        if (!org) throw new Error("Organization not found");
        if (!org.stripeCustomerId) {
            throw new Error("No billing customer record found for this organization. Please subscribe to a plan first.");
        }
        if (!stripe) throw new Error("Stripe is not configured");

        const session = await stripe.billingPortal.sessions.create({
            customer: org.stripeCustomerId,
            return_url: returnUrl,
        });

        return session;
    },

    /**
     * Get billing summary for an organization including plan, status, and quota usage
     */
    async getBillingSummary(orgId: number) {
        const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
        if (!org) throw new Error("Organization not found");

        const currentPlan = getPlanById(org.subscriptionPlan);
        const status = org.subscriptionStatus || "free";

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        let missionsCount = 0;
        try {
            const { missions } = await import("@shared/schema/index.js");
            const [mRow] = await db.select({ count: sql<number>`count(*)::int` })
                .from(missions)
                .where(and(eq(missions.organizationId, orgId), gte(missions.createdAt, startOfMonth)));
            missionsCount = mRow?.count ?? 0;
        } catch {
            missionsCount = 0;
        }

        let seatsCount = 1;
        try {
            const { userOrgs } = await import("@shared/schema/index.js");
            const [sRow] = await db.select({ count: sql<number>`count(*)::int` })
                .from(userOrgs)
                .where(eq(userOrgs.orgId, orgId));
            seatsCount = sRow?.count ?? 1;
        } catch {
            seatsCount = 1;
        }

        return {
            organizationId: org.id,
            organizationName: org.name,
            currentPlan,
            subscriptionStatus: status,
            stripeCustomerId: org.stripeCustomerId ?? null,
            stripeSubscriptionId: org.stripeSubscriptionId ?? null,
            hasCustomerAccount: Boolean(org.stripeCustomerId),
            usage: {
                missionsThisMonth: missionsCount,
                missionsLimit: currentPlan.quotas.missionsPerMonth,
                seatsUsed: seatsCount,
                seatsLimit: currentPlan.quotas.seats,
                cuaMinutesUsed: 0,
                cuaMinutesLimit: currentPlan.quotas.cuaMinutesPerMonth,
            },
            availablePlans: Object.values(SUBSCRIPTION_PLANS),
        };
    },

    /**
     * Handle Stripe Webhook Events
     */
    async handleWebhookEvent(payload: string, signature: string) {
        let event: Stripe.Event;

        try {
            if (!stripe) throw new Error("Stripe is not configured");
            event = stripe.webhooks.constructEvent(
                payload,
                signature,
                process.env.STRIPE_WEBHOOK_SECRET || ""
            );
        } catch (err: any) {
            logger.error(`Webhook signature verification failed: ${err.message}`);
            throw new Error(`Webhook Error: ${err.message}`);
        }

        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object as Stripe.Checkout.Session;
                const orgId = parseInt(session.metadata?.orgId || "0");
                const subscriptionId = session.subscription as string;

                if (orgId && subscriptionId) {
                    let planName: string | null = session.metadata?.planName || null;
                    try {
                        if (!stripe) throw new Error("Stripe is not configured");
                        const expanded = await stripe.checkout.sessions.retrieve(session.id, {
                            expand: ["line_items.data.price"],
                        });
                        const price = expanded.line_items?.data[0]?.price as Stripe.Price | undefined;
                        if (!planName && price) {
                            const resolved = resolvePlanFromPrice(price.id);
                            planName = resolved.id;
                        }
                    } catch (e) {
                        logger.warn("Could not resolve plan name from Stripe price", { sessionId: session.id });
                    }

                    await db.update(orgs)
                        .set({
                            stripeSubscriptionId: subscriptionId,
                            subscriptionStatus: "active",
                            ...(planName ? { subscriptionPlan: planName } : {}),
                        })
                        .where(eq(orgs.id, orgId));
                    logger.info(`Subscription activated for org ${orgId}`, { planName });
                }
                break;
            }
            case "customer.subscription.updated": {
                const subscription = event.data.object as Stripe.Subscription;
                const [org] = await db.select().from(orgs).where(eq(orgs.stripeSubscriptionId, subscription.id)).limit(1);

                if (org) {
                    const priceId = subscription.items?.data[0]?.price?.id;
                    const resolvedPlan = priceId ? resolvePlanFromPrice(priceId).id : org.subscriptionPlan;
                    await db.update(orgs)
                        .set({
                            subscriptionStatus: subscription.status,
                            subscriptionPlan: resolvedPlan,
                        })
                        .where(eq(orgs.id, org.id));
                    logger.info(`Subscription updated for org ${org.id}`, { status: subscription.status, plan: resolvedPlan });
                }
                break;
            }
            case "customer.subscription.deleted": {
                const subscription = event.data.object as Stripe.Subscription;
                const [org] = await db.select().from(orgs).where(eq(orgs.stripeSubscriptionId, subscription.id)).limit(1);

                if (org) {
                    await db.update(orgs)
                        .set({
                            subscriptionStatus: "canceled",
                        })
                        .where(eq(orgs.id, org.id));
                    logger.info(`Subscription canceled for org ${org.id}`);
                }
                break;
            }
            case "invoice.payment_succeeded": {
                const invoice = event.data.object as Stripe.Invoice;
                const subId = (invoice as any).subscription as string | undefined;
                if (subId) {
                    const [org] = await db.select().from(orgs).where(eq(orgs.stripeSubscriptionId, subId)).limit(1);
                    if (org) {
                        await db.update(orgs)
                            .set({ subscriptionStatus: "active" })
                            .where(eq(orgs.id, org.id));
                        logger.info(`Invoice payment succeeded for org ${org.id}`);
                    }
                }
                break;
            }
            case "invoice.payment_failed": {
                const invoice = event.data.object as Stripe.Invoice;
                const subId = (invoice as any).subscription as string | undefined;
                if (subId) {
                    const [org] = await db.select().from(orgs).where(eq(orgs.stripeSubscriptionId, subId)).limit(1);
                    if (org) {
                        await db.update(orgs)
                            .set({ subscriptionStatus: "past_due" })
                            .where(eq(orgs.id, org.id));
                        logger.warn(`Invoice payment failed for org ${org.id}; marked as past_due`);
                    }
                }
                break;
            }
        }

        return { received: true };
    }
};
