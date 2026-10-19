/**
 * AppRecords collections — QA Workbench (Enhanced WOW).
 */
export const COLLECTIONS = {
  TEST_SUITES: "qa_workbench_test_suites",
  DEFECTS: "qa_workbench_defects",
  FIXTURES: "qa_workbench_fixtures",
  QUALITY_GATES: "qa_workbench_quality_gates",
  DEV_HANDOFFS: "qa_workbench_dev_handoffs",
  UAT_PACKAGES: "qa_workbench_uat_packages",
  CYCLE_HANDOFFS: "qa_workbench_cycle_handoffs",
  // WOW: New collections
  INVESTIGATIONS: "qa_workbench_investigations",
  TEST_REPORTS: "qa_workbench_test_reports",
  AGENT_CHAT: "qa_workbench_agent_chat",
} as const;

export interface TestSuiteRecord {
  id?: string; suiteId: string; suiteName: string; passCount: number; failCount: number;
  coveragePercent: number; evidenceUrl: string; releaseCandidate?: string;
  status: "passed" | "failed"; source?: "ci" | "playwright_manual"; runAt: string;
}

export interface DefectRecord {
  id?: string; defectId: string; title: string; severity: "Critical" | "High" | "Medium" | "Low";
  reproSteps: string; expectedResult: string; actualResult: string; suiteName: string;
  evidenceUrl?: string; requirementKey?: string;
  status: "open" | "routed_to_dev" | "routed_to_hotfix";
  externalIssueProvider: string | null; externalIssueKey: string | null;
  externalIssueUrl: string | null; externalIssueStatus: string | null;
  externalIssueCreatedAt: string | null; loggedAt: string;
}

export interface FixtureRecord {
  id?: string; fixtureId: string; description: string;
  associatedSuite: string; dataPayloadSummary: string; registeredAt: string;
}

export interface QualityGateRecord {
  id?: string; gateId: string; overallStatus: "passed" | "failed";
  rules: Array<{ name: string; status: "passed" | "failed"; value: number | boolean; threshold: number | boolean }>;
  evaluatedAt: string;
}

export interface DevHandoffRecord { id?: string; defectId: string; mission3RunId: number; triggeredAt: string; triggeredBy: "qa-workbench"; }
export interface UATPackageRecord { id?: string; packageId: string; passingSuites: number; failingSuites: number; avgCoverage: number; openDefectsBySeverity: Record<string, number>; fixtureCount: number; gateId: string; mission5RunId?: number; generatedAt: string; }
export interface HotfixHandoffRecord { id?: string; defectIds: string[]; mission7RunId: number; triggeredAt: string; triggeredBy: "qa-workbench"; }

// WOW: Investigation records
export type InvestigationType = "playwright_test" | "browser_autopilot" | "sql_query" | "log_reader" | "console_capture" | "verification_pipeline";

export interface InvestigationRecord {
  id?: string;
  investigationId: string;
  defectId?: string;
  type: InvestigationType;
  parameters: Record<string, unknown>;
  results: Record<string, unknown>;
  evidenceUrls: string[];
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
}

export interface TestReportRecord {
  id?: string;
  reportId: string;
  sprintNumber: number;
  confluencePageId?: string;
  confluenceUrl?: string;
  content: string;
  publishedAt: string;
}

export interface AgentChatRecord {
  id?: string;
  messageId: string;
  defectId?: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}
