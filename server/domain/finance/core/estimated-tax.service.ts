/**
 * Quarterly Estimated Tax engine (cadence addition).
 *
 * Projects the self-employment + income tax owed on year-to-date net profit
 * from the Schedule-E / business budget contexts, surfaces the prior-year
 * safe-harbor floor (penalty avoidance), and persists a PROJECTED tax_estimate
 * plus an estimated_tax_due recommendation routed to the HIL authorization form.
 *
 * Advisory only — BudgetMaster computes and reminds; it never remits to the IRS.
 */

import { RecordStore } from "./record-store.js";
import { FinanceCollections, DefaultContexts } from "./collections.js";
import { createRecommendation } from "./recommendations.js";
import type { LedgerTransaction } from "./transaction.service.js";

// SE tax: 92.35% of net profit is subject to the 15.3% SS+Medicare rate.
const SE_TAXABLE_FRACTION = 0.9235;
const SE_RATE = 0.153;

export interface EstimatedTaxOptions {
    taxYear?: string; // "2026"; defaults to the current year
    periodLabel?: string; // Q1 | Q2 | Q3 | Q4
    dueDate?: string; // ISO date of the IRS due date for this period
    incomeTaxRate?: number; // effective marginal rate on net profit (default 0.22)
    priorYearTotalTax?: number; // for the safe-harbor floor
    safeHarborMultiplier?: number; // 1.0, or 1.1 for AGI > $150k (default 1.1)
    persist?: boolean;
    now?: Date;
}

export interface TaxEstimate {
    estimate_id: string;
    tax_year: string;
    period_label: string;
    due_date?: string;
    estimated_income: number; // net profit YTD
    estimated_se_tax: number;
    estimated_income_tax: number;
    safe_harbor_amount: number; // per-period safe-harbor floor
    total_due: number; // this period's recommended payment
    status: "PROJECTED" | "APPROVED" | "PAID" | "SKIPPED";
    paid_at?: string;
    recId?: string;
}

const DEFAULTS = { incomeTaxRate: 0.22, safeHarborMultiplier: 1.1 };

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

export async function projectEstimatedTax(
    store: RecordStore,
    opts: EstimatedTaxOptions = {},
): Promise<TaxEstimate> {
    const now = opts.now ?? new Date();
    const taxYear = opts.taxYear ?? String(now.getUTCFullYear());
    const periodLabel = opts.periodLabel ?? "Q?";
    const incomeTaxRate = opts.incomeTaxRate ?? DEFAULTS.incomeTaxRate;
    const safeHarborMultiplier = opts.safeHarborMultiplier ?? DEFAULTS.safeHarborMultiplier;

    // Which contexts are business / Schedule-E?
    const contexts = await store.list<{ context_id: string; archetype_mode?: string }>(
        FinanceCollections.budgetContexts,
    );
    const businessCtxIds = new Set(
        contexts
            .filter((c) => c.data.archetype_mode === "TAX_SCHEDULE_E" || c.recordId === DefaultContexts.scheduleE)
            .map((c) => c.data.context_id),
    );
    // Fall back to the default Schedule-E context id even if no context row exists yet.
    businessCtxIds.add(DefaultContexts.scheduleE);

    // YTD net profit from business-context transactions in the tax year.
    const txs = await store.list<LedgerTransaction>(FinanceCollections.transactions);
    let income = 0;
    let expense = 0;
    for (const { data } of txs) {
        if (data.is_split) continue;
        if (!businessCtxIds.has(data.context_id)) continue;
        if (!(data.timestamp || "").startsWith(taxYear)) continue;
        const amt = data.amount || 0;
        if (amt >= 0) income += amt;
        else expense += Math.abs(amt);
    }
    const netProfit = Math.max(0, income - expense);

    const seTax = netProfit * SE_TAXABLE_FRACTION * SE_RATE;
    const incomeTax = netProfit * incomeTaxRate;
    const annualTotal = seTax + incomeTax;
    // Estimated payments spread evenly across the four IRS periods.
    const periodDue = annualTotal / 4;
    const safeHarbor =
        opts.priorYearTotalTax != null ? (opts.priorYearTotalTax * safeHarborMultiplier) / 4 : 0;
    const totalDue = Math.max(periodDue, safeHarbor);

    const estimate: TaxEstimate = {
        estimate_id: `${taxYear}-${periodLabel}`,
        tax_year: taxYear,
        period_label: periodLabel,
        due_date: opts.dueDate,
        estimated_income: round(netProfit),
        estimated_se_tax: round(seTax),
        estimated_income_tax: round(incomeTax),
        safe_harbor_amount: round(safeHarbor),
        total_due: round(totalDue),
        status: "PROJECTED",
    };

    if (opts.persist) {
        const rec = await createRecommendation(store, {
            kind: "estimated_tax_due",
            title: `Estimated tax due ${periodLabel} ${taxYear}: ${estimate.total_due.toFixed(2)}`,
            body: `On ${netProfit.toFixed(2)} YTD net profit: SE tax ~${estimate.estimated_se_tax.toFixed(2)} + income tax ~${estimate.estimated_income_tax.toFixed(2)}. Recommended payment ${estimate.total_due.toFixed(2)}${opts.dueDate ? ` by ${opts.dueDate}` : ""}. Authorize?`,
            payload: {
                estimate_id: estimate.estimate_id,
                total_due: estimate.total_due,
                safe_harbor_amount: estimate.safe_harbor_amount,
                due_date: opts.dueDate,
                form_ref: "Quarterly Estimated Tax Authorization",
            },
            now,
        });
        estimate.recId = rec.rec_id;
        await store.upsert(FinanceCollections.taxEstimates, estimate.estimate_id, estimate);
    }

    return estimate;
}
