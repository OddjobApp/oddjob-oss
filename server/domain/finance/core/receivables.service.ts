/**
 * Receivables / Invoicing engine (cadence addition).
 *
 * Weekly sweep over open invoices: anything past its due date (plus a grace
 * window) is marked OVERDUE and raises a receivable_overdue recommendation so
 * the user can send a reminder. Advisory only — BudgetMaster drafts dunning,
 * it does not collect.
 */

import { RecordStore } from "./record-store.js";
import { FinanceCollections } from "./collections.js";
import { createRecommendation } from "./recommendations.js";
import type { Receivable } from "./cash-flow-forecast.service.js";

const OPEN_STATUSES = new Set(["DRAFT", "SENT", "PARTIAL", "OVERDUE"]);

export interface ReceivablesScanOptions {
    graceDays?: number; // days past due before flagging
    now?: Date;
}

export interface AgedReceivable {
    invoice_id: string;
    outstanding: number;
    daysPastDue: number;
    recId?: string;
}

export interface ReceivablesScanResult {
    overdue: AgedReceivable[];
    totalOutstanding: number;
    totalOverdue: number;
}

const DEFAULTS = { graceDays: 0 };

export async function scanReceivables(
    store: RecordStore,
    opts: ReceivablesScanOptions = {},
): Promise<ReceivablesScanResult> {
    const now = opts.now ?? new Date();
    const graceDays = opts.graceDays ?? DEFAULTS.graceDays;
    const rows = await store.list<Receivable>(FinanceCollections.receivables);

    const overdue: AgedReceivable[] = [];
    let totalOutstanding = 0;
    let totalOverdue = 0;

    for (const { recordId, data } of rows) {
        if (!OPEN_STATUSES.has(data.status)) continue;
        const outstanding = (data.amount || 0) - (data.amount_paid || 0);
        if (outstanding <= 0) continue;
        totalOutstanding += outstanding;

        const due = data.due_date ? new Date(data.due_date) : null;
        if (!due || isNaN(due.getTime())) continue;
        const daysPastDue = (now.getTime() - due.getTime()) / 86_400_000;
        if (daysPastDue <= graceDays) continue;

        // Flip to OVERDUE (idempotent — only writes a rec the first time).
        const wasOverdue = data.status === "OVERDUE";
        if (!wasOverdue) {
            await store.upsert(FinanceCollections.receivables, recordId, { ...data, status: "OVERDUE" });
        }
        totalOverdue += outstanding;

        let recId: string | undefined;
        if (!wasOverdue) {
            const rec = await createRecommendation(store, {
                kind: "receivable_overdue",
                title: `Overdue invoice: ${data.customer_token ?? data.invoice_id}`,
                body: `Invoice ${data.invoice_id} for ${outstanding.toFixed(2)} is ${Math.round(daysPastDue)} days past due. Draft a reminder?`,
                payload: {
                    invoice_id: data.invoice_id,
                    outstanding,
                    days_past_due: Math.round(daysPastDue),
                    customer_token: data.customer_token,
                },
                now,
            });
            recId = rec.rec_id;
        }
        overdue.push({ invoice_id: data.invoice_id, outstanding, daysPastDue: Math.round(daysPastDue), recId });
    }

    return {
        overdue,
        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        totalOverdue: Math.round(totalOverdue * 100) / 100,
    };
}
