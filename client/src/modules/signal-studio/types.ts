import type { ReactNode } from 'react';
import type { FeedDto } from '@/components/signal-intelligence/spatial/SourcesView';
import type { IntelligenceSignal } from '@/components/signal-intelligence/spatial/utils';
import type { SignalStudioSelection } from '@shared/signal-studio';

export type { SignalStudioSelection };

/** What the pod hands the room when a signal is taken into CREW. */
export interface SignalFocusSelection {
  id: string;
  label: string;
  sublabel?: string;
  type: 'signal';
  /** The event's own fields. Absent when there is no event behind the selection. */
  signal?: SignalStudioSelection;
}

export interface SignalStudioProps {
  organizationId?: number;
  initialView?: 'overview' | 'spatial' | 'signals' | 'sources' | 'rules' | 'filters' | 'packs' | 'backbone' | 'subscriptions' | 'mapper';
  className?: string;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onClose?: () => void;
}

export interface SignalStudioPodProps {
  organizationId?: number;
  initialView?: 'overview' | 'spatial' | 'signals' | 'sources' | 'rules' | 'filters' | 'packs' | 'mapper';
  activeSignalId?: string;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onClose?: () => void;
  onPopOut?: () => void;
  onFocusInChat?: (selection: SignalFocusSelection, promptSuggestion?: string) => void;
  onDiscussInCrew?: (prompt: string, signalContext: Partial<IntelligenceSignal>) => void;
  onLaunchInitiative?: (signalId: string, title: string) => void;
  className?: string;
}

export interface IndustryPackItem {
  name: string;
  sourceType: string;
  url: string;
  expectedSignals: string[];
  recommendedIntervalSeconds: number;
  description: string;
}

export interface IndustryPack {
  id: string;
  name: string;
  targetRole: string;
  badge: string;
  accentColor: string;
  iconName: string;
  description: string;
  businessValue: string;
  feeds: IndustryPackItem[];
  defaultPlaybook: string;
}
