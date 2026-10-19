import type React from 'react';
import type { FormSchema } from '@domain-ui/core/ui/components/shared/FormRenderer';
import type {
  CopilotMode,
  CopilotEvidenceItem,
  CopilotActionPreview,
} from '@domain-ui/ai/core/copilot-contract.js';
import type { InputRequest } from '@domain-ui/ai/ui/modules/agent-ai';

export type ChatMode = CopilotMode;
export type EvidenceItem = CopilotEvidenceItem;

export interface UploadedAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  preview?: string;
}

export interface Message {
  receipt?: import('@shared/copilot-action-receipt').CopilotActionReceipt;
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
  mode?: ChatMode;
  evidence?: EvidenceItem[];
  /** Persisted server-side message id (arrives via the SSE `meta` event); used for feedback. */
  serverMessageId?: number;
  attachments?: UploadedAttachment[];
}

export interface WorkMemoryItem {
  id: string;
  title: string;
  status: 'previewed' | 'executed' | 'planned';
  mode: ChatMode;
  createdAt: number;
}

export interface CycleStepTransitionPayload {
  cycleId: number;
  stepId?: number;
  stepCode?: string;
  stepOrder?: number;
  jobId?: number | null;
  agentId?: string | null;
  status?: string;
  error?: string;
  durationMs?: number;
}

export interface AssistantUpdateItem {
  id: string;
  kind: 'cycle' | 'system';
  title: string;
  description?: string;
  timestamp: number;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  evidence?: EvidenceItem[];
}

export interface ExecutionPreview extends CopilotActionPreview {
  id: string;
  prompt: string;
}

export interface AssistantFormResponse {
  type: 'assistant_form';
  title?: string;
  description?: string;
  submitLabel?: string;
  schema: FormSchema;
  context?: Record<string, any>;
}

export interface AssistantAppResponse {
  type: 'assistant_app';
  title: string;
  description?: string;
  slug?: string;
  href?: string;
  source?: 'app' | 'agent_ai' | 'blueprint'; // "agent_ai" uses /a/:slug, "app" uses /app/:slug, "blueprint" uses /armory/new?blueprint=:slug
  mode?: 'link' | 'embed';
  actionLabel?: string;
  blueprint?: string;
  cycleSlug?: string;
  cycleName?: string;
  routePath?: string;
  sourceAppId?: string;
  sourceAppName?: string;
}

export interface ModeSwitchRequest {
  type: 'mode_switch_request';
  targetMode?: string;
  reason?: string;
  message?: string;
}

export interface AssistantInstantAppResponse {
  type: 'instant_app';
  module: string;
  componentName?: string;
  title?: string;
  note?: string;
  props?: Record<string, any>;
}

export interface AssistantInstantAppSurfaceResponse {
  type: 'instant_app_surface';
  title?: string;
  note?: string;
  layout?: 'grid' | 'stack';
  blocks: Array<{ module: string; componentName?: string; props?: Record<string, any>; span?: number }>;
}

export interface IntentClarificationResponse {
  type: 'intent_clarification';
  questionId?: string;
  headline?: string;
  question: string;
  options: Array<{ label: string; value: string; prompt: string }>;
  structuredPayload?: any;
}

export type AssistantRichResponse =
  | { type: 'input_request'; data: InputRequest }
  | { type: 'assistant_form'; data: AssistantFormResponse }
  | { type: 'assistant_app'; data: AssistantAppResponse }
  | { type: 'instant_app'; data: AssistantInstantAppResponse }
  | { type: 'instant_app_surface'; data: AssistantInstantAppSurfaceResponse }
  | { type: 'mode_switch_request'; data: ModeSwitchRequest }
  | { type: 'launch_tutorial'; data: { trackId: string; title?: string; description?: string } }
  | { type: 'intent_clarification'; data: IntentClarificationResponse };

export interface PageAction {
  label: string;
  prompt: string;
  mode: ChatMode;
  icon: React.ElementType;
  rationale?: string;
  action?: 'daily_brief' | 'tutorial';
  tutorialId?: string;
}

export interface ModeConfig {
  label: string;
  description: string;
  icon: React.ElementType;
  badgeClass: string;
}

export interface AgentChatSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPrompt?: string;
  initialContext?: Record<string, any> & { assistantView?: 'chat' | 'approvals' | 'updates' | 'inbox' | 'missions' };
  assistRequestId?: number;
}

export type {
  CopilotSubPageContext,
  CopilotSelectedUiContext,
} from './copilot-context-helpers';
