/**
 * Canonical Subscription Plans & Quotas for Oddjob Commercial SaaS
 */

export type SubscriptionPlanId = "free" | "starter" | "pro" | "enterprise";

export interface SubscriptionPlanQuotas {
    missionsPerMonth: number;
    seats: number;
    cuaMinutesPerMonth: number;
    knowledgeDocsLimit: number;
    maxConcurrentCycles: number;
    dedicatedKafka: boolean;
    customModelKeys: boolean;
    reflexionSelfHealing: boolean;
}

export interface SubscriptionPlan {
    id: SubscriptionPlanId;
    name: string;
    tagline: string;
    priceMonthlyUsd: number;
    stripePriceId?: string;
    features: string[];
    quotas: SubscriptionPlanQuotas;
    popular?: boolean;
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanId, SubscriptionPlan> = {
    free: {
        id: "free",
        name: "Hobby / Trial",
        tagline: "Explore autonomous agent teams and visual workflows.",
        priceMonthlyUsd: 0,
        features: [
            "25 autonomous missions / month",
            "1 team operator seat",
            "15 Computer-Use Agent (CUA) minutes",
            "50 Knowledge Graph documents",
            "Single active cycle execution",
            "Community Discord support",
        ],
        quotas: {
            missionsPerMonth: 25,
            seats: 1,
            cuaMinutesPerMonth: 15,
            knowledgeDocsLimit: 50,
            maxConcurrentCycles: 1,
            dedicatedKafka: false,
            customModelKeys: false,
            reflexionSelfHealing: false,
        },
    },
    starter: {
        id: "starter",
        name: "Starter Operator",
        tagline: "For early teams automating continuous operational pipelines.",
        priceMonthlyUsd: 49,
        stripePriceId: process.env.STRIPE_PRICE_STARTER || "price_starter_monthly",
        features: [
            "200 autonomous missions / month",
            "3 operator seats",
            "120 Computer-Use Agent (CUA) minutes",
            "500 Knowledge Graph documents",
            "3 concurrent operational cycles",
            "BYOK (Bring Your Own Key) LLM routing",
            "Standard email support",
        ],
        quotas: {
            missionsPerMonth: 200,
            seats: 3,
            cuaMinutesPerMonth: 120,
            knowledgeDocsLimit: 500,
            maxConcurrentCycles: 3,
            dedicatedKafka: false,
            customModelKeys: true,
            reflexionSelfHealing: true,
        },
    },
    pro: {
        id: "pro",
        name: "Pro Fleet",
        tagline: "Full-scale autonomous crews with Noah Shinn Reflexion self-healing.",
        priceMonthlyUsd: 199,
        stripePriceId: process.env.STRIPE_PRICE_PRO || "price_pro_monthly",
        popular: true,
        features: [
            "1,500 autonomous missions / month",
            "10 operator seats",
            "600 Computer-Use Agent (CUA) minutes",
            "5,000 Knowledge Graph documents",
            "10 concurrent operational cycles",
            "Noah Shinn Reflexion Self-Healing Engine",
            "Media Studio & Generative Video",
            "Omnichannel Gateway (SMS, WhatsApp, Telegram)",
            "Priority queue & expedited support",
        ],
        quotas: {
            missionsPerMonth: 1500,
            seats: 10,
            cuaMinutesPerMonth: 600,
            knowledgeDocsLimit: 5000,
            maxConcurrentCycles: 10,
            dedicatedKafka: false,
            customModelKeys: true,
            reflexionSelfHealing: true,
        },
    },
    enterprise: {
        id: "enterprise",
        name: "Enterprise Sovereign",
        tagline: "Mission-critical reliability, dedicated telemetry, and custom compliance.",
        priceMonthlyUsd: 999,
        stripePriceId: process.env.STRIPE_PRICE_ENTERPRISE || "price_enterprise_monthly",
        features: [
            "Unlimited autonomous missions",
            "100+ seats with Enterprise RBAC",
            "5,000+ CUA browser minutes / dedicated cluster",
            "100,000+ Knowledge Graph documents",
            "50 concurrent cycles",
            "Dedicated Kafka spatial telemetry partition",
            "Procurement audit attestation & custom SLAs",
            "24/7 dedicated engineering support",
        ],
        quotas: {
            missionsPerMonth: Infinity,
            seats: 100,
            cuaMinutesPerMonth: 5000,
            knowledgeDocsLimit: 100000,
            maxConcurrentCycles: 50,
            dedicatedKafka: true,
            customModelKeys: true,
            reflexionSelfHealing: true,
        },
    },
};

export function getPlanById(planId?: string | null): SubscriptionPlan {
    if (!planId) return SUBSCRIPTION_PLANS.free;
    const normalized = planId.toLowerCase() as SubscriptionPlanId;
    return SUBSCRIPTION_PLANS[normalized] || SUBSCRIPTION_PLANS.free;
}

export function resolvePlanFromPrice(priceIdOrAlias: string): SubscriptionPlan {
    const directMatch = SUBSCRIPTION_PLANS[priceIdOrAlias.toLowerCase() as SubscriptionPlanId];
    if (directMatch) return directMatch;

    for (const plan of Object.values(SUBSCRIPTION_PLANS)) {
        if (plan.stripePriceId && plan.stripePriceId === priceIdOrAlias) {
            return plan;
        }
    }
    return SUBSCRIPTION_PLANS.free;
}
