/**
 * Computer Use Studio types. Everything here mirrors what the trycua API returns;
 * the studio shows no figure the backend does not record.
 */

/** Watch the agent (view-only desktop) or take the keyboard and mouse yourself. */
export type ControlMode = "watch" | "control";

export interface StudioSession {
  id: string;
  os: string;
  status: string;
  provider?: string;
  actionCount?: number;
  expiresAt?: string;
  createdAt?: string;
}

export interface PendingPause {
  kind?: "yield" | "safety" | "supervised" | string;
  explanation?: string;
  action?: string;
  viewerUrl?: string;
}

export interface StudioTask {
  id: string;
  sessionId: string;
  task: string;
  status: string;
  stepCount?: number;
  maxSteps?: number;
  requireConfirmation?: boolean;
  result?: { summary?: string; pending?: PendingPause; reason?: string; turns?: number; [key: string]: unknown };
  error?: string | null;
  metadata?: { skillId?: string; [key: string]: unknown };
  createdAt?: string;
  completedAt?: string | null;
}

export interface StudioStep {
  id: string;
  stepNumber: number;
  phase: string;
  status: string;
  decision?: string | null;
  action?: string | null;
  plan?: Record<string, any>;
  payload?: Record<string, any>;
  result?: Record<string, any>;
  error?: string | null;
  createdAt: string;
}

export interface StudioSkill {
  id: string;
  name: string;
  status: "draft" | "active" | "archived" | string;
  site?: string | null;
  successCount: number;
  failureCount: number;
  sourceRecordingId?: string | null;
  updatedAt?: string;
}

export interface ComputerUseStudioProps {
  sessionId?: string;
  /** Opens this task in the dock, e.g. from a push notification. */
  taskId?: string;
  organizationId?: number;
  title?: string;
  initialGoal?: string;
  initialTeaching?: boolean;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onClose?: () => void;
  onControlModeChange?: (mode: ControlMode) => void;
  /** Hands a step to the chat beside the studio (CREW rail). */
  onFocusInChat?: (selection: { id: string; label: string; sublabel: string; type: string }, promptSuggestion?: string) => void;
  className?: string;
}

export const ACTIVE_TASK_STATUSES = ["queued", "running", "needs_confirmation"];
export const isActiveTask = (status: string) => ACTIVE_TASK_STATUSES.includes(status);
export const isUsableSession = (status?: string) => !!status && !["terminated", "expired", "failed"].includes(status);
