import React from 'react';
import { FinancialReportItemView } from '@/components/agent-chat/FinancialReportItemView';
import { cn } from '@/lib/utils';
import type { WorkspaceResultItem } from '@shared/crew-workspace-results';

export interface FinancialReportCardPodProps {
  title?: string;
  reportStart?: string;
  reportEnd?: string;
  currency?: string;
  body?: string;
  isLoading?: boolean;
  className?: string;
}

const DEFAULT_REPORT_BODY = [
  ' | Q3 Total',
  'Operating Income',
  'SaaS Subscriptions | 1,420,000.00',
  'Enterprise Contracts | 840,000.00',
  'Consulting & Support | 220,000.00',
  'Total Operating Income | 2,480,000.00',
  'Operating Expenses',
  'Infrastructure Cloud Compute | 410,000.00',
  'Inference Model Routing | 320,000.00',
  'Engineering & Personnel | 890,000.00',
  'Total Operating Expenses | 1,620,000.00',
  'Net Income | 860,000.00',
].join('\n');

export default function FinancialReportCardPod({
  title = 'Q3 Consolidated Profit & Loss',
  reportStart = '2026-07-01',
  reportEnd = '2026-09-30',
  currency = 'USD',
  body = DEFAULT_REPORT_BODY,
  isLoading = false,
  className,
}: FinancialReportCardPodProps) {
  const item: WorkspaceResultItem = {
    id: 'report-q3-pl',
    kind: 'accounting',
    platform: 'quickbooks',
    quickBooksReport: 'ProfitAndLoss',
    title,
    reportStart,
    reportEnd,
    currency,
    body,
    preview: `${reportStart} → ${reportEnd} | ${currency}`,
  };

  return (
    <div className={cn('w-full max-w-2xl mx-auto p-4 rounded-xl border border-border bg-card shadow-sm', className)}>
      <FinancialReportItemView item={item} isLoading={isLoading} />
    </div>
  );
}

export { FinancialReportCardPod };
