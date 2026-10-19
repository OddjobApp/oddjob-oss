/**
 * AppRecords collection names and TypeScript shapes for the PM Workbench (Enhanced).
 */

export const COLLECTIONS = {
  BACKLOG: "pm_workbench_backlog",
  SIGNOFFS: "pm_workbench_signoffs",
  HANDOFFS: "pm_workbench_cycle_handoffs",
  SOURCES: "pm_workbench_confluence_sources",
  AGENT_CHAT: "pm_workbench_agent_chat",
} as const;

export interface IntakeRecord {
  id?: string;
  jiraKey: string;
  summary: string;
  status: string;
  priority: string;
  assignee: string | null;
  issueType: string;
  selectedAt: string;
  // Confluence integration (enhanced)
  sourceConfluencePageId?: string | null;
  prdConfluencePageId?: string | null;
  confluencePageId?: string | null; // legacy alias for prdConfluencePageId
  prdLastPublishedAt?: string | null;
  approvalPacketPageId?: string | null;
  // Mission state
  mission2RunId?: number | null;
  pipelineRunId?: number | null;
  // Sign-off state
  hilFormId?: number | null;
  signoffStatus?: "pending" | "approved" | "changes_requested" | null;
  // Mission-3 state
  mission3RunId?: number | null;
  mission3TriggeredAt?: string | null;
  // Jira transition
  jiraTransitionedAt?: string | null;
}

export interface SignoffRecord {
  id?: string;
  jiraKey: string;
  hilFormId: number;
  prdStatus: string;
  uxMockupStatus: string;
  designSystemCompliance: string;
  scopingComments: string;
  reviewedStoryPoints: number;
  submittedAt: string;
  // Approval packet (enhanced)
  approvalPacketPageId?: string | null;
  approvalPacketUrl?: string | null;
}

export interface HandoffRecord {
  id?: string;
  jiraKey: string;
  mission3RunId: number;
  triggeredAt: string;
  triggeredBy: "pm-workbench";
}

export interface SourceRecord {
  id?: string;
  pageId: string;
  title: string;
  spaceKey: string;
  sourceType: "search" | "url_paste" | "deep_link" | "upload";
  loadedAt: string;
  originalFilename?: string | null;
}

export interface KnowledgeContext {
  query: string;
  results: Array<{
    type: string;
    title: string;
    content: string;
    relevance: number;
    source: string;
  }>;
  fetchedAt: string;
}

export interface PipelineStatus {
  runId: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  steps: Array<{
    stepId: number;
    status: string;
    output: any;
  }>;
}
