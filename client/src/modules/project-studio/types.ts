import type { ProjectPlanCommitResponse } from "@shared/project-plan-commit";

export type StudioDeliverableTarget = "scribe" | "app_studio" | "media" | "computer" | "none";

export interface WaveTaskItem {
  id: string;
  title: string;
  description?: string;
  isComplete: boolean;
  estimatedHours: number;
  assigneeName?: string;
  assigneeRole?: string;
  assigneeAgentCardId?: string;
}

export interface WaveAssignee {
  type: "human" | "agent" | "hybrid";
  name: string;
  role: string;
  competency?: string;
  estimatedCostUsd?: number;
  agentCardId?: string;
  tools?: string[];
  specialties?: string[];
  avatarUrl?: string;
}

export interface WaveSquad {
  lead: WaveAssignee;
  reviewers?: WaveAssignee[];
  sentinels?: WaveAssignee[];
}

export interface WaveGovernance {
  riskTier: "low" | "medium" | "high" | "critical";
  requiresDualSignOff: boolean;
  smtInvariants: string[];
}

export type WaveRuntimeStatus = "pending" | "running" | "completed" | "failed" | "paused";

export interface WavePlanItem {
  id: string;
  name: string;
  waveNumber: number;
  objective: string;
  isCriticalPath: boolean;
  estimatedDurationHours: number;
  /** Live runtime status when executing as a cycle */
  runtimeStatus?: WaveRuntimeStatus;
  /**
   * Where the hours came from. "unestimated" means nobody estimated this wave -
   * the number is 0 and must be shown as unknown, not as a duration. A synced
   * Crew plan whose steps carry no hours lands here.
   */
  estimateSource?: "estimated" | "unestimated";
  optimisticHours?: number;
  realisticHours?: number;
  pessimisticHours?: number;
  dependencies?: string[]; // IDs of predecessor waves
  deliverableBlueprint?: string;
  acceptanceCriteria?: string[];
  tasks?: WaveTaskItem[];
  assignee: WaveAssignee;
  squad?: WaveSquad;
  studioTarget?: StudioDeliverableTarget;
  knowledgeNodeIds?: string[];
  governance?: WaveGovernance;
}

export interface BlackboardSyncContext {
  decisions?: Array<{ id: number | string; statement: string; status: string; confidence?: number }>;
  plans?: Array<{
    id: number | string;
    title: string;
    description?: string;
    steps?: Array<{ text?: string; title?: string; done?: boolean; hours?: number }>;
    status?: string;
  }>;
  commitments?: Array<{ id: number | string; commitment: string; owner?: string; status: string }>;
}

export interface ProjectStudioProps {
  stageId?: string;
  title?: string;
  projectTitle?: string;
  objective?: string;
  defaultBudgetLimitUsd?: number;
  defaultTokenLimit?: number;
  defaultTargetSlaDays?: number;
  defaultMaxParallelMissions?: number;
  waves?: WavePlanItem[];
  defaultWaves?: WavePlanItem[];
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onClose?: () => void;
  onFocusInChat?: (selection: {
    waveId: string;
    waveTitle: string;
    objective: string;
  }, promptSuggestion?: string) => void;
  onStageComplete?: (payload: {
    stageId: string;
    projectTitle: string;
    objective: string;
    waves: WavePlanItem[];
    budgetLimitUsd: number;
    tokenLimit: number;
    maxParallelMissions: number;
    targetSlaDays: number;
    timestamp: string;
    _trace?: { traceparent: string; generatedAt: string };
    /** The saved cycle, as the server reported it. Only ever called after a confirmed save. */
    cycle: ProjectPlanCommitResponse;
  }) => void;
  /** CREW room's numeric id, as the rail holds it. */
  sessionId?: string | number;
  /** CREW room key (URL segment). Preferred: it addresses the room even before `session` loads. */
  roomKey?: string;
  /** Project Space to save into when mounted outside a CREW room. */
  projectId?: number;
  /** Existing cycle id to track live execution telemetry. */
  cycleId?: number;
  /**
   * Identity of this mount (room + turn) for the unsaved-draft cache. Without it
   * nothing is persisted, and a remount starts from the props again.
   */
  draftKey?: string;
  roomContext?: BlackboardSyncContext;
  onNavigateStudio?: (studio: StudioDeliverableTarget, context?: { waveId: string; title: string }) => void;
  className?: string;
}

export type CanvasViewMode = "gantt" | "dag" | "waves";
export type CompanionTab = "inspector" | "squad" | "governance";

