/**
 * Transaction service — posts parsed statements to the ledger and enforces
 * the two integrity rules that JSONB datasets cannot express as DB constraints:
 *   1. FITID dedupe — fitid is the recordId, so the app_records unique index
 *      rejects duplicates; we surface that as a skipped (not failed) row.
 *   2. Split-ledger sum — a parent's child splits must sum to the parent amount,
 *      validated BEFORE any write so a mismatch leaves the ledger untouched.
 */

import { RecordStore, DuplicateRecordError } from "./record-store.js";
import { FinanceCollections } from "./collections.js";
import type { ParsedTransaction } from "./statement-parser.service.js";

const CENT = 0.005; // half-cent tolerance for float sums

export interface LedgerTransaction {
    fitid: string;
    account_id: string;
    context_id: string;
    category_id?: string;
    timestamp: string;
    payee_raw: string;
    payee_clean?: string;
    amount: number;
    current_status: "UNRECONCILED" | "CLEARED" | "RECONCILED";
    is_split: boolean;
    parent_tx_id?: string;
    categorization_confidence?: number;
}

export class SplitMismatchError extends Error {
    constructor(public parentFitid: string, public parentAmount: number, public childSum: number) {
        super(
            `Split mismatch on ${parentFitid}: children sum to ${childSum.toFixed(2)} but parent is ${parentAmount.toFixed(2)}`,
        );
        this.name = "SplitMismatchError";
    }
}

export interface IngestResult {
    inserted: number;
    skipped: number; // duplicate fitids
    fitids: string[];
}

/**
 * Post parsed transactions for one account/context. Duplicate FITIDs are
 * skipped (idempotent re-ingest). Returns counts for the caller/telemetry.
 */
export async function ingestParsedTransactions(
    store: RecordStore,
    params: { accountId: string; contextId: string; parsed: ParsedTransaction[] },
): Promise<IngestResult> {
    let inserted = 0;
    let skipped = 0;
    const fitids: string[] = [];

    for (const p of params.parsed) {
        const tx: LedgerTransaction = {
            fitid: p.fitid,
            account_id: params.accountId,
            context_id: params.contextId,
            timestamp: p.timestamp,
            payee_raw: p.payee_raw,
            amount: p.amount,
            current_status: "UNRECONCILED",
            is_split: false,
        };
        try {
            await store.upsert(FinanceCollections.transactions, p.fitid, tx, { failIfExists: true });
            inserted++;
            fitids.push(p.fitid);
        } catch (err) {
            if (err instanceof DuplicateRecordError) {
                skipped++;
                continue;
            }
            throw err;
        }
    }

    return { inserted, skipped, fitids };
}

/**
 * Create a split: a parent transaction divided into child legs. The child
 * amounts MUST sum to the parent amount. Validation happens before any write,
 * so a mismatch rejects the whole operation with zero side effects.
 */
export async function createSplit(
    store: RecordStore,
    params: {
        parent: LedgerTransaction;
        children: Array<Omit<LedgerTransaction, "parent_tx_id" | "is_split" | "account_id" | "context_id" | "current_status" | "timestamp" | "payee_raw"> & Partial<LedgerTransaction>>;
    },
): Promise<void> {
    const { parent, children } = params;
    const childSum = children.reduce((s, c) => s + (c.amount ?? 0), 0);

    if (Math.abs(childSum - parent.amount) > CENT) {
        throw new SplitMismatchError(parent.fitid, parent.amount, childSum);
    }

    // Validation passed — now write parent then children (no partial write path).
    await store.upsert(FinanceCollections.transactions, parent.fitid, { ...parent, is_split: true });
    for (const c of children) {
        const childFitid = c.fitid || `${parent.fitid}::${children.indexOf(c)}`;
        const child: LedgerTransaction = {
            fitid: childFitid,
            account_id: c.account_id ?? parent.account_id,
            context_id: c.context_id ?? parent.context_id,
            category_id: c.category_id,
            timestamp: c.timestamp ?? parent.timestamp,
            payee_raw: c.payee_raw ?? parent.payee_raw,
            amount: c.amount ?? 0,
            current_status: c.current_status ?? "UNRECONCILED",
            is_split: false,
            parent_tx_id: parent.fitid,
        };
        await store.upsert(FinanceCollections.transactions, childFitid, child);
    }
}

export async function countTransactions(store: RecordStore): Promise<number> {
    return (await store.list(FinanceCollections.transactions)).length;
}
