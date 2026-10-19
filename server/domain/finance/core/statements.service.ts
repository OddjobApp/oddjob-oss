/**
 * Monthly Financial Statements engine (cadence addition).
 *
 * Renders the three core statements for a closed month from the ledger:
 *   - P&L: income, expense (by category), net profit
 *   - Cash-flow (direct method): operating inflow/outflow, net change
 *   - Budget-vs-actual: per-category actual spend vs allocation cap
 *
 * Pure read/compute — produces the data the report template renders; it does
 * not mutate the ledger.
 */

import { RecordStore } from "./record-store.js";
import { FinanceCollections } from "./collections.js";
import type { LedgerTransaction } from "./transaction.service.js";

interface BudgetCategory {
    category_id: string;
    context_id?: string;
    name?: string;
    allocation_cap?: number;
}

export interface BudgetVarianceRow {
    category_id: string;
    name?: string;
    cap: number;
    actual: number;
    variance: number; // cap - actual (negative = over budget)
    over_budget: boolean;
}

export interface FinancialStatements {
    period: string; // YYYY-MM
    profit_and_loss: {
        income: number;
        expense: number;
        net_profit: number;
        expense_by_category: Record<string, number>;
    };
    cash_flow: {
        operating_inflow: number;
        operating_outflow: number;
        net_change: number;
    };
    budget_vs_actual: BudgetVarianceRow[];
    transaction_count: number;
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

function currentPeriod(now: Date): string {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function generateStatements(
    store: RecordStore,
    opts: { period?: string; now?: Date } = {},
): Promise<FinancialStatements> {
    const now = opts.now ?? new Date();
    const period = opts.period ?? currentPeriod(now);

    const txs = await store.list<LedgerTransaction>(FinanceCollections.transactions);
    const monthTxs = txs.filter((t) => (t.data.timestamp || "").startsWith(period) && !t.data.is_split);

    let income = 0;
    let expense = 0;
    const expenseByCategory: Record<string, number> = {};
    const actualByCategory: Record<string, number> = {};

    for (const { data } of monthTxs) {
        const amt = data.amount || 0;
        if (amt >= 0) {
            income += amt;
        } else {
            const abs = Math.abs(amt);
            expense += abs;
            const cat = data.category_id || "uncategorized";
            expenseByCategory[cat] = (expenseByCategory[cat] || 0) + abs;
            actualByCategory[cat] = (actualByCategory[cat] || 0) + abs;
        }
    }

    // Budget-vs-actual against allocation caps.
    const cats = await store.list<BudgetCategory>(FinanceCollections.budgetCategories);
    const budgetVsActual: BudgetVarianceRow[] = cats
        .filter((c) => (c.data.allocation_cap || 0) > 0)
        .map((c) => {
            const cap = c.data.allocation_cap || 0;
            const actual = actualByCategory[c.data.category_id] || 0;
            return {
                category_id: c.data.category_id,
                name: c.data.name,
                cap: round(cap),
                actual: round(actual),
                variance: round(cap - actual),
                over_budget: actual > cap,
            };
        });

    for (const k of Object.keys(expenseByCategory)) expenseByCategory[k] = round(expenseByCategory[k]);

    return {
        period,
        profit_and_loss: {
            income: round(income),
            expense: round(expense),
            net_profit: round(income - expense),
            expense_by_category: expenseByCategory,
        },
        cash_flow: {
            operating_inflow: round(income),
            operating_outflow: round(expense),
            net_change: round(income - expense),
        },
        budget_vs_actual: budgetVsActual,
        transaction_count: monthTxs.length,
    };
}
