/** Coverage is independent of whether every requested source page was read. */
export interface FinancialForecastCoverage {
  kind: 'scheduled_commitments' | 'input_projection';
  completeness: 'partial';
  modeled: string[];
  excluded: string[];
  confidence: 'heuristic_uncalibrated' | 'not_estimated';
}
export interface FinancialWorkflowReceipt {
  version: 1;
  recipe: 'financial_result_to_snapshot';
  organizationId: number;
  projectId: number | null;
  sessionKey: string;
  source: { turnId: number; artifactIndex: number; tool: string; hash: string; observedAt: string };
  snapshotId: string;
  checkpoint: 'awaiting_save' | 'saved';
}
/** Every monetary field emitted by the supported forecast calculators. */
export const FINANCIAL_SERIES_FIELDS = ['value', 'inflow', 'outflow', 'revenue', 'netIncome', 'assets',
  'liabilitiesAndEquity', 'operatingCashFlow', 'capex'] as const;
