export interface SnapshotMetric { key:string; label:string; currency:string; value:string; periodStart?:string; periodEnd?:string }
export interface FinancialSnapshotView {
  id:string; name:string; status:'draft'|'saved'; organizationId:number; sessionKey:string;
  capturedAt:string; sourceAsOf:string; sourceTurnId:number; sourceTool:string;
  periodStart?:string; periodEnd?:string; sourceHash:string;
  sourceParameters?:Record<string,unknown>;
  metrics:SnapshotMetric[]; assumptions:string[]; exclusions:string[];
  workflow?:import('./financial-workflow.js').FinancialWorkflowReceipt;
  coverage?:import('./financial-workflow.js').FinancialForecastCoverage[];
  predictionAssessments?:{currency:string;predicted_label:string;confidence:number;calibration:'heuristic_uncalibrated'}[];
}
export interface FinancialSnapshotComparison {
  baseline:FinancialSnapshotView; current:FinancialSnapshotView; warnings:string[];
  rows:{label:string;currency:string;baseline:string|null;current:string|null;change:string|null;percent:string|null;baselinePeriod?:string;currentPeriod?:string}[];
}
