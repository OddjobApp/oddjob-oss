/**
 * Cash Drag / Yield Arbitrage engine (PRD §4.2).
 *
 * Idle cash sitting in low/zero-yield checking accounts above a floor incurs
 * an opportunity "drag" equal to the foregone yield. When the drag is material
 * we raise a sweep recommendation for human authorization (advisory only —
 * BudgetMaster never moves money itself).
 */

import { RecordStore } from "./record-store.js";
import { FinanceCollections } from "./collections.js";
import { createRecommendation } from "./recommendations.js";

export interface FinanceAccount {
    account_id: string;
    name: string;
    account_type: string;
    base_currency: string;
    current_balance: number;
}

export interface CashDragOptions {
    floor: number; // keep this much liquid in checking
    yieldDelta: number; // annual yield gap between checking and a sweep target (e.g. 0.045)
    minDragToFlag: number; // only flag if annual drag exceeds this
    now?: Date;
}

export interface CashDragResult {
    sweeps: Array<{ account_id: string; idle: number; annualDrag: number; recId: string }>;
    totalIdle: number;
}

const DEFAULTS: Required<Omit<CashDragOptions, "now">> = {
    floor: 5000,
    yieldDelta: 0.045,
    minDragToFlag: 50,
};

export async function scanIdleCash(store: RecordStore, opts: Partial<CashDragOptions> = {}): Promise<CashDragResult> {
    const cfg = { ...DEFAULTS, ...opts };
    const now = opts.now ?? new Date();
    const accounts = await store.list<FinanceAccount>(FinanceCollections.accounts);
    const sweeps: CashDragResult["sweeps"] = [];
    let totalIdle = 0;

    for (const { data } of accounts) {
        if (data.account_type !== "CHECKING") continue;
        const idle = (data.current_balance || 0) - cfg.floor;
        if (idle <= 0) continue;
        const annualDrag = idle * cfg.yieldDelta;
        if (annualDrag < cfg.minDragToFlag) continue;

        totalIdle += idle;
        const rec = await createRecommendation(store, {
            kind: "sweep",
            title: `Idle cash detected in ${data.name}`,
            body: `${idle.toFixed(2)} is sitting above your ${cfg.floor} liquidity floor, foregoing ~${annualDrag.toFixed(2)}/yr at a ${(cfg.yieldDelta * 100).toFixed(1)}% yield gap. Authorize a sweep to a higher-yield account?`,
            payload: {
                account_id: data.account_id,
                idle,
                annual_drag: annualDrag,
                suggested_sweep_amount: idle,
                form_ref: "Cash Sweep Authorization",
            },
            now,
        });
        sweeps.push({ account_id: data.account_id, idle, annualDrag, recId: rec.rec_id });
    }

    return { sweeps, totalIdle };
}
