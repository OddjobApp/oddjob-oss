import type { FlowCreateProposal } from '@shared/flow-studio-crew';

export interface FlowStudioSelection {
  id: string;
  label: string;
  sublabel?: string;
  type: 'flow' | 'step' | 'job' | 'guard';
  stepIndex?: number;
  jobId?: number;
  jobName?: string;
  conditionExpression?: string;
}

export interface FlowStudioPodProps {
  flowId?: number;
  proposal?: FlowCreateProposal | null;
  pipelineId?: number | null;
  organizationId?: number | null;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onClose?: () => void;
  onFocusInChat?: (selection: FlowStudioSelection, promptSuggestion?: string) => void;
  onArtifactSubmit?: (message: string) => void;
  className?: string;
}
