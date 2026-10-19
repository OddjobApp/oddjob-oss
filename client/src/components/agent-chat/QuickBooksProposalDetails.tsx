import React from 'react';
import { formatCrewMoney } from '@shared/crew-money';

/**
 * The body of a QuickBooks approval card (InlineApprovalCard's
 * quickbooks_action branch): what approving will do, in the company's own
 * terms, and what it did once decided. Money is formatted in the record's
 * currency; an unverified currency says so rather than assuming one.
 */

type Outcome = { success?: boolean; discarded?: boolean; error?: string; result?: any } | null | undefined;

interface ActionCopy {
    heading: string;
    effect: string;
    /** The room message once approved and executed. */
    done: (result: any) => string;
    /** Prefix for a failure, followed by the reason. */
    failed: string;
}

const recordName = (result: any) => result?.DocNumber ?? result?.DisplayName ?? result?.Id ?? '';

const ACTIONS: Record<string, ActionCopy> = {
    quickbooks_create_invoice: {
        heading: 'Review QuickBooks invoice',
        effect: 'Approval creates an unpaid invoice. Taxes follow the QuickBooks company settings. It is not emailed and no payment is collected.',
        done: result => `QuickBooks invoice ${recordName(result)} created. It has not been emailed and no payment was collected.`,
        failed: 'QuickBooks invoice creation failed: ',
    },
    quickbooks_create_customer: {
        heading: 'Review QuickBooks customer',
        effect: 'Approval creates the customer record in QuickBooks Online.',
        done: result => `QuickBooks customer ${recordName(result)} created.`,
        failed: 'QuickBooks customer creation failed: ',
    },
    quickbooks_record_payment: {
        heading: 'Review QuickBooks payment',
        effect: 'Approval records the payment against the invoice and reduces its balance. No money moves.',
        done: result => `QuickBooks payment ${recordName(result)} recorded. The invoice balance was reduced.`,
        failed: 'QuickBooks payment failed: ',
    },
    quickbooks_void_invoice: {
        heading: 'Review QuickBooks invoice void',
        effect: 'Approval voids the invoice: its amounts are zeroed, the record is kept for audit, and this cannot be undone.',
        done: result => `QuickBooks invoice ${recordName(result)} voided.`,
        failed: 'QuickBooks invoice void failed: ',
    },
};

export const quickBooksActionCopy = (actionName: string | undefined): ActionCopy =>
    ACTIONS[actionName ?? ''] ?? ACTIONS.quickbooks_create_invoice;

export function QuickBooksProposalDetails({ payload, outcome, awaitingExecutive }: {
    payload: Record<string, any>;
    outcome: Outcome;
    awaitingExecutive: boolean;
}) {
    const copy = quickBooksActionCopy(payload.actionName);
    const summary = payload.summary ?? {};
    const args = payload.args ?? {};
    const currency: string = summary.currency || 'currency unverified';
    const money = (value: unknown, code: string = currency) => formatCrewMoney(value, code);
    const succeeded = outcome?.success && !outcome.discarded;
    const result = outcome?.result;

    return (
        <div className="space-y-2 text-sm" data-testid="quickbooks-proposal">
            <p className="font-medium text-foreground">{copy.heading}</p>
            <p>{[summary.company, summary.customer].filter(Boolean).join(' · ')}</p>
            {awaitingExecutive && (
                <p className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300" data-testid="quickbooks-executive-approval">
                    Needs an Executive’s approval: an Executive on this project, other than the person who asked, decides it.
                </p>
            )}

            {payload.actionName === 'quickbooks_create_customer' ? <>
                {args.company_name && <p>Company: {args.company_name}</p>}
                {args.email && <p>Email: {args.email}</p>}
                {args.phone && <p>Phone: {args.phone}</p>}
            </> : payload.actionName === 'quickbooks_record_payment' ? (
                <p>Payment of <strong className="tabular-nums">{money(summary.amount)}</strong> against invoice {summary.invoice} (balance {money(summary.balance)}).</p>
            ) : payload.actionName === 'quickbooks_void_invoice' ? (
                <p>Invoice {summary.invoice}: total {money(summary.total)}, balance {money(summary.balance)}.</p>
            ) : <>
                <p>
                    Invoice dated {args.txn_date}{args.due_date && `, due ${args.due_date}`}. Subtotal{' '}
                    <strong className="tabular-nums">{money(summary.subtotal)}</strong> over {summary.lineCount} {summary.lineCount === 1 ? 'line' : 'lines'}.
                </p>
                <ul className="space-y-0.5">
                    {(args.lines ?? []).map((line: any, index: number) => (
                        <li key={index} className="flex justify-between gap-3">
                            <span>{line.description || `Item ${line.item_id}`}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                                {line.quantity} × {money(line.unit_price)} = {money(Math.round(line.quantity * line.unit_price * 100) / 100)}
                            </span>
                        </li>
                    ))}
                </ul>
            </>}

            <p className="text-xs text-muted-foreground">{copy.effect}</p>
            {outcome?.success === false && <p role="alert" className="text-destructive">{outcome.error}</p>}
            {succeeded && (
                <p data-testid="quickbooks-outcome">
                    {payload.actionName === 'quickbooks_create_invoice' || !payload.actionName
                        ? <>Created invoice {recordName(result)} for {money(result?.TotalAmt, result?.CurrencyRef?.value ?? currency)}. Not emailed; no payment collected.</>
                        : copy.done(result)}
                </p>
            )}
        </div>
    );
}
