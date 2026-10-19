import { z } from "zod";
import type { ToolDefinition } from "./types.js";

async function getStripeKey(orgId?: number | null): Promise<string | null> {
    if (!orgId) return process.env.STRIPE_SECRET_KEY || null;
    try {
        const { db } = await import("@server/database_service.js");
        const { credentials } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");
        const [cred] = await db
            .select()
            .from(credentials)
            .where(and(eq(credentials.organizationId, orgId), eq(credentials.type, "stripe")))
            .limit(1);
        if (cred?.metadata) return cred.metadata as string;
    } catch {}
    return process.env.STRIPE_SECRET_KEY || null;
}

async function stripeRequest(key: string, path: string, method = "GET", body?: Record<string, any>) {
    const headers: Record<string, string> = {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
    };
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
        method,
        headers,
        body: body ? new URLSearchParams(body as any).toString() : undefined,
    });
    if (!res.ok) throw new Error(`Stripe API error ${res.status}: ${await res.text()}`);
    return res.json();
}

export const STRIPE_TOOLS: Record<string, ToolDefinition> = {
    stripe_get_customer: {
        name: "stripe_get_customer",

        idempotency: "read-safe",
        label: "Get Stripe Customer",
        group: "Stripe",
        description: "Look up a Stripe customer by email or customer ID.",
        parameters: z.object({
            email: z.string().email().optional().describe("Customer email to search"),
            customer_id: z.string().optional().describe("Stripe customer ID (cus_...)"),
        }),
        execute: async (params, context) => {
            const key = await getStripeKey(context?.organizationId);
            if (!key) return "Stripe is not configured. Add a Stripe credential in Settings.";
            if (params.customer_id) {
                const cust = await stripeRequest(key, `/customers/${params.customer_id}`);
                return JSON.stringify(cust, null, 2);
            }
            if (params.email) {
                const data = await stripeRequest(key, `/customers?email=${encodeURIComponent(params.email)}&limit=5`);
                return JSON.stringify(data.data || [], null, 2);
            }
            return "Provide either email or customer_id.";
        },
    },

    stripe_list_subscriptions: {
        name: "stripe_list_subscriptions",

        idempotency: "read-safe",
        label: "List Stripe Subscriptions",
        group: "Stripe",
        description: "List Stripe subscriptions for a customer or across all customers.",
        parameters: z.object({
            customer_id: z.string().optional().describe("Filter by Stripe customer ID"),
            status: z.enum(["active", "canceled", "past_due", "trialing", "all"]).optional().default("active"),
            limit: z.number().min(1).max(100).default(10).optional(),
        }),
        execute: async (params, context) => {
            const key = await getStripeKey(context?.organizationId);
            if (!key) return "Stripe is not configured. Add a Stripe credential in Settings.";
            let path = `/subscriptions?limit=${params.limit || 10}&status=${params.status || "active"}`;
            if (params.customer_id) path += `&customer=${params.customer_id}`;
            const data = await stripeRequest(key, path);
            const subs = (data.data || []).map((s: any) => ({
                id: s.id,
                customer: s.customer,
                status: s.status,
                plan: s.items?.data?.[0]?.price?.nickname || s.items?.data?.[0]?.price?.id,
                amount: s.items?.data?.[0]?.price?.unit_amount,
                currency: s.currency,
                current_period_end: new Date(s.current_period_end * 1000).toISOString(),
            }));
            return JSON.stringify(subs, null, 2);
        },
    },

    stripe_list_invoices: {
        name: "stripe_list_invoices",

        idempotency: "read-safe",
        label: "List Stripe Invoices",
        group: "Stripe",
        description: "List Stripe invoices for a customer, optionally filtered by status.",
        parameters: z.object({
            customer_id: z.string().optional().describe("Filter by Stripe customer ID"),
            status: z.enum(["draft", "open", "paid", "uncollectible", "void"]).optional(),
            limit: z.number().min(1).max(100).default(10).optional(),
        }),
        execute: async (params, context) => {
            const key = await getStripeKey(context?.organizationId);
            if (!key) return "Stripe is not configured. Add a Stripe credential in Settings.";
            let path = `/invoices?limit=${params.limit || 10}`;
            if (params.customer_id) path += `&customer=${params.customer_id}`;
            if (params.status) path += `&status=${params.status}`;
            const data = await stripeRequest(key, path);
            const invoices = (data.data || []).map((i: any) => ({
                id: i.id,
                number: i.number,
                customer: i.customer,
                status: i.status,
                amount_due: i.amount_due,
                amount_paid: i.amount_paid,
                currency: i.currency,
                due_date: i.due_date ? new Date(i.due_date * 1000).toISOString() : null,
                hosted_invoice_url: i.hosted_invoice_url,
            }));
            return JSON.stringify(invoices, null, 2);
        },
    },

    stripe_get_payment_intent: {
        name: "stripe_get_payment_intent",

        idempotency: "read-safe",
        label: "Get Stripe Payment Intent",
        group: "Stripe",
        description: "Retrieve a Stripe payment intent by ID to check payment status.",
        parameters: z.object({
            payment_intent_id: z.string().describe("Stripe PaymentIntent ID (pi_...)"),
        }),
        execute: async (params, context) => {
            const key = await getStripeKey(context?.organizationId);
            if (!key) return "Stripe is not configured. Add a Stripe credential in Settings.";
            const pi = await stripeRequest(key, `/payment_intents/${params.payment_intent_id}`);
            return JSON.stringify({
                id: pi.id,
                status: pi.status,
                amount: pi.amount,
                currency: pi.currency,
                customer: pi.customer,
                description: pi.description,
                created: new Date(pi.created * 1000).toISOString(),
            }, null, 2);
        },
    },

    stripe_create_refund: {
        name: "stripe_create_refund",

        idempotency: "none",
        label: "Create Stripe Refund",
        group: "Stripe",
        description: "Issue a full or partial refund for a Stripe payment. Always confirm with user before executing.",
        parameters: z.object({
            payment_intent_id: z.string().describe("Payment intent ID to refund (pi_...)"),
            amount: z.number().optional().describe("Amount to refund in cents (omit for full refund)"),
            reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).optional(),
        }),
        execute: async (params, context) => {
            const key = await getStripeKey(context?.organizationId);
            if (!key) return "Stripe is not configured. Add a Stripe credential in Settings.";
            const body: Record<string, any> = { payment_intent: params.payment_intent_id };
            if (params.amount) body.amount = params.amount;
            if (params.reason) body.reason = params.reason;
            const refund = await stripeRequest(key, "/refunds", "POST", body);
            return JSON.stringify({ id: refund.id, status: refund.status, amount: refund.amount, currency: refund.currency });
        },
    },
};
