/**
 * Annual 1099 / W-2 Information Returns engine (cadence addition).
 *
 * Clusters business-context payments by recipient for the tax year and builds a
 * tax_documents record for every contractor paid >= the 1099-NEC threshold
 * ($600). Existing W-9 / TIN verification flags are preserved across re-runs;
 * filing_status is READY only when both are on file. Raises an info_return_due
 * recommendation summarising the batch and any missing W-9s, routed to the HIL
 * filing form ahead of the Jan 31 deadline.
 */

import { RecordStore } from "./record-store.js";
import { FinanceCollections, DefaultContexts } from "./collections.js";
import { createRecommendation } from "./recommendations.js";
import type { LedgerTransaction } from "./transaction.service.js";

const DEFAULT_THRESHOLD = 600;

export interface TaxDocument {
    doc_id: string;
    tax_year: string;
    recipient_name: string;
    recipient_type: "CONTRACTOR_1099" | "EMPLOYEE_W2";
    form_type: "1099-NEC" | "W-2";
    total_paid: number;
    w9_on_file: boolean;
    tin_verified: boolean;
    filing_status: "PENDING" | "READY" | "FILED";
    filed_at?: string;
}

export interface InformationReturnsOptions {
    taxYear?: string;
    threshold?: number; // 1099-NEC reporting floor (default 600)
    persist?: boolean;
    now?: Date;
}

export interface InformationReturnsResult {
    documents: TaxDocument[];
    missingW9: string[]; // recipient names still missing a W-9 / TIN
    recId?: string;
}

function slug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "recipient";
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

export async function assembleInformationReturns(
    store: RecordStore,
    opts: InformationReturnsOptions = {},
): Promise<InformationReturnsResult> {
    const now = opts.now ?? new Date();
    const taxYear = opts.taxYear ?? String(now.getUTCFullYear() - 1); // returns cover the prior year
    const threshold = opts.threshold ?? DEFAULT_THRESHOLD;

    const contexts = await store.list<{ context_id: string; archetype_mode?: string }>(
        FinanceCollections.budgetContexts,
    );
    const businessCtxIds = new Set(
        contexts
            .filter((c) => c.data.archetype_mode === "TAX_SCHEDULE_E" || c.recordId === DefaultContexts.scheduleE)
            .map((c) => c.data.context_id),
    );
    businessCtxIds.add(DefaultContexts.scheduleE);

    // Sum outflow payments per recipient (payee_clean, falling back to payee_raw).
    const txs = await store.list<LedgerTransaction>(FinanceCollections.transactions);
    const paidByRecipient = new Map<string, number>();
    for (const { data } of txs) {
        if (data.is_split) continue;
        if (!businessCtxIds.has(data.context_id)) continue;
        if (!(data.timestamp || "").startsWith(taxYear)) continue;
        const amt = data.amount || 0;
        if (amt >= 0) continue; // payments to contractors are outflows
        const recipient = (data.payee_clean || data.payee_raw || "").trim();
        if (!recipient) continue;
        paidByRecipient.set(recipient, (paidByRecipient.get(recipient) || 0) + Math.abs(amt));
    }

    // Pre-load existing docs to preserve W-9 / TIN flags across re-runs.
    const existing = await store.list<TaxDocument>(FinanceCollections.taxDocuments);
    const existingById = new Map(existing.map((e) => [e.recordId, e.data]));

    const documents: TaxDocument[] = [];
    const missingW9: string[] = [];

    for (const [recipient, total] of paidByRecipient) {
        if (total < threshold) continue;
        const docId = `${taxYear}-${slug(recipient)}`;
        const prior = existingById.get(docId);
        const w9 = prior?.w9_on_file ?? false;
        const tin = prior?.tin_verified ?? false;
        const doc: TaxDocument = {
            doc_id: docId,
            tax_year: taxYear,
            recipient_name: recipient,
            recipient_type: prior?.recipient_type ?? "CONTRACTOR_1099",
            form_type: prior?.form_type ?? "1099-NEC",
            total_paid: round(total),
            w9_on_file: w9,
            tin_verified: tin,
            filing_status: prior?.filing_status === "FILED" ? "FILED" : w9 && tin ? "READY" : "PENDING",
            filed_at: prior?.filed_at,
        };
        documents.push(doc);
        if (!w9 || !tin) missingW9.push(recipient);
        if (opts.persist) {
            await store.upsert(FinanceCollections.taxDocuments, docId, doc);
        }
    }

    const result: InformationReturnsResult = { documents, missingW9 };

    if (opts.persist && documents.length > 0) {
        const rec = await createRecommendation(store, {
            kind: "info_return_due",
            title: `${documents.length} information return(s) for ${taxYear}${missingW9.length ? ` — ${missingW9.length} missing W-9` : ""}`,
            body: `${documents.length} recipient(s) cleared the ${threshold} threshold for tax year ${taxYear}.${missingW9.length ? ` Missing W-9 / TIN for: ${missingW9.join(", ")}.` : " All W-9s on file."} File by Jan 31.`,
            payload: {
                tax_year: taxYear,
                document_count: documents.length,
                missing_w9: missingW9,
                form_ref: "1099 / W-2 Filing Authorization",
            },
            now,
        });
        result.recId = rec.rec_id;
    }

    return result;
}
