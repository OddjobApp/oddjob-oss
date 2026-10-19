/**
 * AppRecords collection names and TypeScript shapes — Scrum Master Workbench (Enhanced WOW).
 */

export const COLLECTIONS = {
  CAPACITY_PLANS: "scrum_workbench_capacity_plans",
  SPRINT_BACKLOG: "scrum_workbench_sprint_backlog",
  BLOCKERS: "scrum_workbench_blockers",
  RETRO_ACTIONS: "scrum_workbench_retro_actions",
  CYCLE_HANDOFFS: "scrum_workbench_cycle_handoffs",
  AGENT_CHAT: "scrum_workbench_agent_chat",
  STANDUP_REPORTS: "scrum_workbench_standup_reports",
  // Read-only — owned by PM Workbench
  PM_HANDOFFS: "pm_workbench_cycle_handoffs",
  // Read-only — owned by QA Workbench (dependency radar)
  QA_DEFECTS: "qa_workbench_defects",
  QA_QUALITY_GATES: "qa_workbench_quality_gates",
} as const;

export interface CapacityPlanRecord {
  id?: string;
  sprintNumber: number;
  availableEngineerDays: number;
  targetVelocity: number;
  hilFormId?: number;
  submittedAt?: string;
  hilCompletedAt?: string;
  planData?: Record<string, unknown>;
  mission1RunId?: number;
  mission1TriggeredAt?: string;
  // WOW: Jira sprint integration
  jiraSprintId?: number | null;
  jiraSprintUrl?: string | null;
}

export interface BacklogRecord {
  id?: string;
  jiraKey: string;
  summary: string;
  storyPoints: number;
  source: "pm_approved" | "active_sprint";
  sprintNumber: number;
  committedAt: string;
  mission3RunId?: number;
  mission3TriggeredAt?: string;
}

export interface BlockerRecord {
  id?: string;
  blockerId: string;
  jiraKey: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  description: string;
  owner: string;
  sprintNumber: number;
  loggedAt: string;
  resolvedAt: string | null;
  // WOW: Prediction
  predictedResolutionHours?: number | null;
  similarBlockerCount?: number | null;
  // WOW: Escalation
  escalatedTo?: "agent" | "human" | null;
  escalationRunId?: number | null;
  escalationHilFormId?: number | null;
  escalatedAt?: string | null;
}

export interface RetroActionRecord {
  id?: string;
  actionId: string;
  title: string;
  category: "Process" | "Tooling" | "Team";
  owner: string;
  dueDate: string;
  sprintNumber: number;
  createdAt: string;
  completedAt: string | null;
  // WOW: Jira ticket
  jiraIssueKey?: string | null;
  jiraIssueUrl?: string | null;
}

export interface HandoffRecord {
  id?: string;
  jiraKey: string;
  mission3RunId: number;
  sprintNumber: number;
  triggeredAt: string;
  triggeredBy: "scrum-master-workbench";
}

export interface PmHandoffRecord {
  id?: string;
  jiraKey: string;
  mission3RunId?: number;
  triggeredAt: string;
  triggeredBy: string;
}

// WOW: Agent Chat
export interface AgentChatRecord {
  id?: string;
  messageId: string;
  sprintNumber: number;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// WOW: Standup Reports
export interface StandupReportRecord {
  id?: string;
  reportId: string;
  sprintNumber: number;
  date: string;
  confluencePageId?: string;
  confluenceUrl?: string;
  content: string;
  publishedAt: string;
}

// WOW: QA cross-workbench reads (read-only types)
export interface QaDefectRecord {
  id?: string;
  defectId: string;
  title: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  status: "open" | "routed_to_dev" | "routed_to_hotfix";
  suiteName: string;
  jiraKey?: string;
  loggedAt: string;
}

export interface QaQualityGateRecord {
  id?: string;
  gateId: string;
  overallStatus: "passed" | "failed";
  evaluatedAt: string;
}
