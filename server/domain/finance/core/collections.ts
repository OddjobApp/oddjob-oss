/**
 * Finance dataset collection names + hot-folder context routing.
 *
 * These collection ids mirror the `knowledge_datasets` declared in
 * server/cycles/budgetmaster.cycle.yaml. A "table" == a collection.
 */

export const FinanceCollections = {
    budgetContexts: "budget_contexts",
    budgetCategories: "budget_categories",
    accounts: "finance_accounts",
    transactions: "transactions",
    deadMansSwitches: "dead_mans_switches",
    installmentTokens: "installment_tokens",
    subscriptions: "subscriptions",
    purchaseSandboxes: "purchase_sandboxes",
    balanceSnapshots: "balance_snapshots",
    recommendations: "finance_recommendations",
    // Cadence additions (weekly cash-flow, receivables, quarterly/annual tax).
    cashFlowForecasts: "cash_flow_forecasts",
    receivables: "receivables",
    taxEstimates: "tax_estimates",
    taxDocuments: "tax_documents",
    // Prediction-intelligence calibration loop: a pending forecast prediction is
    // written here at forecast time and reconciled against actuals later, with
    // the scored result landing in forecastCalibrations.
    forecastPredictions: "forecast_predictions",
    forecastCalibrations: "forecast_calibrations",
} as const;

/** Default context ids seeded for an org (one per archetype). */
export const DefaultContexts = {
    household: "ctx_household_default",
    scheduleE: "ctx_business_schedule_e",
    capex: "ctx_project_capex",
} as const;

/**
 * Route an ingested file to a budget context by its source sub-folder.
 * personal/ → household envelope, business/ → Schedule-E, projects/ → CapEx.
 * Unknown folders fall back to the household default.
 */
export function routeContextForPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/").toLowerCase();
    if (/(^|\/)business(\/|$)/.test(normalized)) return DefaultContexts.scheduleE;
    if (/(^|\/)projects?(\/|$)/.test(normalized)) return DefaultContexts.capex;
    if (/(^|\/)personal(\/|$)/.test(normalized)) return DefaultContexts.household;
    return DefaultContexts.household;
}
