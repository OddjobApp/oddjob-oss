/**
 * Monthly Historical Balance Sheet Lock (PRD §6) + CapEx burn (PRD §4.2 weekly).
 *
 * lockBalanceSheet snapshots net worth immutably for a period (snapshot is
 * keyed by period and written failIfExists so a month can never be silently
 * rewritten). computeCapexBurn flags CapEx-project contexts whose spend has
 * exceeded their allocation cap.
 */

import { RecordStore, DuplicateRecordError } from "./record-store.js";
import { FinanceCollections, DefaultContexts } from "./collections.js";
import { createRecommendation } from "./recommendations.js";
import type { FinanceAccount } from "./cash-drag.service.js";

const LIABILITY_TYPES = new Set(["CREDIT_CARD", "LOAN_LIABILITY"]);

export interface BalanceSnapshot {
    snapshot_id: string;
    period: string; // YYYY-MM
    net_worth: number;
    total_assets: number;
    total_liabilities: number;
    breakdown: Record<string, number>;
}

export interface LockResult {
    snapshot: BalanceSnapshot;
    alreadyLocked: boolean;
}

function periodOf(now: Date): string {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function lockBalanceSheet(
    store: RecordStore,
    opts: { now?: Date; period?: string } = {},
): Promise<LockResult> {
    const now = opts.now ?? new Date();
    const period = opts.period ?? periodOf(now);
    const accounts = await store.list<FinanceAccount>(FinanceCollections.accounts);

    let totalAssets = 0;
    let totalLiabilities = 0;
    const breakdown: Record<string, number> = {};
    for (const { data } of accounts) {
        const bal = data.current_balance || 0;
        breakdown[data.account_id] = bal;
        if (LIABILITY_TYPES.has(data.account_type)) {
            totalLiabilities += Math.abs(bal);
        } else {
            totalAssets += bal;
        }
    }

    const snapshot: BalanceSnapshot = {
        snapshot_id: period,
        period,
        net_worth: Math.round((totalAssets - totalLiabilities) * 100) / 100,
        total_assets: Math.round(totalAssets * 100) / 100,
        total_liabilities: Math.round(totalLiabilities * 100) / 100,
        breakdown,
    };

    try {
        await store.upsert(FinanceCollections.balanceSnapshots, period, snapshot, { failIfExists: true });
        return { snapshot, alreadyLocked: false };
    } catch (err) {
        if (err instanceof DuplicateRecordError) {
            const existing = await store.get<BalanceSnapshot>(FinanceCollections.balanceSnapshots, period);
            return { snapshot: existing!.data, alreadyLocked: true };
        }
        throw err;
    }
}

interface LedgerTx { context_id: string; amount: number }
interface BudgetCategory { category_id: string; context_id: string; allocation_cap: number }

export async function computeCapexBurn(
    store: RecordStore,
    opts: { now?: Date } = {},
): Promise<{ overruns: Array<{ context_id: string; spent: number; cap: number; recId: string }> }> {
    const now = opts.now ?? new Date();
    const contexts = await store.list<{ context_id: string; archetype_mode: string; name: string }>(
        FinanceCollections.budgetContexts,
    );
    const capexContexts = contexts.filter(
        (c) => c.data.archetype_mode === "CAPEX_PROJECT" || c.recordId === DefaultContexts.capex,
    );
    if (capexContexts.length === 0) return { overruns: [] };

    const txs = await store.list<LedgerTx>(FinanceCollections.transactions);
    const cats = await store.list<BudgetCategory>(FinanceCollections.budgetCategories);
    const overruns: Array<{ context_id: string; spent: number; cap: number; recId: string }> = [];

    for (const { data: ctx } of capexContexts) {
        const spent = txs
            .filter((t) => t.data.context_id === ctx.context_id && t.data.amount < 0)
            .reduce((s, t) => s + Math.abs(t.data.amount), 0);
        const cap = cats
            .filter((c) => c.data.context_id === ctx.context_id)
            .reduce((s, c) => s + (c.data.allocation_cap || 0), 0);
        if (cap > 0 && spent > cap) {
            const rec = await createRecommendation(store, {
                kind: "capex_overrun",
                title: `CapEx overrun: ${ctx.name}`,
                body: `Project "${ctx.name}" has spent ${spent.toFixed(2)} against a ${cap.toFixed(2)} allocation cap.`,
                payload: { context_id: ctx.context_id, spent, cap },
                now,
            });
            overruns.push({ context_id: ctx.context_id, spent, cap, recId: rec.rec_id });
        }
    }
    return { overruns };
}
