/**
 * Helper for writing sales_recommendations — the bridge between the autonomous
 * window/risk engines and the human-in-the-loop approval surfaces (the Deal
 * Risk Center and the Deal Window Decision gate). Mirrors the finance
 * createRecommendation helper.
 */

import crypto from "crypto";
import { RecordStore } from "./record-store.js";
import { SalesCollections } from "./collections.js";

export type SalesRecommendationKind =
    | "slip_risk"
    | "stalled"
    | "aging"
    | "next_best_action"
    | "win"
    | "loss";

export interface SalesRecommendation {
    rec_id: string;
    opportunity_id: string;
    kind: SalesRecommendationKind;
    title: string;
    body: string;
    payload: Record<string, any>;
    status: "OPEN" | "ACTED" | "SNOOZED" | "DISMISSED";
    created_at: string;
}

export async function createSalesRecommendation(
    store: RecordStore,
    params: {
        opportunity_id: string;
        kind: SalesRecommendationKind;
        title: string;
        body: string;
        payload?: Record<string, any>;
        now?: Date;
    },
): Promise<SalesRecommendation> {
    const now = params.now ?? new Date();
    const rec: SalesRecommendation = {
        rec_id: `rec_${now.getTime()}_${crypto.randomBytes(4).toString("hex")}`,
        opportunity_id: params.opportunity_id,
        kind: params.kind,
        title: params.title,
        body: params.body,
        payload: params.payload ?? {},
        status: "OPEN",
        created_at: now.toISOString(),
    };
    await store.upsert(SalesCollections.recommendations, rec.rec_id, rec);
    return rec;
}
