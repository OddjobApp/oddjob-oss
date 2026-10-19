/**
 * Quarterly Sales-Tax Prep engine (cadence addition).
 *
 * Aggregates taxable sales (business-context inflows) for a quarter and applies
 * the configured rate to produce a filing-ready collected-tax total, grouped by
 * category as a jurisdiction proxy. Raises a sales_tax_due recommendation.
 *
 * NOTE: real multi-jurisdiction filing needs per-line jurisdiction + rate on the
 * transaction; until that is modelled this uses a single configured rate.
 */

import { RecordStore } from "./record-store.js";
import { FinanceCollections, DefaultContexts } from "./collections.js";
import { createRecommendation } from "./recommendations.js";
import type { LedgerTransaction } from "./transaction.service.js";

/** Calendar quarter (1-4) a YYYY-MM-... timestamp falls in. */
function quarterOf(ts: string): number {
    const m = new Date(ts).getUTCMonth(); // 0-11
    return Math.floor(m / 3) + 1;
}

export interface SalesTaxOptions {
    taxYear?: string;
    quarter?: number; // 1-4; defaults to the prior completed quarter
    rate?: number; // e.g. 0.0825 for 8.25%
    persist?: boolean;
    now?: Date;
}

export interface SalesTaxSummary {
    tax_year: string;
    quarter: number;
    rate: number;
    taxable_sales: number;
    tax_collected: number;
    by_category: Record<string, number>;
    recId?: string;
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

export async function compileSalesTax(
    store: RecordStore,
    opts: SalesTaxOptions = {},
): Promise<SalesTaxSummary> {
    const now = opts.now ?? new Date();
    const taxYear = opts.taxYear ?? String(now.getUTCFullYear());
    const quarter = opts.quarter ?? Math.max(1, Math.floor(now.getUTCMonth() / 3)); // prior quarter
    const rate = opts.rate ?? 0;

    const contexts = await store.list<{ context_id: string; archetype_mode?: string }>(
        FinanceCollections.budgetContexts,
    );
    const businessCtxIds = new Set(
        contexts
            .filter((c) => c.data.archetype_mode === "TAX_SCHEDULE_E" || c.recordId === DefaultContexts.scheduleE)
            .map((c) => c.data.context_id),
    );
    businessCtxIds.add(DefaultContexts.scheduleE);

    const txs = await store.list<LedgerTransaction>(FinanceCollections.transactions);
    let taxableSales = 0;
    const byCategory: Record<string, number> = {};
    for (const { data } of txs) {
        if (data.is_split) continue;
        if (!businessCtxIds.has(data.context_id)) continue;
        const ts = data.timestamp || "";
        if (!ts.startsWith(taxYear) || quarterOf(ts) !== quarter) continue;
        const amt = data.amount || 0;
        if (amt <= 0) continue; // sales are inflows
        taxableSales += amt;
        const cat = data.category_id || "uncategorized";
        byCategory[cat] = (byCategory[cat] || 0) + amt;
    }

    const taxCollected = taxableSales * rate;
    for (const k of Object.keys(byCategory)) byCategory[k] = round(byCategory[k]);

    const summary: SalesTaxSummary = {
        tax_year: taxYear,
        quarter,
        rate,
        taxable_sales: round(taxableSales),
        tax_collected: round(taxCollected),
        by_category: byCategory,
    };

    if (opts.persist && taxableSales > 0) {
        const rec = await createRecommendation(store, {
            kind: "sales_tax_due",
            title: `Sales tax Q${quarter} ${taxYear}: ${summary.tax_collected.toFixed(2)} on ${summary.taxable_sales.toFixed(2)} sales`,
            body: `Q${quarter} taxable sales were ${summary.taxable_sales.toFixed(2)}; at ${(rate * 100).toFixed(2)}% the collected sales tax to remit is ~${summary.tax_collected.toFixed(2)}. Verify jurisdiction rates before filing.`,
            payload: { tax_year: taxYear, quarter, taxable_sales: summary.taxable_sales, tax_collected: summary.tax_collected },
            now,
        });
        summary.recId = rec.rec_id;
    }

    return summary;
}
