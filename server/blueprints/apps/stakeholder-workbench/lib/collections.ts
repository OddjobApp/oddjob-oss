/**
 * AppRecords collections — Stakeholder Workbench (Enhanced WOW).
 */
export const COLLECTIONS = {
  UAT_SIGNOFFS: "stakeholder_workbench_uat_signoffs",
  CAB_APPROVALS: "stakeholder_workbench_cab_approvals",
  ROI_CASES: "stakeholder_workbench_roi_cases",
  RELEASE_PACKETS: "stakeholder_workbench_release_packets",
  // WOW: New collections
  AGENT_CHAT: "stakeholder_workbench_agent_chat",
  RELEASE_DIGESTS: "stakeholder_workbench_release_digests",
  // Cross-workbench reads (read-only)
  PM_BACKLOG: "pm_workbench_backlog",
  SCRUM_CAPACITY: "scrum_workbench_capacity_plans",
  SCRUM_BLOCKERS: "scrum_workbench_blockers",
  QA_GATES: "qa_workbench_quality_gates",
  QA_DEFECTS: "qa_workbench_defects",
} as const;

export interface UATSignoffRecord {
  id?: string;
  status: string;
  blocker: string;
  comments: string;
  hours: string;
  cycleId?: number;
  submittedAt: string;
}

export interface CABApprovalRecord {
  id?: string;
  decision: string;
  deployWindow: string;
  riskLevel: string;
  checklist: string;
  rollback: string;
  cycleId?: number;
  submittedAt: string;
}

export interface ROICaseRecord {
  id?: string;
  tickets: string;
  manualHours: string;
  hourlyRate: string;
  aiCostPct: string;
  manualCost: number;
  aiCost: number;
  savings: number;
  cycleId?: number;
  submittedAt: string;
}

export interface ReleaseDigestRecord {
  id?: string;
  digestId: string;
  confluencePageId?: string;
  confluenceUrl?: string;
  cycleName: string;
  publishedAt: string;
}

export interface AgentChatRecord {
  id?: string;
  messageId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}
