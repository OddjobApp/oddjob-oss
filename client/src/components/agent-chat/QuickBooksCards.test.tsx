import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
vi.mock('@/lib/queryClient', async original => ({ ...(await original<any>()), apiRequest: vi.fn() }));
import { InlineApprovalCard } from './InlineApprovalCard';
import { WorkspaceResultCard } from './WorkspaceResultCard';
afterEach(cleanup);
describe('QuickBooks displayed cards', () => {
    it.each([
        ['quickbooks_create_customer', 'Review QuickBooks customer'],
        ['quickbooks_record_payment', 'Review QuickBooks payment'],
        ['quickbooks_void_invoice', 'Review QuickBooks invoice void'],
        ['quickbooks_create_invoice', 'Review QuickBooks invoice'],
    ])('renders a readable %s review', (actionName, heading) => {
        render(<InlineApprovalCard payload={{ kind: 'quickbooks_action', actionName, title: 'Accounting review', args: { lines: [{ item_id: '2', quantity: 1, unit_price: 50 }] }, summary: { company: 'Sandbox company', customer: 'Example customer', amount: 50, subtotal: 50, currency: 'USD', invoice: '001', balance: 100, total: 100, lineCount: 1 } }} onArtifactSubmit={vi.fn()} />);
        expect(screen.getByText(heading)).toBeTruthy();
        expect(screen.getByText(/Sandbox company/)).toBeTruthy();
        expect(document.body.textContent).not.toContain('"item_id"');
        if (actionName !== 'quickbooks_create_customer') {
            expect(document.body.textContent).toMatch(/\$(?:50|100)\.00/);
        }
    });
    it('selects one invoice, previews its content, and paginates with the correct cursor', () => {
        const select = vi.fn(), more = vi.fn();
        render(<WorkspaceResultCard turnId={1} tool="quickbooks_list_records" payload={{ type: 'google_workspace_results', title: 'QuickBooks', presentation: 'cards', sourceTool: 'quickbooks_list_records', sourceArgs: { entity: 'Invoice', outstanding: true }, nextStart: 26, items: [
            { id: 'Invoice:1', kind: 'accounting', platform: 'quickbooks', title: 'Invoice 001', body: 'Balance: 50', quickBooksEntity: 'Invoice', quickBooksRecordId: '1' },
            { id: 'Invoice:2', kind: 'accounting', platform: 'quickbooks', title: 'Invoice 002', body: 'Balance: 75', quickBooksEntity: 'Invoice', quickBooksRecordId: '2' },
        ] }} onSelect={select} onMore={more} />);
        fireEvent.click(screen.getAllByRole('checkbox')[0]);
        expect(select.mock.calls[0][0][0].item.id).toBe('Invoice:1');
        fireEvent.click(screen.getAllByRole('button', { name: 'Preview content' })[0]);
        expect(screen.getByText('Balance: 50')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
        expect(more.mock.calls[0][0]).toContain('"start":26');
    });
    it('renders a structured financial statement card for quickbooks_get_report with KPIs and variance action', () => {
        const onDiscuss = vi.fn();
        const body = [
            ' | Total',
            'Income',
            'Sales | 12000',
            'Total Income | 12000',
            'Expenses',
            'Payroll | 8000',
            'Total Expenses | 8000',
            'Net Income | 4000',
        ].join('\n');
        render(<WorkspaceResultCard turnId={1} tool="quickbooks_get_report" payload={{ type: 'google_workspace_results', title: 'QuickBooks financial report', presentation: 'cards', sourceTool: 'quickbooks_get_report', sourceArgs: { report: 'ProfitAndLoss' }, items: [
            { id: 'ProfitAndLoss', kind: 'accounting', platform: 'quickbooks', quickBooksReport: 'ProfitAndLoss', title: 'Profit and Loss', reportStart: '2026-10-01', reportEnd: '2026-10-08', currency: 'USD', body }
        ] }} onDiscuss={onDiscuss} />);
        expect(screen.getByText('Profit and Loss')).toBeTruthy();
        expect(screen.getByText('USD')).toBeTruthy();
        expect(screen.getAllByText('Net Income').length).toBeGreaterThan(0);
        expect(screen.getAllByText('$4,000.00').length).toBeGreaterThan(0);
        expect(screen.getByText('Payroll')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Analyze variance' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Analyze variance' }));
        expect(onDiscuss).toHaveBeenCalledWith(expect.anything(), 'respond');
    });
});
