import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  FinancialReportItemView,
  parseFinancialReportBody,
  formatReportAsMarkdown,
} from './FinancialReportItemView';
import type { WorkspaceResultItem } from '@shared/crew-workspace-results';

afterEach(cleanup);

describe('FinancialReportItemView', () => {
  const sampleBody = [
    ' | Total',
    'Income',
    'Sales | 5,000.00',
    'Consulting | 2,500.00',
    'Total Income | 7,500.00',
    'Expenses',
    'Software | 500.00',
    'Advertising | 1,000.00',
    'Total Expenses | 1,500.00',
    'Net Income | 6,000.00',
  ].join('\n');

  const sampleItem: WorkspaceResultItem = {
    id: 'ProfitAndLoss',
    kind: 'accounting',
    platform: 'quickbooks',
    quickBooksReport: 'ProfitAndLoss',
    title: 'Profit and Loss',
    reportStart: '2026-10-01',
    reportEnd: '2026-10-08',
    currency: 'USD',
    preview: '2026-10-01 | 2026-10-08 | USD',
    body: sampleBody,
  };

  it('parses report body into columns, rows and KPI metrics', () => {
    const parsed = parseFinancialReportBody(sampleBody);
    expect(parsed.columns[0]).toBe('Account / Line Item');
    expect(parsed.columns[1]).toBe('Total');

    // Section headers
    const incomeHeader = parsed.rows.find(r => r.cells[0] === 'Income');
    expect(incomeHeader?.isSectionHeader).toBe(true);

    // Major totals / KPIs
    const netIncomeKpi = parsed.kpis.find(k => /net income/i.test(k.label));
    expect(netIncomeKpi?.value).toBe('6,000.00');
    expect(netIncomeKpi?.isHighlight).toBe(true);

    const totalIncomeKpi = parsed.kpis.find(k => /total income/i.test(k.label));
    expect(totalIncomeKpi?.value).toBe('7,500.00');
  });

  it('formats report as a valid GitHub-flavored Markdown table', () => {
    const parsed = parseFinancialReportBody(sampleBody);
    const md = formatReportAsMarkdown(parsed, 'Profit and Loss', '2026-10-01 → 2026-10-08');
    expect(md).toContain('### Profit and Loss');
    expect(md).toContain('| Account / Line Item | Total |');
    expect(md).toContain('| :--- | ---: |');
    expect(md).toContain('| **Net Income** | **6,000.00** |');
  });

  it('renders title, badges, KPI cards and formatted rows', () => {
    render(<FinancialReportItemView item={sampleItem} />);

    expect(screen.getByText('Profit and Loss')).toBeTruthy();
    expect(screen.getByText('QuickBooks')).toBeTruthy();
    expect(screen.getByText('USD')).toBeTruthy();
    expect(screen.getByText('2026-10-01 → 2026-10-08')).toBeTruthy();

    // Check KPI cards
    expect(screen.getAllByText('Net Income').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$6,000.00').length).toBeGreaterThan(0);

    // Check table rows
    expect(screen.getByText('Consulting')).toBeTruthy();
    expect(screen.getByText('$2,500.00')).toBeTruthy();
    expect(screen.getByText('Software')).toBeTruthy();
  });

  it('filters table rows using the search input', () => {
    render(<FinancialReportItemView item={sampleItem} />);

    expect(screen.getByText('Software')).toBeTruthy();
    expect(screen.getByText('Advertising')).toBeTruthy();

    const input = screen.getByPlaceholderText('Filter accounts or lines...');
    fireEvent.change(input, { target: { value: 'Software' } });

    expect(screen.getByText('Software')).toBeTruthy();
    expect(screen.queryByText('Advertising')).toBeNull();
  });

  it('switches between structured table view and raw text view', () => {
    render(<FinancialReportItemView item={sampleItem} />);

    expect(screen.getByRole('table')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.queryByRole('table')).toBeNull();
    const pre = document.querySelector('pre')!;
    expect(pre).toBeTruthy();
    expect(pre.textContent).toContain('Sales | 5,000.00');

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('copies Markdown table when clicking copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(<FinancialReportItemView item={sampleItem} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy table/ }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('### Profit and Loss'));
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('dispatches scribe:insert-text event when clicking Insert in Scribe', async () => {
    const insertedEvents: any[] = [];
    const listener = (e: Event) => insertedEvents.push((e as CustomEvent).detail);
    window.addEventListener('scribe:insert-text', listener);

    render(<FinancialReportItemView item={sampleItem} />);
    fireEvent.click(screen.getByRole('button', { name: /Insert in Scribe/ }));

    expect(insertedEvents.length).toBe(1);
    expect(insertedEvents[0].text).toContain('### Profit and Loss');
    expect(insertedEvents[0].text).toContain('| Account / Line Item | Total |');
    expect(insertedEvents[0].source).toBe('quickbooks_report');
    expect(await screen.findByText('Inserted in Scribe')).toBeTruthy();

    window.removeEventListener('scribe:insert-text', listener);
  });

  it('renders skeleton placeholder preview when isLoading is true', () => {
    render(<FinancialReportItemView item={sampleItem} isLoading={true} />);

    expect(screen.getByTestId('financial-report-skeleton')).toBeTruthy();
    expect(screen.getByText('QuickBooks')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders skeleton placeholder preview when body is empty', () => {
    const emptyItem = { ...sampleItem, body: '' };
    render(<FinancialReportItemView item={emptyItem} />);

    expect(screen.getByTestId('financial-report-skeleton')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});


it('uses provider money columns so numeric document IDs and quantities stay unchanged', () => {
  const report = parseFinancialReportBody('Account | Num | Quantity | Total\nSales | 001 | 2 | 50', 'USD', [3]);
  expect(report.rows[0].cells).toEqual(['Sales', '001', '2', '$50.00']);
  expect(formatReportAsMarkdown(report, 'Transactions')).toContain('Sales | 001 | 2 | $50.00');
});
