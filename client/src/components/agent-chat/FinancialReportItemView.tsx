import { formatCrewMoney } from '@shared/crew-money';
import React, { useMemo, useState } from 'react';
import { Calendar, TrendingUp, Search, Copy, Check, FileSpreadsheet, Code2, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GoogleWorkspaceIcon } from './GoogleWorkspaceIcon';
import type { WorkspaceResultItem } from '@shared/crew-workspace-results';

export interface ParsedFinancialRow {
  id: string;
  cells: string[];
  isSectionHeader: boolean;
  isSummary: boolean;
  isMajorTotal: boolean;
}

export interface ParsedFinancialReport {
  columns: string[];
  rows: ParsedFinancialRow[];
  kpis: { label: string; value: string; isHighlight?: boolean }[];
}

export function parseFinancialReportBody(body: string = '', currency?: string, moneyColumns?: number[]): ParsedFinancialReport {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { columns: ['Account / Line Item', 'Amount'], rows: [], kpis: [] };
  }

  const rawFirstRow = lines[0].split('|').map(c => c.trim());
  let columns: string[] = [];
  let dataLines = lines;

  // A row is considered a table column header if:
  // 1. The first cell is empty (Intuit standard for line items header)
  // 2. OR it contains header-like names (Account, Description, Line Item, etc.)
  // 3. OR none of the cells are numeric/currency and there are multiple lines
  const isHeaderRow =
    rawFirstRow.length > 1 &&
    (rawFirstRow[0] === '' ||
      /^(account|description|line item|name|customer|vendor)/i.test(rawFirstRow[0]) ||
      (!/\d/.test(rawFirstRow[rawFirstRow.length - 1]) && lines.length > 1));

  if (isHeaderRow) {
    columns = rawFirstRow.map((c, i) => c || (i === 0 ? 'Account / Line Item' : `Total`));
    dataLines = lines.slice(1);
  } else {
    const maxCols = Math.max(...lines.map(l => l.split('|').length), 2);
    columns = ['Account / Line Item', ...Array.from({ length: maxCols - 1 }, (_, i) => (i === maxCols - 2 ? 'Total' : `Amount ${i + 1}`))];
  }

  const rows: ParsedFinancialRow[] = [];
  const kpis: { label: string; value: string; isHighlight?: boolean }[] = [];
  const seenKpis = new Set<string>();

  for (let idx = 0; idx < dataLines.length; idx++) {
    const line = dataLines[idx];
    const cells = line.split('|').map((c, i) => currency && c.trim() && i > 0 && (moneyColumns ? moneyColumns.includes(i) : !/percent|%|quantity|count|date|number|num\b|id\b/i.test(columns[i] || '')) ? formatCrewMoney(c.trim(), currency) : c.trim());
    const firstCell = cells[0] || '';
    const otherCells = cells.slice(1);
    const hasValues = otherCells.some(c => Boolean(c) && !/^[-–—\s]+$/.test(c));

    const isSectionHeader = !hasValues && firstCell.length > 0 && !/^(total|net|gross)\b/i.test(firstCell);
    const isSummary = /^(total|net|gross)\b/i.test(firstCell) || /^total$/i.test(firstCell);
    const isMajorTotal = /^(net income|net profit|total income|total revenue|gross profit|total expenses|total assets|total liabilities|total equity|net cash)/i.test(firstCell);

    if ((isMajorTotal || (/^total\b/i.test(firstCell) && dataLines.length <= 5)) && otherCells.length > 0) {
      const lastVal = otherCells.filter(Boolean).pop();
      const normKey = firstCell.toLowerCase();
      if (lastVal && !seenKpis.has(normKey)) {
        seenKpis.add(normKey);
        kpis.push({
          label: firstCell,
          value: lastVal,
          isHighlight: /^(net income|net profit|gross profit|net cash)/i.test(firstCell),
        });
      }
    }

    rows.push({
      id: `row-${idx}`,
      cells,
      isSectionHeader,
      isSummary,
      isMajorTotal,
    });
  }

  return { columns, rows, kpis };
}

export function formatReportAsMarkdown(report: ParsedFinancialReport, title: string, period?: string): string {
  const parts: string[] = [];
  parts.push(`### ${title}`);
  if (period) parts.push(`*Period: ${period}*\n`);

  const headers = report.columns;
  parts.push(`| ${headers.join(' | ')} |`);
  parts.push(`| ${headers.map((_, i) => (i === 0 ? ':---' : '---:')).join(' | ')} |`);

  for (const row of report.rows) {
    if (row.isSectionHeader) {
      parts.push(`| **${row.cells[0]}** | ${headers.slice(1).map(() => '').join(' | ')} |`);
    } else if (row.isMajorTotal || row.isSummary) {
      parts.push(`| **${row.cells[0]}** | ${row.cells.slice(1).map(c => `**${c}**`).join(' | ')} |`);
    } else {
      parts.push(`| ${row.cells.join(' | ')} |`);
    }
  }
  return parts.join('\n');
}

export function FinancialReportSkeleton({
  title = 'Profit and Loss',
  dateDisplay,
}: {
  title?: string;
  dateDisplay?: string;
}) {
  return (
    <div className="space-y-3.5" data-testid="financial-report-skeleton">
      {/* Header Info Skeleton */}
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <GoogleWorkspaceIcon kind="accounting" platform="quickbooks" className="h-5 w-5 shrink-0" />
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <span className="text-xs text-muted-foreground">QuickBooks</span>
          </div>
          {dateDisplay ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <span>{dateDisplay}</span>
            </p>
          ) : (
            <div className="h-3.5 w-32 rounded bg-muted/40 animate-pulse" />
          )}
        </div>
        <div className="h-5 w-12 rounded bg-muted/40 animate-pulse" />
      </div>

      {/* KPI Overview Cards Skeleton */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 sm:grid-cols-3 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2 bg-card px-3 py-2">
            <div className="h-2.5 w-16 rounded bg-muted/50 animate-pulse motion-reduce:animate-none" />
            <div className="h-5 w-24 rounded bg-muted/40 animate-pulse motion-reduce:animate-none" />
          </div>
        ))}
      </div>

      {/* Filter Bar Skeleton */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="h-8 min-w-[180px] max-w-xs flex-1 rounded-md bg-muted/30 animate-pulse" />
        <div className="flex items-center gap-1.5">
          <div className="h-8 w-24 rounded-md bg-muted/30 animate-pulse" />
          <div className="h-8 w-28 rounded-md bg-muted/30 animate-pulse" />
        </div>
      </div>

      {/* Table Skeleton */}
      <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <div className="p-3 border-b border-border bg-muted/40 flex items-center justify-between">
          <div className="h-3 w-32 rounded bg-muted/60 animate-pulse" />
          <div className="h-3 w-16 rounded bg-muted/60 animate-pulse" />
        </div>
        <div className="divide-y divide-border/60 p-1">
          {[1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="py-2.5 px-3 flex items-center justify-between">
              <div className="h-3 w-40 rounded bg-muted/30 animate-pulse" />
              <div className="h-3 w-20 rounded bg-muted/40 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export interface FinancialReportItemViewProps {
  item: WorkspaceResultItem;
  isLoading?: boolean;
}

export function FinancialReportItemView({ item, isLoading = false }: FinancialReportItemViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'raw'>('table');
  const [copied, setCopied] = useState(false);
  const [insertedIntoScribe, setInsertedIntoScribe] = useState(false);

  const report = useMemo(() => parseFinancialReportBody(item.body || '', item.currency, item.moneyColumns), [item.body, item.currency, item.moneyColumns]);

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return report.rows;
    const q = searchTerm.toLowerCase();
    return report.rows.filter(r => r.cells.some(c => c.toLowerCase().includes(q)));
  }, [report.rows, searchTerm]);

  const dateDisplay = useMemo(() => {
    if (item.reportStart && item.reportEnd) {
      return `${item.reportStart} → ${item.reportEnd}`;
    }
    return item.preview || '';
  }, [item.reportStart, item.reportEnd, item.preview]);

  if (isLoading || (!item.body && !report.rows.length)) {
    return <FinancialReportSkeleton title={item.title} dateDisplay={dateDisplay} />;
  }

  const handleCopyMarkdown = async () => {
    try {
      const md = formatReportAsMarkdown(report, item.title, dateDisplay);
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard permission is unavailable
    }
  };

  const handleInsertIntoScribe = () => {
    const md = formatReportAsMarkdown(report, item.title, dateDisplay);
    window.dispatchEvent(
      new CustomEvent('scribe:insert-text', {
        detail: {
          text: md,
          source: 'quickbooks_report',
          reportName: item.title,
        },
      }),
    );
    setInsertedIntoScribe(true);
    setTimeout(() => setInsertedIntoScribe(false), 2000);
  };

  return (
    <div className="space-y-3.5">
      {/* Header Info */}
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <GoogleWorkspaceIcon kind="accounting" platform="quickbooks" className="h-5 w-5 shrink-0" />
            <h4 className="text-sm font-semibold text-foreground">{item.title}</h4>
            <span className="text-xs text-muted-foreground">QuickBooks</span>
          </div>
          {dateDisplay && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <span>{dateDisplay}</span>
            </p>
          )}
        </div>
        {item.currency && (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground">
            {item.currency}
          </span>
        )}
      </div>

      {/* KPI Overview Cards */}
      {report.kpis.length > 0 && (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 sm:grid-cols-3 md:grid-cols-4">
          {report.kpis.map((kpi, idx) => (
            <div key={`${kpi.label}-${idx}`} className="min-w-0 bg-card px-3 py-2">
              <dt className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                {kpi.isHighlight && <TrendingUp className="h-3 w-3 shrink-0 text-primary" aria-hidden />}
                <span className="truncate">{kpi.label}</span>
              </dt>
              <dd className={`mt-0.5 truncate text-base font-semibold tabular-nums ${kpi.isHighlight ? 'text-primary' : 'text-foreground'}`}>
                {kpi.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* Controls: Search, View Mode, and Copy */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="relative min-w-[180px] max-w-xs flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Filter accounts or lines..."
            className="h-8 pl-8 text-xs min-h-[32px]"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs gap-1.5"
            onClick={handleCopyMarkdown}
            title="Copy as Markdown table"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? 'Copied' : 'Copy table'}</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs gap-1.5"
            onClick={handleInsertIntoScribe}
            title="Insert formatted financial table into Scribe Studio canvas"
          >
            {insertedIntoScribe ? <Check className="h-3.5 w-3.5 text-primary" /> : <PenLine className="h-3.5 w-3.5" />}
            <span>{insertedIntoScribe ? 'Inserted in Scribe' : 'Insert in Scribe'}</span>
          </Button>

          <Button
            variant={viewMode === 'table' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 px-2.5 text-xs gap-1"
            onClick={() => setViewMode('table')}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Table</span>
          </Button>

          <Button
            variant={viewMode === 'raw' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 px-2.5 text-xs gap-1"
            onClick={() => setViewMode('raw')}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Raw</span>
          </Button>
        </div>
      </div>

      {/* Table View */}
      {viewMode === 'table' ? (
        <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 border-b border-border bg-muted/80 backdrop-blur-sm">
                <tr>
                  {report.columns.map((col, idx) => (
                    <th
                      key={idx}
                      className={`p-2.5 font-semibold text-muted-foreground ${
                        idx === 0 ? 'text-left' : 'text-right'
                      }`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredRows.length > 0 ? (
                  filteredRows.map(row => {
                    if (row.isSectionHeader) {
                      return (
                        <tr key={row.id} className="bg-muted/40">
                          <td
                            colSpan={report.columns.length}
                            className="p-2 font-semibold text-muted-foreground"
                          >
                            {row.cells[0]}
                          </td>
                        </tr>
                      );
                    }

                    const isHighlighted = row.isMajorTotal;
                    const isSubtotal = row.isSummary;

                    return (
                      <tr
                        key={row.id}
                        className={`transition-colors ${
                          isHighlighted
                            ? 'bg-muted/30 font-semibold'
                            : isSubtotal
                            ? 'bg-muted/15 font-medium'
                            : 'hover:bg-muted/30'
                        }`}
                      >
                        {row.cells.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className={`p-2 ${
                              cIdx === 0
                                ? `text-left ${!isSubtotal && !isHighlighted ? 'pl-5 text-foreground' : 'text-foreground'}`
                                : 'text-right font-mono tabular-nums text-foreground'
                            }`}
                          >
                            {cell}
                          </td>
                        ))}
                        {/* Pad empty cells if row had fewer columns than headers */}
                        {Array.from({ length: Math.max(0, report.columns.length - row.cells.length) }).map(
                          (_, padIdx) => (
                            <td key={`pad-${padIdx}`} className="p-2" />
                          ),
                        )}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={report.columns.length} className="p-4 text-center text-muted-foreground">
                      No line items matching &ldquo;{searchTerm}&rdquo;
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground">
            {item.body}
          </pre>
        </div>
      )}
    </div>
  );
}
