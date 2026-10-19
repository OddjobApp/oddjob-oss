import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QuickBooksProposalDetails, quickBooksActionCopy } from './QuickBooksProposalDetails';
afterEach(cleanup);

const invoice = {
    kind: 'quickbooks_action', actionName: 'quickbooks_create_invoice',
    summary: { company: 'Books Co', customer: 'Acme', subtotal: 75, currency: 'USD', lineCount: 2 },
    args: { txn_date: '2026-10-01', due_date: '2026-10-31', lines: [{ item_id: '3', description: 'Consulting', quantity: 2, unit_price: 25 }, { item_id: '4', quantity: 1, unit_price: 25 }] },
};

describe('QuickBooks proposal details', () => {
    it('formats line prices and totals as money in the invoice currency', () => {
        render(<QuickBooksProposalDetails payload={invoice} outcome={null} awaitingExecutive={false} />);
        expect(screen.getByText('Books Co · Acme')).toBeTruthy();
        expect(screen.getByText('2 × $25.00 = $50.00')).toBeTruthy();
        expect(screen.getByText('$75.00')).toBeTruthy();
    });
    it('reports a created invoice total as money', () => {
        render(<QuickBooksProposalDetails payload={invoice} outcome={{ success: true, result: { DocNumber: '1001', TotalAmt: 75 } }} awaitingExecutive={false} />);
        expect(screen.getByTestId('quickbooks-outcome')).toHaveTextContent('Created invoice 1001 for $75.00');
    });
    it('names the action that failed, not always "invoice"', () => {
        expect(quickBooksActionCopy('quickbooks_record_payment').failed).toBe('QuickBooks payment failed: ');
        expect(quickBooksActionCopy('quickbooks_void_invoice').failed).toBe('QuickBooks invoice void failed: ');
        expect(quickBooksActionCopy('quickbooks_create_customer').done({ DisplayName: 'Acme' })).toBe('QuickBooks customer Acme created.');
    });
    it('does not assume a currency it was not given', () => {
        render(<QuickBooksProposalDetails payload={{ ...invoice, summary: { ...invoice.summary, currency: undefined } }} outcome={null} awaitingExecutive={false} />);
        expect(screen.queryByText(/\$75\.00/)).toBeNull();
    });
});
