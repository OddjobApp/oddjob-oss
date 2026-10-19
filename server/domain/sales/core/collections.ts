/**
 * Sales dataset collection names.
 *
 * These collection ids mirror the `knowledge_datasets` declared in
 * server/cycles/sales-opportunity-pipeline.cycle.yaml. A "table" == a collection
 * in `app_records`.
 */

export const SalesCollections = {
    leads: "leads",
    accounts: "accounts",
    opportunities: "opportunities",
    activities: "activities",
    stageHistory: "stage_history",
    // The narrowing-window engine.
    opportunityWindows: "opportunity_windows",
    windowSnapshots: "window_snapshots",
    forecasts: "forecasts",
    quotas: "quotas",
    recommendations: "sales_recommendations",
} as const;

/** Default decaying-ceiling ladder: 90% → 60% → 30% → 0% (terminal). */
export const DEFAULT_GATE_LADDER: number[] = [90, 60, 30, 0];

/** Activity types that, by default, hold or re-baseline a window. */
export const DEFAULT_REARM_SIGNALS: string[] = [
    "REPLY",
    "MEETING",
    "DEMO",
    "PROPOSAL_OPENED",
    "STAGE_ADVANCED",
];

/** Default ceiling a stage re-baselines its opportunity window up to. */
export const SALES_STAGE_ENTITLEMENT = {
    PROSPECT: 90,
    QUALIFIED: 90,
    PROPOSAL: 60,
    NEGOTIATION: 60,
    CLOSED_WON: 100,
    CLOSED_LOST: 0,
} as const;
