/**
 * Subscription Decay engine (PRD §4.4).
 *
 * Scores each recurring charge by utility (cost per logged usage hour). A
 * subscription with zero recent usage, or a cost-per-use above threshold, is
 * flagged for quarantine and a cancellation recommendation is raised.
 */

import { RecordStore } from "./record-store.js";
import { FinanceCollections } from "./collections.js";
import { createRecommendation } from "./recommendations.js";

export interface Subscription {
    subscription_id: string;
    payee_token: string;
    monthly_cost: number;
    cadence: string;
    usage_hours_logged: number;
    quarantine_flag: boolean;
    last_seen_at?: string;
}

export interface SubscriptionDecayOptions {
    staleDays: number; // no usage in this many days => decayed
    maxCostPerHour: number; // cost-per-use ceiling
    now?: Date;
}

export interface SubscriptionDecayResult {
    quarantined: Array<{ subscription_id: string; reason: string; recId: string }>;
}

const DEFAULTS: Required<Omit<SubscriptionDecayOptions, "now">> = {
    staleDays: 60,
    maxCostPerHour: 25,
};

export async function scanSubscriptions(
    store: RecordStore,
    opts: Partial<SubscriptionDecayOptions> = {},
): Promise<SubscriptionDecayResult> {
    const cfg = { ...DEFAULTS, ...opts };
    const now = opts.now ?? new Date();
    const subs = await store.list<Subscription>(FinanceCollections.subscriptions);
    const quarantined: SubscriptionDecayResult["quarantined"] = [];

    for (const { recordId, data } of subs) {
        if (data.quarantine_flag) continue;

        const usage = data.usage_hours_logged || 0;
        const lastSeen = data.last_seen_at ? new Date(data.last_seen_at) : null;
        const ageDays = lastSeen ? (now.getTime() - lastSeen.getTime()) / 86_400_000 : Infinity;
        const costPerHour = usage > 0 ? data.monthly_cost / usage : Infinity;

        let reason: string | null = null;
        if (usage === 0 && ageDays >= cfg.staleDays) {
            reason = `No usage logged in ${Math.round(ageDays)} days`;
        } else if (costPerHour > cfg.maxCostPerHour) {
            reason = `Cost-per-use ${costPerHour === Infinity ? "∞" : costPerHour.toFixed(2)} exceeds ${cfg.maxCostPerHour} ceiling`;
        }
        if (!reason) continue;

        await store.upsert(FinanceCollections.subscriptions, recordId, { ...data, quarantine_flag: true });
        const rec = await createRecommendation(store, {
            kind: "quarantine",
            title: `Subscription decayed: ${data.payee_token}`,
            body: `${data.payee_token} (${data.monthly_cost}/mo) flagged for cancellation. ${reason}.`,
            payload: {
                subscription_id: data.subscription_id,
                monthly_cost: data.monthly_cost,
                reason,
                form_ref: "Subscription Cancellation Approval",
            },
            now,
        });
        quarantined.push({ subscription_id: data.subscription_id, reason, recId: rec.rec_id });
    }

    return { quarantined };
}
