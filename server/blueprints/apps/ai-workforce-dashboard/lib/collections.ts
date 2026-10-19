/**
 * AppRecords collections — Agent Fleet Command.
 */
export const COLLECTIONS = {
  BUDGET_CONTROLS: "fleet_command_budget_controls",
  AUTONOMY_POLICIES: "fleet_command_autonomy_policies",
  OPERATOR_NOTES: "fleet_command_operator_notes",
  PIP_ACTIONS: "fleet_command_pip_actions",
  GOVERNANCE_REPORTS: "fleet_command_governance_reports",
} as const;

export interface BudgetControlRecord {
  id?: string;
  agentId: string;
  tokenBudgetPerTicket: number;
  monthlyBudgetCap: number;
  alertThresholdPercent: number;
  savedAt: string;
}

export interface AutonomyPolicyRecord {
  id?: string;
  agentId: string;
  autonomyLevel: "full" | "supervised" | "manual";
  maxConsecutiveActions: number;
  requireApprovalFor: string[];
  savedAt: string;
}

export interface OperatorNoteRecord {
  id?: string;
  agentId: string;
  missionId: number | null;
  runId: number | null;
  action: "paused" | "resumed" | "cancelled" | "reassigned" | "overridden";
  reason: string;
  createdAt: string;
}

export interface PIPActionRecord {
  id?: string;
  agentId: string;
  targetSuccessRate: number;
  upskillingDataset: string;
  reason: string;
  status: "pending" | "active" | "completed";
  triggeredAt: string;
}

export interface GovernanceReportRecord {
  id?: string;
  reportId: string;
  confluencePageId?: string;
  confluenceUrl?: string;
  content: string;
  publishedAt: string;
}
