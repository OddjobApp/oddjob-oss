/**
 * Helper for writing finance_recommendations — the bridge between the
 * autonomous engines and the human-in-the-loop approval surfaces.
 */

import crypto from "crypto";
import { RecordStore } from "./record-store.js";
import { FinanceCollections } from "./collections.js";

export type RecommendationKind =
    | "sweep"
    | "quarantine"
    | "dms_fault"
    | "capex_overrun"
    | "cashflow_shortfall"
    | "receivable_overdue"
    | "estimated_tax_due"
    | "sales_tax_due"
    | "info_return_due"
    | "forecast_miscalibrated";

export interface Recommendation {
    rec_id: string;
    kind: RecommendationKind;
    title: string;
    body: string;
    payload: Record<string, any>;
    status: "open" | "approved" | "dismissed";
    created_at: string;
}

export async function createRecommendation(
    store: RecordStore,
    params: { kind: RecommendationKind; title: string; body: string; payload?: Record<string, any>; now?: Date },
): Promise<Recommendation> {
    const now = params.now ?? new Date();
    const rec: Recommendation = {
        rec_id: `rec_${now.getTime()}_${crypto.randomBytes(4).toString("hex")}`,
        kind: params.kind,
        title: params.title,
        body: params.body,
        payload: params.payload ?? {},
        status: "open",
        created_at: now.toISOString(),
    };
    await store.upsert(FinanceCollections.recommendations, rec.rec_id, rec);
    return rec;
}
