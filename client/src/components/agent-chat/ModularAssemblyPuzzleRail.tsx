import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Layers,
  ShieldCheck,
  Zap,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Boxes,
  Calculator,
  Play,
  Search,
  Table2,
  FileText,
  PanelsTopLeft,
  Plug,
  Link2,
  Paperclip,
  Film,
  Eye,
  Database,
  Workflow,
  User,
  X,
  Maximize2,
  Minimize2,
  Bot,
  Sparkles,
  Radio,
  Terminal,
  LayoutTemplate,
  FolderKanban,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AppStudioSelection } from '@shared/app-studio-context';
import type { ScribeSelection } from '@shared/scribe-context';
import { ScribeStudioPod } from '@/modules/scribe/ScribeStudioPod';
import AppStudioPod from '@/modules/apps/AppStudioPod';
import FormStudioPod from '@/modules/forms/FormStudioPod';
import { MediaStudio } from '@/modules/media/MediaStudio';
import { AgentStudio } from '@/modules/agents/AgentStudio';
import ProjectStudio from '@/modules/project-studio/ProjectStudio';
import ComputerUseStudio from '@/modules/computer-studio/ComputerUseStudio';
import { SignalStudioPod } from '@/modules/signal-studio/SignalStudioPod';
import { FlowStudioPod } from '@/modules/flows/FlowStudioPod';
import { PredictionStudioPod } from '@/modules/prediction-studio/PredictionStudioPod';
import { MediaStageCanvas } from '@/modules/media/components/MediaStageCanvas';
import { MEDIA_ASPECT_RATIOS, type MediaAspectRatio, type MediaShot, type MediaShotTake } from '@/modules/media/types';
import type { FormStudioSelection } from '@shared/form-studio';
import type { MediaStudioSelection } from '@shared/media-studio';
import type { SignalStudioSelection } from '@shared/signal-studio';
import { FORM_STUDIO_POD } from '@shared/form-studio-crew';
import { FLOW_STUDIO_POD } from '@shared/flow-studio-crew';
import { PREDICTION_STUDIO_POD } from '@shared/prediction-studio-crew';

/**
 * Only what the rail actually reads off a turn.
 *
 * This imported `CrewTurn` from `@shared/schema`, which exports no such type —
 * the schema exports `CrewTurnRecord`, and the panel that renders this rail
 * declares its own local `CrewTurn`. The import had never type-checked. A
 * structural type keeps the rail decoupled from whichever of those the caller
 * holds, and still constrains what it may reach for.
 */
export interface AssemblyTurn {
  artifacts?: Array<{ tool?: string | null; payload?: Record<string, any> | null }> | null;
  /** Callers pass whole turns; everything else on them is none of the rail's business. */
  [key: string]: any;
}

/**
 * One property of an assembly unit, as shown when that unit holds the context.
 *
 * `isModifier` marks the entries that CHANGE behaviour rather than describe
 * shape — a computed field's formula, a step's condition, the tool a step
 * dispatches. Those were the parts with no representation anywhere in the UI:
 * a step that only runs when guest count > 2 looked exactly like one that always
 * runs, so the rule was invisible in the very surface used to edit it.
 */
export interface AssemblyUnitProperty {
  label: string;
  value: string;
  isModifier?: boolean;
}

export interface WorkstreamAgent {
  name: string;
  role?: string;
  avatar?: string;
  assignedStep?: string;
}

export interface WorkstreamJobStep {
  name: string;
  jobType: string;
  agent?: string;
  toolName?: string;
  isConditional?: boolean;
  condition?: string;
}

export interface WorkstreamDecision {
  type: 'cel' | 'formula' | 'hil_gate' | 'policy' | 'routing';
  label: string;
  expression: string;
  target?: string;
}

export interface PuzzlePiece {
  id: string;
  layerIndex: number;
  label: string;
  sublabel: string;
  properties: AssemblyUnitProperty[];
  type: 'ui' | 'pipeline' | 'dataset' | 'project' | 'query' | 'result' | 'report' | 'document' | 'ontology' | 'adapter' | 'attachment' | 'signal' | 'flow' | 'prediction';
  semanticRole?: 'input' | 'execution' | 'persistence' | 'scope' | 'governance' | 'observability' | 'evidence' | 'deployment' | 'reference';
  ontologyRef?: { objectType: string; objectId: string | number };
  agents?: WorkstreamAgent[];
  jobSteps?: WorkstreamJobStep[];
  decisions?: WorkstreamDecision[];
  metricsSummary?: {
    stepsCount?: number;
    agentsCount?: number;
    decisionsCount?: number;
    status?: string;
  };
  color: {
    border: string;
    bg: string;
    text: string;
    glow: string;
    badge: string;
  };
  icon: React.ReactNode;
  metrics: string;
  details: string[];
  isLocked: boolean;
  /** Transcript turn this piece was produced in. 99999 marks a synthetic piece. */
  turnIndex?: number;
}

/**
 * The assembly unit a message will be applied to, published for the composer.
 *
 * `type` rather than a Tailwind class: the rail owns how a layer looks, the
 * composer owns how its own border looks, and passing class strings across that
 * boundary would couple them.
 */
export interface AssemblyUnitSelection {
  id: string;
  label: string;
  /** The unit's properties, shown in the dialogue while it holds the context. */
  properties?: AssemblyUnitProperty[];
  /** Agents actively assigned or involved in this workstream unit. */
  agents?: WorkstreamAgent[];
  /** Execution steps and job types for pipeline workstreams. */
  jobSteps?: WorkstreamJobStep[];
  /** Decisions, CEL conditions, formulas, or governance rules applied. */
  decisions?: WorkstreamDecision[];
  /** High-level metrics for quick summary pills. */
  metricsSummary?: {
    stepsCount?: number;
    agentsCount?: number;
    decisionsCount?: number;
    status?: string;
  };
  /**
   * What this layer currently *is* — the app name, the table, the execution
   * target. Carried so a scoped request can name the concrete thing it edits
   * ("add a decision node to the Mortgage Calculator Execution pipeline")
   * rather than the rail's ordinal label.
   */
  sublabel?: string;
  type: 'ui' | 'pipeline' | 'dataset' | 'project' | 'query' | 'result' | 'report' | 'document' | 'ontology' | 'adapter' | 'attachment' | 'app' | 'scribe' | 'form' | 'media' | 'agent' | 'flow' | 'signal' | 'prediction';
  semanticRole?: PuzzlePiece['semanticRole'];
  ontologyRef?: PuzzlePiece['ontologyRef'];
  /**
   * Set when the selection is an App Studio file/component rather than a rail
   * piece. The composer prefixes the next message with it so a scoped request
   * names the concrete thing it edits.
   */
  appStudio?: AppStudioSelection;
  /**
   * Set when the selection is a Scribe excerpt, station, or annotation.
   */
  scribe?: ScribeSelection;
  /**
   * Set when the selection is a Form Studio unit: a page, field, rule, result or stage.
   */
  formStudio?: FormStudioSelection;
  /**
   * Set when the selection is something picked in Media Studio: a scene, plot point, shot, take or reel.
   */
  mediaStudio?: MediaStudioSelection;
  /**
   * Set when the selection is a Signal Studio event, with the event's own fields.
   */
  signal?: SignalStudioSelection;
}

/**
 * Selection id for an App Studio unit.
 *
 * The app id is embedded because the "drop a stale studio selection" effect
 * parses it back out to decide whether a selection belongs to the app that is
 * currently mounted. Producer and parser have to agree, so both go through
 * this one function.
 */
function appStudioSelectionId(selection: AppStudioSelection): string {
  const leaf = selection.filePath ?? selection.componentId ?? selection.label;
  return `app-studio:${selection.appId}:${selection.kind}:${leaf}`;
}

/**
 * Selection id for a Scribe unit.
 */
function scribeSelectionId(selection: ScribeSelection): string {
  const leaf = selection.annotationId ? `ann:${selection.annotationId}` : (selection.nodeId ? `node:${selection.nodeId}` : (selection.stationKey ?? 'doc'));
  return `scribe:${selection.documentId ?? 'current'}:${leaf}`;
}

/** Selection id for a Form Studio unit, with the form id embedded as the App Studio's has the app id. */
function formStudioSelectionId(selection: FormStudioSelection): string {
  return `form-studio:${selection.formId}:${selection.kind}:${selection.key}`;
}

/** Selection id for a Media Studio unit, with the production id embedded for the same reason. */
function mediaStudioSelectionId(selection: MediaStudioSelection): string {
  return `media-studio:${selection.productionId}:${selection.kind}:${selection.id}`;
}

interface ModularAssemblyPuzzleRailProps {
  showEmpty?: boolean;
  manuscriptRailTarget?: HTMLElement | null;
  turns: AssemblyTurn[];
  sessionId?: number;
  /** Room key (URL segment). The numeric sessionId does not address /api/crew/:sessionKey. */
  roomKey?: string;
  organizationId?: number | null;
  /** Files attached to this room, shown as evidence pieces in the stack. */
  attachments?: Array<Record<string, any>>;
  /** Fires with the selected layer, or null when selection is cleared. */
  onSelectionChange?: (selection: AssemblyUnitSelection | null, promptSuggestion?: string) => void;
  /**
   * Reveal the transcript turn a piece came from, so clicking a piece can
   * scroll the dialogue to where it was produced.
   */
  onShowTurn?: (turnId: number | string) => void;
  /**
   * Selected piece id when the parent owns the selection. Pass this whenever the
   * selection is also shown elsewhere (the composer target chip) — otherwise the
   * two drift: clearing the chip would leave the piece highlighted here.
   */
  selectedId?: string | null;
  isChatCollapsed?: boolean;
  onToggleChatCollapse?: () => void;
  onExpandChat?: () => void;
  isScribeVisible?: boolean;
  onExitScribe?: () => void;
  isAppStudioVisible?: boolean;
  onExitAppStudio?: () => void;
  isAgentStudioVisible?: boolean;
  onExitAgentStudio?: () => void;
  isFormStudioVisible?: boolean;
  selectedFormId?: number | null;
  openMediaStudio?: boolean;
  onMediaProductionChange?: (id: number | null) => void;
  onExitFormStudio?: () => void;
  isMediaStudioVisible?: boolean;
  onExitMediaStudio?: () => void;
  openProjectStudio?: boolean;
  isProjectStudioVisible?: boolean;
  onExitProjectStudio?: () => void;
  openComputerStudio?: boolean;
  isComputerStudioVisible?: boolean;
  onExitComputerStudio?: () => void;
  openSignalStudio?: boolean;
  isSignalStudioVisible?: boolean;
  onExitSignalStudio?: () => void;
  isFlowStudioVisible?: boolean;
  onExitFlowStudio?: () => void;
  isPredictionStudioVisible?: boolean;
  onExitPredictionStudio?: () => void;
  onActiveStudioChange?: (kind: string | null) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}

export const ModularAssemblyPuzzleRail: React.FC<ModularAssemblyPuzzleRailProps> = ({
  showEmpty = false,
  turns,
  sessionId,
  roomKey,
  organizationId,
  attachments,
  onSelectionChange,
  onShowTurn,
  selectedId,
  isChatCollapsed,
  onToggleChatCollapse,
  onExpandChat,
  isScribeVisible = true,
  onExitScribe,
  manuscriptRailTarget,
  isAppStudioVisible = true,
  onExitAppStudio,
  isAgentStudioVisible = true,
  onExitAgentStudio,
  isFormStudioVisible = true,
  selectedFormId,
  openMediaStudio = false,
  onMediaProductionChange,
  onExitFormStudio,
  isMediaStudioVisible = true,
  onExitMediaStudio,
  openProjectStudio = false,
  isProjectStudioVisible: isProjectStudioVisibleProp = true,
  onExitProjectStudio,
  openComputerStudio = false,
  isComputerStudioVisible: isComputerStudioVisibleProp = true,
  onExitComputerStudio,
  openSignalStudio = false,
  isSignalStudioVisible: isSignalStudioVisibleProp = true,
  onExitSignalStudio,
  isFlowStudioVisible: isFlowStudioVisibleProp = true,
  onExitFlowStudio,
  isPredictionStudioVisible: isPredictionStudioVisibleProp = true,
  onExitPredictionStudio,
  onActiveStudioChange,
  isCollapsed: isCollapsedProp,
  onToggleCollapse,
  className,
}) => {
  const [internalIsPredictionStudioVisible, setInternalIsPredictionStudioVisible] = useState(true);
  const isPredictionStudioVisible = isPredictionStudioVisibleProp && internalIsPredictionStudioVisible;
  const [internalIsFlowStudioVisible, setInternalIsFlowStudioVisible] = useState(true);
  const isFlowStudioVisible = isFlowStudioVisibleProp && internalIsFlowStudioVisible;
  const [internalIsSignalStudioVisible, setInternalIsSignalStudioVisible] = useState(true);
  const isSignalStudioVisible = isSignalStudioVisibleProp && internalIsSignalStudioVisible;
  const [internalIsProjectStudioVisible, setInternalIsProjectStudioVisible] = useState(true);
  const isProjectStudioVisible = isProjectStudioVisibleProp && internalIsProjectStudioVisible;
  const [internalIsComputerStudioVisible, setInternalIsComputerStudioVisible] = useState(true);
  const isComputerStudioVisible = isComputerStudioVisibleProp && internalIsComputerStudioVisible;
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(false);
  const isCollapsed = isCollapsedProp !== undefined ? isCollapsedProp : internalIsCollapsed;
  const handleToggleCollapse = () => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalIsCollapsed((prev) => !prev);
    }
  };
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const isControlled = selectedId !== undefined;
  const selectedPieceId = isControlled ? selectedId : internalSelectedId;
  const [isApprovalDocked, setIsApprovalDocked] = useState<boolean>(false);
  
  // Media Studio canvas state
  const [mediaCanvasVisible, setMediaCanvasVisible] = useState(false);
  const [mediaActiveShot, setMediaActiveShot] = useState<MediaShot | null>(null);
  const [mediaActiveTake, setMediaActiveTake] = useState<MediaShotTake | null>(null);
  const [mediaCompareTake, setMediaCompareTake] = useState<MediaShotTake | null>(null);
  const [mediaIsPlaying, setMediaIsPlaying] = useState(false);
  const [mediaCurrentTime, setMediaCurrentTime] = useState(0);
  const [mediaProductionId, setMediaProductionId] = useState<number | null>(null);

  // Extract Scribe Studio state from artifacts
  const scribeState = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      const artifacts = turn.artifacts ?? [];
      for (const art of artifacts) {
        const p = art.payload ?? {};
        if (
          art.tool === 'mount_scribe_studio' ||
          p.type === 'scribe_foundry_pod' ||
          p.module === 'ScribeStudioPod' ||
          p.component === 'ScribeStudioPod'
        ) {
          return {
            turnIndex: i,
            documentId: p.documentId as number | undefined,
            title: (p.title as string) || 'Manuscript',
            archetypeMode: (p.archetypeMode as string) || 'freeform',
          };
        }
      }
    }
    return null;
  }, [turns]);

  // Extract Project Studio state from artifacts
  const projectStudioState = useMemo(() => {
    if (openProjectStudio) {
      return {
        turnIndex: Infinity,
        stageId: undefined,
        title: "Project Studio",
        projectTitle: "Operational Cycle Planner",
        objective: undefined,
        waves: undefined,
        defaultWaves: undefined,
        defaultBudgetLimitUsd: undefined,
        defaultTokenLimit: undefined,
        defaultTargetSlaDays: undefined,
        defaultMaxParallelMissions: undefined,
      };
    }
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      const artifacts = turn.artifacts ?? [];
      for (const art of artifacts) {
        const p = art.payload ?? {};
        if (
          art.tool === 'mount_project_studio' ||
          p.type === 'project_studio_pod' ||
          p.module === 'ProjectStudioPod' ||
          p.component === 'ProjectStudioPod' ||
          p.podComponent === 'ProjectStudioPod' ||
          ((art.tool === 'mount_builder_pod' || p.type === 'builder_pod' || p.type === 'assistant_app') &&
            (p.podComponent === 'ProjectPlanningPod' || p.podComponent === 'ProjectStudioPod' || p.component === 'ProjectStudioPod' || p.module === 'ProjectStudioPod'))
        ) {
          const props = p.props && typeof p.props === 'object' ? p.props as Record<string, any> : {};
          const numberProp = (key: string) => {
            const value = p[key] ?? props[key];
            return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
          };
          return {
            turnIndex: i,
            stageId: (p.stageId as string) || (props.stageId as string) || undefined,
            title: (p.title as string) || (props.title as string) || 'Project Studio',
            projectTitle: (p.projectTitle as string) || (props.projectTitle as string) || 'Operational Cycle Planner',
            objective: (p.objective as string) || (props.objective as string) || undefined,
            waves: Array.isArray(p.waves) ? p.waves : Array.isArray(props.waves) ? props.waves : undefined,
            // A tool mount that names no plan starts EMPTY. Falling through to the
            // studio's built-in example meant a Save filed a demo cycle.
            defaultWaves: Array.isArray(p.defaultWaves) ? p.defaultWaves
              : Array.isArray(props.defaultWaves) ? props.defaultWaves
              : (art.tool === 'mount_project_studio' || p.type === 'project_studio_pod') ? []
              : undefined,
            cycleId: numberProp('cycleId'),
            defaultBudgetLimitUsd: numberProp('defaultBudgetLimitUsd'),
            defaultTokenLimit: numberProp('defaultTokenLimit'),
            defaultTargetSlaDays: numberProp('defaultTargetSlaDays'),
            defaultMaxParallelMissions: numberProp('defaultMaxParallelMissions'),
          };
        }
      }
    }
    // Fallback: Check if URL query explicitly requests Project Studio
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const studioParam = sp.get('studio') || sp.get('mount');
      if (studioParam === 'project' || studioParam === 'project-studio') {
        return {
          turnIndex: Infinity,
          stageId: undefined,
          title: sp.get('title') || 'Project Studio',
          projectTitle: sp.get('projectTitle') || 'Operational Cycle Planner',
          objective: undefined,
          waves: undefined,
          defaultWaves: undefined,
          defaultBudgetLimitUsd: undefined,
          defaultTokenLimit: undefined,
          defaultTargetSlaDays: undefined,
          defaultMaxParallelMissions: undefined,
        };
      }
    }
    return null;
  }, [turns, openProjectStudio]);

  // Extract Computer Use Studio state from artifacts
  const computerUseState = useMemo(() => {
    if (openComputerStudio) {
      return {
        turnIndex: Infinity,
        // No desktop named: the studio shows its own session picker. It used to be
        // handed "cua-session-live-01", the showcase's imaginary session, which the
        // studio now actually queries - and the failure surfaced as a raw SQL error.
        sessionId: undefined,
        title: "Computer Use Studio",
        initialGoal: undefined,
        initialTeaching: false,
      };
    }
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      const artifacts = turn.artifacts ?? [];
      for (const art of artifacts) {
        const p = art.payload ?? {};
        if (
          art.tool === 'mount_computer_studio' ||
          p.type === 'computer_use_studio_pod' ||
          p.module === 'ComputerUseStudioPod' ||
          p.component === 'ComputerUseStudioPod' ||
          p.podComponent === 'ComputerUseStudioPod' ||
          ((art.tool === 'mount_builder_pod' || p.type === 'builder_pod' || p.type === 'assistant_app') &&
            (p.podComponent === 'ComputerUseStudioPod' || p.component === 'ComputerUseStudioPod' || p.module === 'ComputerUseStudioPod'))
        ) {
          return {
            turnIndex: i,
            sessionId: (p.sessionId as string) || (p.props?.sessionId as string) || undefined,
            title: (p.title as string) || 'Computer Use Studio',
            initialGoal: (p.goal as string) || (p.props?.goal as string) || undefined,
            initialTeaching: p.props?.initialTeaching === true,
          };
        }
      }
    }
    // Fallback: Check if URL query explicitly requests Computer Use Studio
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const studioParam = sp.get('studio') || sp.get('mount');
      if (studioParam === 'computer' || studioParam === 'computer-use' || studioParam === 'desktop') {
        return {
          turnIndex: Infinity,
          sessionId: sp.get('sessionId') || undefined,
          title: sp.get('title') || 'Computer Use Studio',
          initialGoal: sp.get('goal') || undefined,
          initialTeaching: sp.get('teach') === '1',
        };
      }
    }
    return null;
  }, [turns, openComputerStudio]);

  // Extract Signal Studio state from artifacts
  const signalStudioState = useMemo(() => {
    if (openSignalStudio) {
      return {
        turnIndex: Infinity,
        title: "Signal Studio",
        view: "dashboard",
        activeSignalId: undefined,
      };
    }
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      const artifacts = turn.artifacts ?? [];
      for (const art of artifacts) {
        const p = art.payload ?? {};
        if (
          art.tool === 'mount_signal_studio' ||
          p.type === 'signal_studio_pod' ||
          p.module === 'SignalStudioPod' ||
          p.component === 'SignalStudioPod' ||
          p.podComponent === 'SignalStudioPod' ||
          ((art.tool === 'render_app_surface' || art.tool === 'mount_builder_pod' || p.type === 'builder_pod' || p.type === 'assistant_app') &&
            (p.podComponent === 'SignalStudioPod' ||
             p.component === 'SignalStudioPod' ||
             p.module === 'SignalStudioPod' ||
             (typeof p.title === 'string' && /signal|spatial/i.test(p.title)) ||
             (typeof p.href === 'string' && /(?:signal|spatial)/i.test(p.href))))
        ) {
          const props = p.props && typeof p.props === 'object' ? p.props as Record<string, any> : {};
          return {
            turnIndex: i,
            title: (p.title as string) || (props.title as string) || 'Signal Studio',
            view: (p.view as string) || (props.view as string) || 'dashboard',
            activeSignalId: (p.activeSignalId as string) || (props.activeSignalId as string) || undefined,
          };
        }
      }
    }
    // Fallback: Check if URL query explicitly requests Signal Studio
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const studioParam = sp.get('studio') || sp.get('mount');
      if (studioParam === 'signal' || studioParam === 'signals' || studioParam === 'spatial') {
        return {
          turnIndex: Infinity,
          title: sp.get('title') || 'Signal Studio',
          view: sp.get('view') || 'dashboard',
          activeSignalId: sp.get('signalId') || undefined,
        };
      }
    }
    return null;
  }, [turns, openSignalStudio]);

  // The Form Studio mount: the latest form_studio_pod artifact. A drafted change is
  // a card in the conversation and leaves the studio alone; an applied change posts
  // a new pod, whose key remounts the studio on the saved revision.
  // The Agent Studio mount: the latest agent_studio_pod artifact. Applying a drafted
  // agent posts one, so approving a card opens the studio on what was just created.
  const agentStudioState = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const p = (artifacts[j]?.payload ?? {}) as Record<string, any>;
        if (p.type !== 'agent_studio_pod') continue;
        const props = (p.props ?? {}) as Record<string, any>;
        return {
          turnIndex: i,
          mountKey: `${turns[i].id ?? i}:${j}:${props.agentId ?? 'new'}`,
          agentId: typeof props.agentId === 'number' ? props.agentId : undefined,
          view: props.view as React.ComponentProps<typeof AgentStudio>['view'],
        };
      }
    }
    return null;
  }, [turns]);

  const formStudioState = useMemo(() => {
    if (selectedFormId) return { turnIndex: Infinity, mountKey: `selected:${selectedFormId}`, formId: selectedFormId, view: undefined };
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const p = artifacts[j]?.payload ?? {};
        if (p.type === FORM_STUDIO_POD && typeof p.formId === 'number') {
          return {
            turnIndex: i,
            mountKey: `${turns[i].id ?? i}:${j}:${p.formId}`,
            formId: p.formId as number,
            view: p.view as React.ComponentProps<typeof FormStudioPod>['view'],
          };
        }
      }
    }
    return null;
  }, [turns, selectedFormId]);

  const flowStudioState = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const art = artifacts[j];
        const p = art?.payload ?? {};
        if (
          art?.tool === 'mount_flow_studio' ||
          p.type === FLOW_STUDIO_POD ||
          p.type === 'flow_studio_pod' ||
          p.module === 'FlowStudioPod' ||
          p.component === 'FlowStudioPod' ||
          p.podComponent === 'FlowStudioPod' ||
          p.type === 'flow_create_proposal'
        ) {
          const props = p.props && typeof p.props === 'object' ? p.props as Record<string, any> : {};
          return {
            turnIndex: i,
            proposal: (p.proposal as any) || (p.type === 'flow_create_proposal' ? p : undefined),
            pipelineId: (p.pipelineId as number) || (props.pipelineId as number) || undefined,
            flowId: (p.flowId as number) || (props.flowId as number) || undefined,
            name: (p.name as string) || (props.name as string) || 'Flow Studio',
          };
        }
      }
    }
    // Fallback: Check if URL query explicitly requests Flow Studio
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const studioParam = sp.get('studio') || sp.get('mount');
      if (studioParam === 'flow' || studioParam === 'flows' || studioParam === 'pipeline') {
        return {
          turnIndex: Infinity,
          proposal: undefined,
          pipelineId: sp.get('pipelineId') ? Number(sp.get('pipelineId')) : undefined,
          flowId: sp.get('flowId') ? Number(sp.get('flowId')) : undefined,
          name: 'Flow Studio',
        };
      }
    }
    return null;
  }, [turns]);

  const predictionStudioState = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const art = artifacts[j];
        const p = art?.payload ?? {};
        if (
          art?.tool === 'mount_prediction_studio' ||
          p.type === PREDICTION_STUDIO_POD ||
          p.type === 'prediction_studio_pod' ||
          p.module === 'PredictionStudioPod' ||
          p.component === 'PredictionStudioPod' ||
          p.podComponent === 'PredictionStudioPod'
        ) {
          const props = p.props && typeof p.props === 'object' ? p.props as Record<string, any> : {};
          return {
            turnIndex: i,
            modelId: (p.modelId as string) || (props.modelId as string) || undefined,
            modelName: (p.modelName as string) || (props.modelName as string) || (p.title as string) || 'Prediction Studio',
            streamId: (p.streamId as string) || (props.streamId as string) || undefined,
          };
        }
      }
    }
    // Fallback: Check if URL query explicitly requests Prediction Studio
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const studioParam = sp.get('studio') || sp.get('mount');
      if (studioParam === 'prediction' || studioParam === 'predictions' || studioParam === 'infer') {
        return {
          turnIndex: Infinity,
          modelId: sp.get('modelId') || undefined,
          modelName: sp.get('title') || 'Prediction Studio',
          streamId: sp.get('streamId') || undefined,
        };
      }
    }
    return null;
  }, [turns]);

  // The Media Studio mount: the latest media_studio_pod artifact. A markdown
  // Dailies deck is not a mount, and nothing about budget or shots is read from
  // the payload: the studio shows only shots that exist.
  const mediaStudioState = useMemo(() => {
    if (openMediaStudio) return { turnIndex: Infinity, sceneId: 'SCENE-01', sceneTitle: '', aspectRatio: '16:9' as MediaAspectRatio, productionId: undefined };
    for (let i = turns.length - 1; i >= 0; i--) {
      for (const art of turns[i].artifacts ?? []) {
        const p = art.payload ?? {};
        if (
          art.tool === 'mount_media_studio' ||
          p.type === 'media_studio_pod'
        ) {
          return {
            turnIndex: i,
            sceneId: typeof p.sceneId === 'string' && p.sceneId ? p.sceneId : 'SCENE-01',
            sceneTitle: typeof p.sceneTitle === 'string' && p.sceneTitle ? p.sceneTitle : 'Untitled scene',
            aspectRatio: (MEDIA_ASPECT_RATIOS as readonly string[]).includes(p.aspectRatio as string)
              ? (p.aspectRatio as MediaAspectRatio)
              : '16:9',
            // Named when the room applied a change to a production.
            productionId: typeof p.productionId === 'number' ? p.productionId : undefined,
          };
        }
      }
    }
    return null;
  }, [turns, openMediaStudio]);

  // Extract App Studio state (App Forge / App Builder) from artifacts.
  const appStudioState = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      const artifacts = turn.artifacts ?? [];
      for (const art of artifacts) {
        const p = art.payload ?? {};
        if (
          art.tool === 'mount_app_studio' ||
          p.type === 'app_studio_pod' ||
          p.module === 'AppStudioPod' ||
          p.component === 'AppStudioPod'
        ) {
          return {
            turnIndex: i,
            mode: (p.mode as 'forge' | 'builder') || 'builder',
            view: (p.view as 'preview' | 'api' | 'diagnostics' | 'publish') || 'preview',
            appId: p.appId as number | undefined,
            appName: p.appName as string | undefined,
            appSlug: p.appSlug as string | undefined,
            publicSlug: (p.publicSlug as string | null) ?? null,
            status: (p.status as string | null) ?? null,
            jobId: (p.jobId as string | null) ?? null,
            jobStatus: (p.jobStatus as string | null) ?? null,
            title: (p.title as string) || 'New Application',
            requirements: (p.requirements as string | null) ?? null,
            lastChange: (p.lastChange as any) ?? null,
          };
        }
      }
    }
    // Fallback: Check if URL query explicitly requests App Studio (Forge or Builder)
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const studioParam = sp.get('studio') || sp.get('mount');
      if (studioParam === 'builder' || (sp.get('appId') && studioParam !== 'forge')) {
        const appIdParam = sp.get('appId');
        const parsedAppId = appIdParam ? parseInt(appIdParam, 10) : undefined;
        return {
          turnIndex: 99999,
          mode: 'builder' as const,
          view: (sp.get('view') as any) || 'preview',
          appId: parsedAppId,
          appName: sp.get('appName') || undefined,
          appSlug: sp.get('appSlug') || undefined,
          publicSlug: sp.get('publicSlug') || null,
          status: 'active',
          jobId: null,
          jobStatus: null,
          title: sp.get('title') || 'App Studio',
          requirements: sp.get('requirements') || null,
          lastChange: null,
        };
      }
      if (studioParam === 'forge') {
        return {
          turnIndex: 99999,
          mode: 'forge' as const,
          view: 'preview' as const,
          appId: undefined,
          appName: undefined,
          appSlug: undefined,
          publicSlug: null,
          status: null,
          jobId: null,
          jobStatus: null,
          title: sp.get('title') || 'New Application',
          requirements: sp.get('requirements') || null,
          lastChange: null,
        };
      }
    }
    return null;
  }, [turns]);

  const ontologyPieces: PuzzlePiece[] = useMemo(() => {
    const found: PuzzlePiece[] = [];
    const seen = new Set<string>();
    for (let turnIndex = turns.length - 1; turnIndex >= 0 && found.length < 8; turnIndex--) {
      for (const artifact of [...(turns[turnIndex].artifacts ?? [])].reverse()) {
        const payload = artifact.payload ?? {};
        if (!String(payload.type ?? '').startsWith('ontology_')) continue;
        const raw = payload.data;
        const objects = payload.type === 'ontology_traversal'
          ? (raw?.objects ?? [])
          : payload.type === 'ontology_object'
          ? [raw]
          : payload.type === 'ontology_objects'
          ? (Array.isArray(raw) ? raw : [])
          : [];
        for (const object of objects) {
          if (!object || object.id == null) continue;
          const objectType = String(object.objectType || object.type || raw?.link?.targetType || 'Ontology Object');
          const id = String(object.id);
          const key = `${objectType}:${id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const title = String(object.name || object.title || object.label || `${objectType} ${id}`);
          const role: PuzzlePiece['semanticRole'] = /approval|policy/i.test(objectType) ? 'governance'
            : /alert/i.test(objectType) ? 'observability'
            : /signal|knowledge/i.test(objectType) ? 'evidence'
            : /deployment/i.test(objectType) ? 'deployment'
            : /run|mission|pipeline|job/i.test(objectType) ? 'execution'
            : 'reference';
          const properties = Object.entries(object)
            .filter(([name, value]) => !['id', 'name', 'title', 'label'].includes(name) && value != null && typeof value !== 'object')
            .slice(0, 8)
            .map(([label, value]) => ({ label, value: String(value) }));
          found.push({
            id: `ontology-${encodeURIComponent(objectType)}-${encodeURIComponent(id)}`,
            layerIndex: 5 + found.length,
            label: objectType,
            sublabel: title,
            type: 'ontology',
            semanticRole: role,
            ontologyRef: { objectType, objectId: object.id },
            properties,
            metricsSummary: { status: role },
            color: {
              border: 'border-amber-500/50 hover:border-amber-400',
              bg: 'from-amber-950/35 to-amber-900/10',
              text: 'text-amber-400',
              glow: 'shadow-amber-500/10',
              badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
            },
            icon: <Boxes className="h-4 w-4" />,
            metrics: role,
            details: properties.length ? properties.slice(0, 4).map((p) => `${p.label}: ${p.value}`) : [`ID: ${id}`],
            isLocked: true,
          });
        }
      }
    }
    return found;
  }, [turns]);

  /**
   * Query-driven reports are an assembly too. Their artifacts already contain
   * the result table and document AST, but neither was admitted to this rail,
   * so the source query disappeared the moment it became a report. Preserve
   * the four honest stages without inventing a pipeline or dataset.
   */
  const reportPieces: PuzzlePiece[] = useMemo(() => {
    let queryArtifact: Record<string, any> | null = null;
    let documentArtifact: Record<string, any> | null = null;

    for (const turn of turns) {
      for (const artifact of turn.artifacts ?? []) {
        const payload = artifact.payload ?? {};
        if (payload.type === 'assistant_table' && (payload.queryId != null || payload.queryDefinition)) {
          queryArtifact = payload;
        }
        if (payload.type === 'presentation_deck' && payload.formatCategory) {
          documentArtifact = payload;
        }
      }
    }

    const result: PuzzlePiece[] = [];
    const queryLineage = documentArtifact?.lineage?.source;
    const queryName = String(queryArtifact?.title || queryLineage?.name || 'Saved Query');
    const queryId = queryArtifact?.queryId ?? queryLineage?.id ?? null;

    if (queryArtifact || queryLineage) {
      const definition = queryArtifact?.queryDefinition ?? {};
      const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
      const edges = Array.isArray(definition.edges)
        ? definition.edges
        : Array.isArray(definition.relationships) ? definition.relationships : [];
      const nodeLabels = nodes.map((node: any) => node.label || node.type || node.id).filter(Boolean);
      result.push({
        id: `report-query-${queryId ?? encodeURIComponent(queryName)}`,
        layerIndex: 1,
        label: 'Query Source',
        sublabel: queryName,
        type: 'query',
        semanticRole: 'input',
        properties: [
          { label: 'Saved Query ID', value: queryId == null ? 'Unrecorded' : String(queryId) },
          { label: 'Node Patterns', value: String(nodes.length) },
          { label: 'Relationships', value: String(edges.length) },
          ...(nodeLabels.length ? [{ label: 'Objects', value: nodeLabels.join(', ') }] : []),
        ],
        metricsSummary: { stepsCount: nodes.length + edges.length, status: 'Executable Query' },
        color: {
          border: 'border-sky-500/50 hover:border-sky-400', bg: 'from-sky-950/40 to-sky-900/10',
          text: 'text-sky-400', glow: 'shadow-sky-500/10', badge: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
        },
        icon: <Search className="h-4 w-4" />,
        metrics: `${nodes.length} Patterns · ${edges.length} Links`,
        details: [
          `Query: ${queryName}`,
          queryId == null ? 'Query ID: unrecorded' : `Query ID: ${queryId}`,
          ...(nodeLabels.length ? [`Objects: ${nodeLabels.join(', ')}`] : []),
        ],
        isLocked: true,
      });
    }

    if (queryArtifact) {
      const columns = Array.isArray(queryArtifact.columns) ? queryArtifact.columns : [];
      const rows = Array.isArray(queryArtifact.rows) ? queryArtifact.rows : [];
      result.push({
        id: `report-result-${queryId ?? encodeURIComponent(queryName)}`,
        layerIndex: 2,
        label: 'Query Result',
        sublabel: queryArtifact.description || queryName,
        type: 'result',
        semanticRole: 'evidence',
        properties: [
          { label: 'Rows', value: String(rows.length) },
          { label: 'Columns', value: columns.map((column: any) => column.label || column.key).join(', ') || 'None' },
          { label: 'Execution', value: `${queryArtifact.executionTimeMs ?? 0} ms` },
          { label: 'Completeness', value: queryArtifact.truncated ? 'Truncated result' : 'Complete result' },
        ],
        metricsSummary: { stepsCount: rows.length, status: queryArtifact.truncated ? 'Truncated' : 'Complete Snapshot' },
        color: {
          border: 'border-emerald-500/50 hover:border-emerald-400', bg: 'from-emerald-950/40 to-emerald-900/10',
          text: 'text-emerald-400', glow: 'shadow-emerald-500/10', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        },
        icon: <Table2 className="h-4 w-4" />,
        metrics: `${rows.length} Rows · ${columns.length} Columns`,
        details: [
          queryArtifact.truncated ? 'Result is truncated' : 'Complete result snapshot',
          `Executed in ${queryArtifact.executionTimeMs ?? 0} ms`,
          ...columns.map((column: any) => column.label || column.key).filter(Boolean).slice(0, 3),
        ],
        isLocked: true,
      });
    }

    if (documentArtifact) {
      const blocks = Array.isArray(documentArtifact.blocks) ? documentArtifact.blocks : [];
      result.push({
        id: `report-composition-${encodeURIComponent(String(documentArtifact.title || 'report'))}`,
        layerIndex: 3,
        label: 'Report Composition',
        sublabel: String(documentArtifact.title || 'Generated Report'),
        type: 'report',
        semanticRole: 'execution',
        properties: [
          { label: 'Title', value: String(documentArtifact.title || 'Generated Report') },
          { label: 'Structured Blocks', value: String(documentArtifact.blockCount ?? blocks.length) },
          { label: 'Source', value: queryLineage?.name ? `Saved query: ${queryLineage.name}` : 'Conversation content' },
        ],
        metricsSummary: { stepsCount: documentArtifact.blockCount ?? blocks.length, status: 'Composed' },
        color: {
          border: 'border-violet-500/50 hover:border-violet-400', bg: 'from-violet-950/40 to-violet-900/10',
          text: 'text-violet-400', glow: 'shadow-violet-500/10', badge: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
        },
        icon: <PanelsTopLeft className="h-4 w-4" />,
        metrics: `${documentArtifact.blockCount ?? blocks.length} Blocks`,
        details: [
          queryLineage?.name ? `Source query: ${queryLineage.name}` : 'Source: conversation content',
          // executionPhases are objects ({ phase, agentId, agentName, status, summary });
          // `details` is rendered as raw children, so flatten each to a line here.
          ...(Array.isArray(documentArtifact.executionPhases)
            ? documentArtifact.executionPhases.slice(0, 3).map((phase: any) =>
                typeof phase === 'string'
                  ? phase
                  : `${phase?.agentName || phase?.agentId || 'Agent'} — ${
                      phase?.status === 'skipped' ? 'skipped' : phase?.summary || phase?.phase || 'completed'
                    }`)
            : []),
        ],
        isLocked: true,
      });

      const format = String(documentArtifact.formatCategory);
      result.push({
        id: `report-format-${format}`,
        layerIndex: 4,
        label: 'Document Format',
        sublabel: format.replace(/_/g, ' '),
        type: 'document',
        semanticRole: 'deployment',
        properties: [
          { label: 'Format', value: format },
          { label: 'Theme', value: String(documentArtifact.theme || 'Unspecified') },
          { label: 'Human Sign-off', value: documentArtifact.requiresHilSignoff ? 'Required' : 'Not required' },
        ],
        metricsSummary: { decisionsCount: documentArtifact.requiresHilSignoff ? 1 : 0, status: 'Rendered Artifact' },
        color: {
          border: 'border-amber-500/50 hover:border-amber-400', bg: 'from-amber-950/40 to-amber-900/10',
          text: 'text-amber-400', glow: 'shadow-amber-500/10', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        },
        icon: <FileText className="h-4 w-4" />,
        metrics: format.replace(/_/g, ' '),
        details: [
          `Format: ${format}`,
          `Theme: ${documentArtifact.theme || 'Unspecified'}`,
          documentArtifact.requiresHilSignoff ? 'Human sign-off required' : 'No human sign-off required',
        ],
        isLocked: true,
      });
    }

    return result;
  }, [turns]);

  /**
   * What this project is wired into.
   *
   * A room could discuss syncing to a Confluence space or filing a Jira issue
   * with no piece standing for the connection that makes it possible, so the
   * adapter was the one part of the assembly you could not point at. Each
   * adapter becomes a piece; a never-captured schema and a never-run sync are
   * reported as absent rather than as zero, because "0 fields" reads as a
   * measurement and this one was never taken.
   */
  const adapterPieces: PuzzlePiece[] = useMemo(() => {
    let adapters: any[] = [];
    for (const turn of turns) {
      for (const artifact of turn.artifacts ?? []) {
        const payload = artifact.payload ?? {};
        if (payload.type === 'saas_adapters' && Array.isArray(payload.adapters)) {
          adapters = payload.adapters;
        }
      }
    }

    const pieces: PuzzlePiece[] = [];

    // Each bound resource is its own piece: one Confluence connection serving
    // ENG and DOCS is two things the project reaches, not one.
    for (const adapter of adapters) {
      for (const binding of Array.isArray(adapter?.bindings) ? adapter.bindings : []) {
        const kindLabel = binding?.resourceKind === 'confluence_space' ? 'Confluence space' : 'Jira project';
        pieces.push({
          id: `binding-${binding?.id ?? binding?.resourceKey}`,
          layerIndex: 0,
          label: kindLabel,
          sublabel: binding?.resourceName ? `${binding.resourceKey} · ${binding.resourceName}` : String(binding?.resourceKey ?? ''),
          type: 'adapter' as const,
          semanticRole: 'reference' as const,
          properties: [
            { label: 'Key', value: String(binding?.resourceKey ?? '') },
            { label: 'Name', value: String(binding?.resourceName || 'Unnamed') },
            { label: 'Kind', value: kindLabel },
            ...(binding?.resourceType ? [{ label: 'Resource Type', value: String(binding.resourceType) }] : []),
            { label: 'Through', value: String(adapter?.platform ?? 'unknown') },
            { label: 'Bound By', value: String(binding?.boundBy || 'Unrecorded') },
            { label: 'Bound At', value: binding?.boundAt ? new Date(binding.boundAt).toLocaleString() : 'Unrecorded' },
          ],
          metricsSummary: { status: 'Bound' },
          color: {
            border: 'border-orange-500/50 hover:border-orange-400', bg: 'from-orange-950/40 to-orange-900/10',
            text: 'text-orange-400', glow: 'shadow-orange-500/10', badge: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
          },
          icon: <Link2 className="h-4 w-4" />,
          metrics: String(binding?.resourceKey ?? ''),
          details: [
            `${kindLabel}: ${binding?.resourceKey ?? ''}`,
            binding?.resourceName ? `Name: ${binding.resourceName}` : 'No name recorded',
            `Through the ${adapter?.platform ?? 'unknown'} connection`,
          ],
          isLocked: true,
        });
      }
    }

    return [...pieces, ...adapters.map((adapter: any) => {
      const platform = String(adapter?.platform ?? 'unknown');
      const bound = adapter?.boundResource;
      const snapshot = adapter?.schemaSnapshot;
      const sync = adapter?.syncConfig;
      const isProjectOwned = adapter?.scope === 'project';

      return {
        id: `adapter-${adapter?.connectorId ?? platform}`,
        layerIndex: 0,
        label: 'SaaS Adapter',
        sublabel: bound?.value ? `${platform} · ${bound.value}` : platform,
        type: 'adapter' as const,
        semanticRole: 'reference' as const,
        properties: [
          { label: 'Platform', value: platform },
          { label: 'Connection', value: String(adapter?.status ?? 'unknown') },
          { label: 'Scope', value: isProjectOwned ? 'This project' : 'Organization-wide' },
          ...(bound ? [{ label: bound.kind, value: String(bound.value) }] : []),
          { label: 'Sync', value: sync ? (sync.enabled ? `Every ${sync.syncIntervalMinutes} min` : 'Disabled') : 'Not configured' },
          ...(sync ? [{ label: 'Conflict Resolution', value: String(sync.conflictResolution) }] : []),
          { label: 'Last Sync', value: adapter?.lastSync ? new Date(adapter.lastSync).toLocaleString() : 'Never synced' },
          {
            label: 'Schema Snapshot',
            value: snapshot ? `v${snapshot.version} · ${snapshot.fieldCount} fields` : 'No schema captured',
          },
        ],
        metricsSummary: {
          status: adapter?.status === 'connected' ? 'Connected' : String(adapter?.status ?? 'Unknown'),
        },
        color: {
          border: 'border-orange-500/50 hover:border-orange-400', bg: 'from-orange-950/40 to-orange-900/10',
          text: 'text-orange-400', glow: 'shadow-orange-500/10', badge: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
        },
        icon: <Plug className="h-4 w-4" />,
        metrics: isProjectOwned ? 'Project' : 'Org',
        details: [
          `Platform: ${platform}`,
          bound?.value ? `${bound.kind}: ${bound.value}` : 'No resource bound',
          adapter?.lastSync ? `Last sync: ${new Date(adapter.lastSync).toLocaleString()}` : 'Never synced',
          snapshot ? `Schema v${snapshot.version}, ${snapshot.fieldCount} fields` : 'No schema captured',
        ],
        isLocked: true,
      };
    })];
  }, [turns]);

  /**
   * Files brought into the room.
   *
   * An attachment is evidence the discussion rests on, so it belongs in the
   * stack rather than only in the composer — the same reasoning that put Query
   * Source here. Read and searchable are reported separately: a file that could
   * not be parsed must not look empty, and one still being embedded must not
   * look absent.
   */
  const attachmentPieces: PuzzlePiece[] = useMemo(() => {
    return (attachments ?? []).map((file: any) => ({
      id: `attachment-${file.id}`,
      layerIndex: 0,
      label: 'Attached File',
      sublabel: String(file.displayName ?? 'File'),
      type: 'attachment' as const,
      semanticRole: 'evidence' as const,
      properties: [
        { label: 'File', value: String(file.displayName ?? '') },
        { label: 'Kind', value: String(file.parseType ?? 'unknown') },
        {
          label: 'Read',
          value: file.parseStatus === 'parsed'
            ? `${file.textLength ?? 0} characters`
            : String(file.parseStatus ?? 'unknown'),
        },
        {
          label: 'Searchable',
          value: file.indexStatus === 'indexed' ? 'Yes' : String(file.indexStatus ?? 'unknown'),
        },
        { label: 'Uploaded By', value: String(file.uploadedBy || 'Unrecorded') },
      ],
      metricsSummary: { status: file.indexStatus === 'indexed' ? 'Searchable' : String(file.indexStatus ?? '') },
      color: {
        border: 'border-teal-500/50 hover:border-teal-400', bg: 'from-teal-950/40 to-teal-900/10',
        text: 'text-teal-400', glow: 'shadow-teal-500/10', badge: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
      },
      icon: <Paperclip className="h-4 w-4" />,
      metrics: file.parseType ?? 'file',
      details: [
        `Kind: ${file.parseType ?? 'unknown'}`,
        file.parseStatus === 'parsed'
          ? `${file.textLength ?? 0} characters read`
          : `Not read: ${file.parseStatus}`,
        file.indexStatus === 'indexed'
          ? 'Agents can search this file'
          : `Not searchable: ${file.indexStatus}`,
      ],
      isLocked: true,
    }));
  }, [attachments]);

  /*
   * Drop a studio selection when the room mounts a different app.
   *
   * A selection made inside the App Studio names the app it came from
   * (`app-studio:<appId>:...`). Switching the mounted app leaves that id
   * pointing at a surface that is no longer on screen, and the CREW context
   * goes on answering against a file from the previous app.
   */
  useEffect(() => {
    const mountedAppId = appStudioState?.appId;
    if (mountedAppId == null || !selectedPieceId) return;
    const owner = /^app-studio:(\d+):/.exec(selectedPieceId);
    if (!owner || Number(owner[1]) === mountedAppId) return;
    if (!isControlled) setInternalSelectedId(null);
    onSelectionChange?.(null);
  }, [appStudioState?.appId, selectedPieceId, isControlled, onSelectionChange]);

  // The same for a Form Studio selection once the room opens a different form.
  useEffect(() => {
    const mountedFormId = formStudioState?.formId;
    if (mountedFormId == null || !selectedPieceId) return;
    const owner = /^form-studio:(\d+):/.exec(selectedPieceId);
    if (!owner || Number(owner[1]) === mountedFormId) return;
    if (!isControlled) setInternalSelectedId(null);
    onSelectionChange?.(null);
  }, [formStudioState?.formId, selectedPieceId, isControlled, onSelectionChange]);

  // The production the room's mount names, without rendering a studio to learn it.
  // A second <MediaStudio> used to mount inside a `hidden` div purely for this value;
  // display:none stops no query, poll or media element, so an invisible studio kept
  // polling and fetching alongside the visible one.
  useEffect(() => {
    const id = mediaStudioState?.productionId ?? null;
    if (id == null) return;
    setMediaProductionId((prev) => (prev === id ? prev : id));
    onMediaProductionChange?.(id);
  }, [mediaStudioState?.productionId, onMediaProductionChange]);

  // And for a Media Studio selection once the studio shows a different production.
  useEffect(() => {
    if (mediaProductionId == null || !selectedPieceId) return;
    const owner = /^media-studio:(\d+):/.exec(selectedPieceId);
    if (!owner || Number(owner[1]) === mediaProductionId) return;
    if (!isControlled) setInternalSelectedId(null);
    onSelectionChange?.(null);
  }, [mediaProductionId, selectedPieceId, isControlled, onSelectionChange]);

  const mediaPieces: PuzzlePiece[] = useMemo(() => {
    if (!mediaStudioState) return [];
    const sceneId = mediaStudioState.sceneId;
    const sceneTitle = mediaStudioState.sceneTitle || sceneId;
    const aspectRatio = mediaStudioState.aspectRatio || '16:9';

    return [
      // Layer 0: Scribe Script Input
      {
        id: `media-scribe-${sceneId}`,
        layerIndex: 0,
        label: 'Scribe Scene Adapter',
        sublabel: `${sceneId} Script & Dialogue`,
        type: 'document' as const,
        semanticRole: 'reference' as const,
        properties: [
          { label: 'Scene', value: sceneId },
          { label: 'Source', value: 'Scribe Manuscript' },
          { label: 'Audio Stems', value: 'Dialogue Lip-Sync' },
        ],
        metricsSummary: { status: 'Script Ingest' },
        color: {
          border: 'border-emerald-500/50 hover:border-emerald-400',
          bg: 'from-emerald-950/40 to-emerald-900/10',
          text: 'text-emerald-400',
          glow: 'shadow-emerald-500/10',
          badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
        },
        icon: <FileText className="h-4 w-4" />,
        metrics: 'Manuscript',
        details: [
          `Scene: ${sceneId}`,
          `Script slugline and dialogue cues`,
          'Oddjob Scribe Script-to-Screen bridge',
        ],
        isLocked: true,
      },

      // Layer 1: Character & World Continuity
      {
        id: `media-character-${sceneId}`,
        layerIndex: 1,
        label: 'Character Continuity Adapter',
        sublabel: 'Ontology Face & Style Anchor',
        type: 'ontology' as const,
        semanticRole: 'reference' as const,
        properties: [
          { label: 'Character Anchor', value: 'char_elena' },
          { label: 'Embedding', value: 'IP-Adapter FaceID' },
          { label: 'Weight', value: '0.85' },
        ],
        metricsSummary: { status: 'Ontology Anchor' },
        color: {
          border: 'border-amber-500/50 hover:border-amber-400',
          bg: 'from-amber-950/40 to-amber-900/10',
          text: 'text-amber-400',
          glow: 'shadow-amber-500/10',
          badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
        },
        icon: <User className="h-4 w-4" />,
        metrics: 'Ontology',
        details: [
          'Knowledge Graph face reference',
          'IP-Adapter tensor injection',
          'Visual character consistency across takes',
        ],
        isLocked: false,
      },

      // Layer 2: ComfyUI Generative Diffusion Engine
      {
        id: `media-production-${sceneId}`,
        layerIndex: 2,
        label: 'ComfyUI Diffusion Engine',
        sublabel: `${sceneId}${mediaStudioState.sceneTitle ? ` · ${mediaStudioState.sceneTitle}` : ''}`,
        type: 'pipeline' as const,
        semanticRole: 'execution' as const,
        properties: [
          { label: 'Scene', value: sceneId },
          { label: 'Aspect Ratio', value: aspectRatio },
          { label: 'Pipeline Engine', value: 'ComfyUI DAG' },
          ...(mediaStudioState.productionId ? [{ label: 'Production ID', value: String(mediaStudioState.productionId) }] : []),
        ],
        metricsSummary: { status: 'Media Pipeline' },
        color: {
          border: 'border-fuchsia-500/50 hover:border-fuchsia-400',
          bg: 'from-fuchsia-950/40 to-fuchsia-900/10',
          text: 'text-fuchsia-400',
          glow: 'shadow-fuchsia-500/10',
          badge: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30',
        },
        icon: <Film className="h-4 w-4" />,
        metrics: `${aspectRatio} · ComfyUI`,
        details: [
          `Scene: ${sceneId}`,
          `Aspect: ${aspectRatio}`,
          'Generative Video Control Plane (ComfyUI)',
        ],
        isLocked: false,
      },

      // Layer 3: HIL Governance Gate
      {
        id: `media-hil-gate-${sceneId}`,
        layerIndex: 3,
        label: 'HIL Governance Gate',
        sublabel: 'Budget Ceiling & Sign-off',
        type: 'adapter' as const,
        semanticRole: 'governance' as const,
        properties: [
          // No Spend Limit row: this rail never loads the production, so the figure
          // that used to sit here was typed in. A budget a reader believes is the
          // gate's ceiling is worse than no budget shown at all.
          { label: 'Gate Type', value: 'Pre-flight Approval' },
          { label: 'Audit', value: 'Decision Inbox' },
        ],
        metricsSummary: { status: 'Governance' },
        color: {
          border: 'border-orange-500/50 hover:border-orange-400',
          bg: 'from-orange-950/40 to-orange-900/10',
          text: 'text-orange-400',
          glow: 'shadow-orange-500/10',
          badge: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
        },
        icon: <ShieldCheck className="h-4 w-4" />,
        metrics: 'HIL Gate',
        details: [
          'Production budget ceiling validation',
          'Human-in-the-loop take sign-off',
          'W3C distributed trace context #8a2f',
        ],
        isLocked: false,
      },

      // Layer 4: Dataset Catalog Sink
      {
        id: `media-dataset-sink-${sceneId}`,
        layerIndex: 4,
        label: 'Dataset Catalog Sink',
        sublabel: 'media_takes_catalog',
        type: 'dataset' as const,
        semanticRole: 'evidence' as const,
        properties: [
          { label: 'Collection', value: 'media_takes_catalog' },
          { label: 'Search', value: 'Semantic Vector Index' },
          { label: 'Tags', value: 'Automatic Metadata' },
        ],
        metricsSummary: { status: 'Indexed' },
        color: {
          border: 'border-sky-500/50 hover:border-sky-400',
          bg: 'from-sky-950/40 to-sky-900/10',
          text: 'text-sky-400',
          glow: 'shadow-sky-500/10',
          badge: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
        },
        icon: <Database className="h-4 w-4" />,
        metrics: 'Knowledge Garden',
        details: [
          'Cataloged in media_takes_catalog',
          'Semantic vector search enabled',
          'Cross-production asset retrieval',
        ],
        isLocked: true,
      },
    ];
  }, [mediaStudioState]);

  const visiblePieces = [...attachmentPieces, ...adapterPieces, ...reportPieces, ...ontologyPieces, ...mediaPieces];

  /*
   * Studios can be live in one room. The later mount wins rather than
   * whichever branch happens to be written first, so asking for an app after
   * a manuscript does not leave the manuscript on screen.
   * 
   * Media Studio now renders in a canvas overlay instead of replacing the rail.
   */
  const mediaStudioActive = mediaStudioState !== null && isMediaStudioVisible;
  const formStudioActive = formStudioState !== null && isFormStudioVisible;
  const flowStudioActive = flowStudioState !== null && isFlowStudioVisible;
  const predictionStudioActive = predictionStudioState !== null && isPredictionStudioVisible;
  const appStudioActive = appStudioState !== null && isAppStudioVisible;
  const scribeActive = scribeState !== null && isScribeVisible;
  const projectStudioActive = projectStudioState !== null && isProjectStudioVisible;
  const computerUseActive = computerUseState !== null && isComputerStudioVisible;
  const signalStudioActive = signalStudioState !== null && isSignalStudioVisible;

  const agentStudioActive = agentStudioState !== null && isAgentStudioVisible;



  type WorkbenchKind = 'form' | 'computer' | 'signal' | 'flow' | 'prediction' | 'app' | 'project' | 'scribe' | 'agent' | 'media';

  const [selectedWorkbenchTab, setSelectedWorkbenchTab] = useState<WorkbenchKind | null>(null);

  const getWorkbenchIcon = (kind: WorkbenchKind) => {
    switch (kind) {
      case 'form': return FileText;
      case 'flow': return Workflow;
      case 'scribe': return FileText;
      case 'app': return LayoutTemplate;
      case 'media': return Film;
      case 'signal': return Radio;
      case 'prediction': return Sparkles;
      case 'computer': return Terminal;
      case 'project': return FolderKanban;
      case 'agent': return Bot;
      default: return Layers;
    }
  };

  const closeWorkbench = (kind: WorkbenchKind) => {
    switch (kind) {
      case 'form':
        onExitFormStudio?.();
        break;
      case 'flow':
        setInternalIsFlowStudioVisible(false);
        onExitFlowStudio?.();
        break;
      case 'scribe':
        onExitScribe?.();
        break;
      case 'app':
        onExitAppStudio?.();
        break;
      case 'media':
        onExitMediaStudio?.();
        break;
      case 'signal':
        setInternalIsSignalStudioVisible(false);
        onExitSignalStudio?.();
        break;
      case 'prediction':
        setInternalIsPredictionStudioVisible(false);
        onExitPredictionStudio?.();
        break;
      case 'project':
        setInternalIsProjectStudioVisible(false);
        onExitProjectStudio?.();
        break;
      case 'computer':
        setInternalIsComputerStudioVisible(false);
        onExitComputerStudio?.();
        break;
      case 'agent':
        onExitAgentStudio?.();
        break;
    }
  };

  interface ActiveWorkbenchInfo {
    kind: WorkbenchKind;
    title: string;
    turnIndex: number;
  }

  const activeWorkbenches = useMemo((): ActiveWorkbenchInfo[] => {
    const list: ActiveWorkbenchInfo[] = [];
    if (formStudioActive && formStudioState) {
      list.push({ kind: 'form', title: 'Intake Form', turnIndex: formStudioState.turnIndex });
    }
    if (computerUseActive && computerUseState) {
      list.push({ kind: 'computer', title: computerUseState.title || 'Computer Studio', turnIndex: computerUseState.turnIndex });
    }
    if (signalStudioActive && signalStudioState) {
      list.push({ kind: 'signal', title: 'Signal Studio', turnIndex: signalStudioState.turnIndex });
    }
    if (flowStudioActive && flowStudioState) {
      list.push({ kind: 'flow', title: flowStudioState.name || 'Review Flow', turnIndex: flowStudioState.turnIndex });
    }
    if (predictionStudioActive && predictionStudioState) {
      list.push({ kind: 'prediction', title: predictionStudioState.modelName || 'Prediction Studio', turnIndex: predictionStudioState.turnIndex });
    }
    if (appStudioActive && appStudioState) {
      list.push({ kind: 'app', title: appStudioState.title || 'App Studio', turnIndex: appStudioState.turnIndex });
    }
    if (projectStudioActive && projectStudioState) {
      list.push({ kind: 'project', title: projectStudioState.title || 'Project Studio', turnIndex: projectStudioState.turnIndex });
    }
    if (scribeActive && scribeState) {
      list.push({ kind: 'scribe', title: scribeState.title || 'Summary Document', turnIndex: scribeState.turnIndex });
    }
    if (agentStudioActive && agentStudioState) {
      list.push({ kind: 'agent', title: 'Agent Studio', turnIndex: agentStudioState.turnIndex });
    }
    if (mediaStudioActive && mediaStudioState) {
      list.push({ kind: 'media', title: mediaStudioState.sceneTitle || 'Media Studio', turnIndex: mediaStudioState.turnIndex });
    }
    return list.sort((a, b) => b.turnIndex - a.turnIndex);
  }, [
    formStudioActive, formStudioState,
    computerUseActive, computerUseState,
    signalStudioActive, signalStudioState,
    flowStudioActive, flowStudioState,
    predictionStudioActive, predictionStudioState,
    appStudioActive, appStudioState,
    projectStudioActive, projectStudioState,
    scribeActive, scribeState,
    agentStudioActive, agentStudioState,
    mediaStudioActive, mediaStudioState,
  ]);

  const latestTurnIndex = activeWorkbenches[0]?.turnIndex;
  const prevLatestTurnRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (latestTurnIndex !== undefined && prevLatestTurnRef.current !== undefined && latestTurnIndex > prevLatestTurnRef.current) {
      setSelectedWorkbenchTab(activeWorkbenches[0]?.kind ?? null);
    }
    prevLatestTurnRef.current = latestTurnIndex;
  }, [latestTurnIndex, activeWorkbenches]);

  const currentWorkbenchKind: WorkbenchKind | null = useMemo(() => {
    if (selectedWorkbenchTab && activeWorkbenches.some((w) => w.kind === selectedWorkbenchTab)) {
      return selectedWorkbenchTab;
    }
    return activeWorkbenches[0]?.kind ?? null;
  }, [selectedWorkbenchTab, activeWorkbenches]);

  useEffect(() => {
    if (currentWorkbenchKind) {
      onActiveStudioChange?.(currentWorkbenchKind);
    }
  }, [currentWorkbenchKind, onActiveStudioChange]);

  const coActiveWorkbench = useMemo(() => {
    return activeWorkbenches.find((w) => w.kind !== 'form') ?? null;
  }, [activeWorkbenches]);

  const renderPendingApprovalBanner = () => {
    if (!formStudioActive || !formStudioState || isApprovalDocked) return null;
    return (
      <div
        className="absolute bottom-3 left-3 right-3 z-40 flex items-center justify-between rounded-lg border border-amber-500/40 bg-card/95 p-2 px-3 shadow-lg backdrop-blur"
        data-testid="pending-approval-banner"
      >
        <div className="flex items-center gap-2 text-xs">
          <ShieldCheck className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="font-medium text-foreground">Pending Approval / Form</span>
        </div>
        <Button
          variant="default"
          size="sm"
          className="h-7 px-2.5 text-xs gap-1.5 bg-amber-600 hover:bg-amber-500 text-white"
          onClick={() => setIsApprovalDocked(true)}
          data-testid="open-approval-split-button"
        >
          <Minimize2 className="h-3.5 w-3.5" />
          Split & Review
        </Button>
      </div>
    );
  };

  const renderWorkbench = (kind: WorkbenchKind) => {
    switch (kind) {
      case 'media':
        if (!mediaStudioState) return null;
        return (
          <div className={cn('flex h-full min-h-0 min-w-0 w-full flex-col relative', className)} data-testid="media-studio-rail">
            <MediaStudio
              crewSessionId={sessionId}
              sceneId={mediaStudioState.sceneId}
              sceneTitle={mediaStudioState.sceneTitle}
              aspectRatio={mediaStudioState.aspectRatio}
              isFocusMode={isChatCollapsed}
              onToggleFocusMode={onToggleChatCollapse}
              onClose={onExitMediaStudio}
              productionId={mediaStudioState.productionId}
              refreshKey={mediaStudioState.turnIndex}
              onProductionChange={(id) => {
                setMediaProductionId(id);
                onMediaProductionChange?.(id);
              }}
              onFocusInChat={(selection) => {
                onSelectionChange?.({
                  id: mediaStudioSelectionId(selection),
                  label: selection.label,
                  sublabel: 'Media Studio',
                  type: 'media',
                  mediaStudio: selection,
                });
                if (onExpandChat) onExpandChat(); else if (isChatCollapsed) onToggleChatCollapse?.();
              }}
            />
            {renderPendingApprovalBanner()}
          </div>
        );
      case 'computer':
        if (!computerUseState) return null;
        return (
          <div
            className={cn(
              'flex h-full min-h-0 min-w-0 w-full max-w-full flex-col transition-all duration-300 relative',
              className,
            )}
            data-testid="computer-studio-rail"
          >
            <ComputerUseStudio
              sessionId={computerUseState.sessionId}
              organizationId={Number(organizationId) || undefined}
              title={computerUseState.title}
              initialGoal={computerUseState.initialGoal}
              initialTeaching={computerUseState.initialTeaching}
              isFocusMode={isChatCollapsed}
              onToggleFocusMode={onToggleChatCollapse}
              onClose={() => {
                setInternalIsComputerStudioVisible(false);
                onExitComputerStudio?.();
              }}
              onFocusInChat={(selection, promptSuggestion) => {
                onSelectionChange?.(
                  {
                    id: selection.id,
                    label: selection.label,
                    sublabel: selection.sublabel,
                    type: 'control',
                  } as any,
                  promptSuggestion
                );
                if (onExpandChat) {
                  onExpandChat();
                } else if (isChatCollapsed) {
                  onToggleChatCollapse?.();
                }
              }}
            />
            {renderPendingApprovalBanner()}
          </div>
        );
      case 'signal':
        if (!signalStudioState) return null;
        return (
          <div
            className={cn(
              'flex h-full min-h-0 min-w-0 w-full max-w-full flex-col transition-all duration-300 relative',
              className,
            )}
            data-testid="signal-studio-rail"
          >
            <SignalStudioPod
              isFocusMode={isChatCollapsed}
              onToggleFocusMode={onToggleChatCollapse}
              onClose={() => {
                setInternalIsSignalStudioVisible(false);
                onExitSignalStudio?.();
              }}
              onFocusInChat={(selection, promptSuggestion) => {
                onSelectionChange?.(
                  {
                    id: selection.id,
                    label: selection.label,
                    sublabel: selection.sublabel,
                    type: 'signal',
                    signal: selection.signal,
                  },
                  promptSuggestion
                );
                if (onExpandChat) {
                  onExpandChat();
                } else if (isChatCollapsed) {
                  onToggleChatCollapse?.();
                }
              }}
            />
            {renderPendingApprovalBanner()}
          </div>
        );
      case 'flow':
        if (!flowStudioState) return null;
        return (
          <div
            className={cn(
              'flex h-full min-h-0 min-w-0 w-full max-w-full flex-col transition-all duration-300 relative',
              className,
            )}
            data-testid="flow-studio-rail"
          >
            <FlowStudioPod
              proposal={flowStudioState.proposal}
              pipelineId={flowStudioState.pipelineId}
              flowId={flowStudioState.flowId}
              organizationId={organizationId}
              isFocusMode={isChatCollapsed}
              onToggleFocusMode={onToggleChatCollapse}
              onClose={() => {
                setInternalIsFlowStudioVisible(false);
                onExitFlowStudio?.();
              }}
              onFocusInChat={(selection, promptSuggestion) => {
                onSelectionChange?.(
                  {
                    id: selection.id,
                    label: selection.label,
                    sublabel: selection.sublabel,
                    type: 'flow' as any,
                  },
                  promptSuggestion
                );
                if (onExpandChat) {
                  onExpandChat();
                } else if (isChatCollapsed) {
                  onToggleChatCollapse?.();
                }
              }}
            />
            {renderPendingApprovalBanner()}
          </div>
        );
      case 'prediction':
        if (!predictionStudioState) return null;
        return (
          <div
            className={cn(
              'flex h-full min-h-0 min-w-0 w-full max-w-full flex-col transition-all duration-300 relative',
              className,
            )}
            data-testid="prediction-studio-rail"
          >
            <PredictionStudioPod
              modelId={predictionStudioState.modelId}
              modelName={predictionStudioState.modelName}
              streamId={predictionStudioState.streamId}
              organizationId={organizationId}
              isFocusMode={isChatCollapsed}
              onToggleFocusMode={onToggleChatCollapse}
              onClose={() => {
                setInternalIsPredictionStudioVisible(false);
                onExitPredictionStudio?.();
              }}
              onFocusInChat={(selection, promptSuggestion) => {
                onSelectionChange?.(
                  {
                    id: selection.id,
                    label: selection.label,
                    sublabel: selection.sublabel,
                    type: 'prediction' as any,
                  },
                  promptSuggestion
                );
                if (onExpandChat) {
                  onExpandChat();
                } else if (isChatCollapsed) {
                  onToggleChatCollapse?.();
                }
              }}
            />
            {renderPendingApprovalBanner()}
          </div>
        );
      case 'app':
        if (!appStudioState) return null;
        return (
          <div
            className={cn(
              'flex h-full min-h-0 min-w-0 w-full max-w-full flex-col transition-all duration-300 relative',
              className,
            )}
            data-testid="app-studio-rail"
          >
            <AppStudioPod
              mode={appStudioState.mode}
              view={appStudioState.view}
              appId={appStudioState.appId}
              appName={appStudioState.appName}
              appSlug={appStudioState.appSlug}
              publicSlug={appStudioState.publicSlug}
              status={appStudioState.status}
              jobId={appStudioState.jobId}
              jobStatus={appStudioState.jobStatus}
              title={appStudioState.title}
              requirements={appStudioState.requirements}
              lastChange={appStudioState.lastChange}
              isFocusMode={isChatCollapsed}
              onToggleFocusMode={onToggleChatCollapse}
              onClose={onExitAppStudio}
              onFocusInChat={(unit) => {
                onSelectionChange?.({
                  id: appStudioSelectionId(unit),
                  label: unit.label,
                  sublabel: unit.appName,
                  type: 'app',
                  appStudio: unit,
                });
                if (isChatCollapsed) {
                  onToggleChatCollapse?.();
                }
              }}
            />
            {renderPendingApprovalBanner()}
          </div>
        );
      case 'project':
        if (!projectStudioState) return null;
        return (
          <div
            className={cn(
              'flex h-full min-h-0 min-w-0 w-full max-w-full flex-col transition-all duration-300 relative',
              className,
            )}
            data-testid="project-studio-rail"
          >
            <ProjectStudio
              stageId={projectStudioState.stageId}
              title={projectStudioState.title}
              projectTitle={projectStudioState.projectTitle}
              objective={projectStudioState.objective}
              waves={projectStudioState.waves}
              defaultWaves={projectStudioState.defaultWaves}
              defaultBudgetLimitUsd={projectStudioState.defaultBudgetLimitUsd}
              defaultTokenLimit={projectStudioState.defaultTokenLimit}
              defaultTargetSlaDays={projectStudioState.defaultTargetSlaDays}
              defaultMaxParallelMissions={projectStudioState.defaultMaxParallelMissions}
              cycleId={'cycleId' in projectStudioState ? projectStudioState.cycleId : undefined}
              // One draft per mount: the split view and rail changes remount the
              // studio, and its plan lives in component state until saved.
              draftKey={`${roomKey ?? sessionId ?? 'room'}:${projectStudioState.stageId ?? 'project'}:${projectStudioState.turnIndex}`}
              sessionId={sessionId != null ? String(sessionId) : undefined}
              roomKey={roomKey}
              isFocusMode={isChatCollapsed}
              onToggleFocusMode={onToggleChatCollapse}
              onClose={() => {
                setInternalIsProjectStudioVisible(false);
                onExitProjectStudio?.();
              }}
              onFocusInChat={(selection, promptSuggestion) => {
                onSelectionChange?.({
                  id: `project-studio:${selection.waveId}`,
                  label: selection.waveTitle,
                  sublabel: 'Project Studio Wave',
                  type: 'project',
                } as any, promptSuggestion);
                if (onExpandChat) {
                  onExpandChat();
                } else if (isChatCollapsed) {
                  onToggleChatCollapse?.();
                }
              }}
            />
            {renderPendingApprovalBanner()}
          </div>
        );
      case 'scribe':
        if (!scribeState) return null;
        return (
          <div
            className={cn(
              'flex h-full min-h-0 min-w-0 w-full max-w-full flex-col transition-all duration-300 relative',
              className,
            )}
            data-testid="scribe-studio-rail"
          >
            <ScribeStudioPod
              manuscriptRailTarget={manuscriptRailTarget}
              documentId={scribeState.documentId}
              sessionId={sessionId || (scribeState as any)?.sessionId}
              title={scribeState.title}
              archetypeMode={scribeState.archetypeMode}
              isFocusMode={isChatCollapsed}
              onToggleFocusMode={onToggleChatCollapse}
              onClose={onExitScribe}
              onFocusInChat={(selection, promptSuggestion) => {
                onSelectionChange?.({
                  id: scribeSelectionId(selection),
                  label: selection.stationTitle || (selection.stationKey ? `Station ${selection.stationKey}` : 'Manuscript'),
                  sublabel: selection.excerpt ? `"${selection.excerpt.slice(0, 30)}${selection.excerpt.length > 30 ? '...' : ''}"` : (selection.title || undefined),
                  type: 'scribe',
                  scribe: selection,
                }, promptSuggestion);
                if (onExpandChat) {
                  onExpandChat();
                } else if (isChatCollapsed) {
                  onToggleChatCollapse?.();
                }
              }}
            />
            {renderPendingApprovalBanner()}
          </div>
        );
      case 'agent':
        if (!agentStudioState) return null;
        return (
          <div
            className={cn('flex h-full min-h-0 min-w-0 w-full max-w-full flex-col transition-all duration-300 relative', className)}
            data-testid="agent-studio-rail"
          >
            <AgentStudio
              key={agentStudioState.mountKey}
              agentId={agentStudioState.agentId}
              view={agentStudioState.view}
              isFocusMode={isChatCollapsed}
              onToggleFocusMode={onToggleChatCollapse}
              onClose={onExitAgentStudio}
              onFocusInChat={(selection) => {
                onSelectionChange?.({
                  id: `agent:${selection.agentId}:${selection.kind}`,
                  label: selection.label,
                  sublabel: 'Agent Studio',
                  type: 'agent',
                });
                if (onExpandChat) onExpandChat(); else if (isChatCollapsed) onToggleChatCollapse?.();
              }}
              className="h-full"
            />
            {renderPendingApprovalBanner()}
          </div>
        );
      case 'form':
        if (!formStudioState) return null;
        return (
          <div
            className={cn(
              'flex h-full min-h-0 min-w-0 w-full max-w-full flex-col transition-all duration-300 relative',
              activeWorkbenches.length === 1 ? className : '',
            )}
            data-testid="form-studio-rail"
          >
            {coActiveWorkbench && (
              <div
                className="flex items-center justify-between px-3 py-1.5 bg-muted/60 border-b border-border/70 text-xs shrink-0"
                data-testid="co-active-workbench-banner"
              >
                <span className="text-muted-foreground">
                  Active workbench: <strong className="text-foreground">{coActiveWorkbench.title}</strong>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[11px] gap-1"
                  onClick={() => setIsApprovalDocked(true)}
                  data-testid="dock-split-view-button"
                >
                  <Minimize2 className="h-3 w-3" />
                  Split View
                </Button>
              </div>
            )}
            <FormStudioPod
              key={formStudioState.mountKey}
              formId={formStudioState.formId}
              organizationId={organizationId}
              view={formStudioState.view}
              isFocusMode={isChatCollapsed}
              onToggleFocusMode={onToggleChatCollapse}
              onClose={() => {
                closeWorkbench('form');
              }}
              onFocusInChat={(selection) => {
                onSelectionChange?.({
                  id: formStudioSelectionId(selection),
                  label: selection.label,
                  sublabel: 'Form Studio',
                  type: 'form',
                  formStudio: selection,
                });
                if (onExpandChat) {
                  onExpandChat();
                } else if (isChatCollapsed) {
                  onToggleChatCollapse?.();
                }
              }}
            />
            {renderPendingApprovalBanner()}
          </div>
        );
      default:
        return null;
    }
  };

  if (isApprovalDocked && coActiveWorkbench && formStudioActive && formStudioState) {
    return (
      <div
        className={cn(
          'flex h-full min-h-0 min-w-0 w-full max-w-full flex-col transition-all duration-300 gap-2',
          className,
        )}
        data-testid="split-approval-rail"
      >
        <div className="flex-1 min-h-[45%] min-w-0 border-b border-border/70 overflow-hidden flex flex-col">
          {renderWorkbench(coActiveWorkbench.kind)}
        </div>
        <div className="flex-1 min-h-[45%] min-w-0 overflow-hidden flex flex-col rounded-lg border border-primary/30 bg-background/95 shadow-md">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-muted/40 text-xs font-medium shrink-0">
            <div className="flex items-center gap-1.5 text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Approval / Form Studio</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => setIsApprovalDocked(false)}
                title="Maximize Form Studio"
                data-testid="maximize-approval-dock-button"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setIsApprovalDocked(false);
                  onExitFormStudio?.();
                }}
                title="Close Form Studio"
                data-testid="close-approval-dock-button"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex-1 min-h-0 min-w-0 overflow-auto" data-testid="form-studio-rail">
            <FormStudioPod
              key={formStudioState.mountKey}
              formId={formStudioState.formId}
              organizationId={organizationId}
              view={formStudioState.view}
              isFocusMode={isChatCollapsed}
              onToggleFocusMode={onToggleChatCollapse}
              onClose={() => {
                setIsApprovalDocked(false);
                onExitFormStudio?.();
              }}
              onFocusInChat={(selection) => {
                onSelectionChange?.({
                  id: formStudioSelectionId(selection),
                  label: selection.label,
                  sublabel: 'Form Studio',
                  type: 'form',
                  formStudio: selection,
                });
                if (onExpandChat) {
                  onExpandChat();
                } else if (isChatCollapsed) {
                  onToggleChatCollapse?.();
                }
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (currentWorkbenchKind) {
    if (activeWorkbenches.length > 1) {
      return (
        <div
          className={cn(
            'flex h-full min-h-0 min-w-0 w-full max-w-full flex-col transition-all duration-300',
            className,
          )}
        >
          <div
            className="flex items-center gap-1 overflow-x-auto border-b border-border/70 bg-muted/40 px-2 py-1 shrink-0 text-xs"
            data-testid="multi-studio-workspace-tabs"
          >
            {activeWorkbenches.map((wb) => {
              const Icon = getWorkbenchIcon(wb.kind);
              const isSelected = wb.kind === currentWorkbenchKind;
              return (
                <div
                  key={wb.kind}
                  className={cn(
                    'group flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer select-none border',
                    isSelected
                      ? 'bg-background text-foreground shadow-sm border-border'
                      : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground border-transparent'
                  )}
                  onClick={() => setSelectedWorkbenchTab(wb.kind)}
                  data-testid={`workspace-tab-${wb.kind}`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="max-w-[130px] truncate">{wb.title}</span>
                  <button
                    type="button"
                    className="ml-1 rounded-sm p-0.5 opacity-60 hover:opacity-100 hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeWorkbench(wb.kind);
                      if (selectedWorkbenchTab === wb.kind) {
                        const remaining = activeWorkbenches.filter((w) => w.kind !== wb.kind);
                        setSelectedWorkbenchTab(remaining[0]?.kind ?? null);
                      }
                    }}
                    title={`Close ${wb.title}`}
                    data-testid={`close-tab-${wb.kind}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex-1 min-h-0 min-w-0 flex flex-col relative">
            {renderWorkbench(currentWorkbenchKind)}
          </div>
        </div>
      );
    }

    return renderWorkbench(currentWorkbenchKind);
  }

  // An empty Assembly Stack is meaningful only after the room has expressed
  // app or document creation intent through a mounted builder/Scribe surface.
  // Ordinary chat rooms must not acquire a permanent empty scaffold panel.
  const hasCreationIntent = Boolean(
    scribeState ||
    appStudioState ||
    formStudioState ||
    flowStudioState ||
    predictionStudioState ||
    mediaStudioState ||
    projectStudioState ||
    computerUseState ||
    signalStudioState
  );
  if (visiblePieces.length === 0 && !hasCreationIntent && !showEmpty) return null;

  return (
    <div className={cn('relative h-full min-h-0 shrink-0 transition-all duration-300', isCollapsed ? 'w-8' : 'w-72 lg:w-80', className)}>
      {/* Media Studio Canvas Overlay */}
      {mediaStudioActive && mediaCanvasVisible && (
        <div className="absolute inset-0 z-50 rounded-xl border border-border/70 bg-card/95 shadow-2xl backdrop-blur-md overflow-hidden" data-testid="media-canvas-overlay">
          <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-fuchsia-500/20 text-fuchsia-400">
                <Film className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-semibold text-foreground">
                {mediaStudioState.sceneTitle || mediaStudioState.sceneId}
              </span>
              <Badge variant="outline" className="h-5 px-1.5 text-[9px] font-mono text-fuchsia-400 border-fuchsia-500/30">
                {mediaStudioState.aspectRatio}
              </Badge>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  // Open full Media Studio for detailed editing
                  setMediaCanvasVisible(false);
                }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Open Full Media Studio"
              >
                <Layers className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setMediaCanvasVisible(false)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Close Media Canvas"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 p-3">
            {mediaActiveShot && mediaActiveTake ? (
              <MediaStageCanvas
                activeShot={mediaActiveShot}
                activeTake={mediaActiveTake}
                compareTake={mediaCompareTake}
                aspectRatio={mediaStudioState.aspectRatio}
                isPlaying={mediaIsPlaying}
                canPlay={Boolean(mediaActiveTake?.videoUrl)}
                currentTime={mediaCurrentTime}
                onTogglePlay={() => setMediaIsPlaying((playing) => !playing)}
                onSeek={setMediaCurrentTime}
                className="h-full"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Film className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm">No shot selected</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Select a shot in the Media Studio to view renders
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Assembler */}
      <div
        className={cn(
          'flex flex-col gap-2 rounded-xl border border-border/70 bg-card/85 shadow-xl backdrop-blur-md transition-all duration-300 h-full min-h-0 w-full',
          isCollapsed
            ? 'overflow-hidden px-1 py-2 items-center cursor-pointer'
            : 'overflow-y-auto p-3 pb-14',
        )}
        onClick={isCollapsed ? handleToggleCollapse : undefined}
        data-testid="crew-assembly-puzzle-rail"
      >
      {/* Header */}
      <div className={cn("flex items-center border-b border-border/50 pb-2 w-full", isCollapsed ? "flex-col gap-2 justify-center" : "justify-between gap-1")}>
        {!isCollapsed ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-500/20 text-indigo-400">
              <Boxes className="h-3 w-3" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                  Assembler
                </span>
                <Badge variant="outline" className="h-4 px-1 text-[9px] font-mono text-emerald-400 border-emerald-500/30">
                  {reportPieces.length ? 'Report' : ontologyPieces.length ? 'Ontology' : 'Scaffold'}
                </Badge>
              </div>
            </div>
          </div>
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-500/20 text-indigo-400" title="Assembler">
            <Boxes className="h-3 w-3" />
          </span>
        )}
        <div className={cn("flex items-center gap-1", isCollapsed && "flex-col")}>
          {mediaStudioActive && !isCollapsed && (
            <button
              type="button"
              onClick={() => setMediaCanvasVisible(true)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fuchsia-400 transition-colors hover:bg-fuchsia-500/10 hover:text-fuchsia-300"
              title="Open Media Canvas"
            >
              <Film className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleToggleCollapse();
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={isCollapsed ? 'Expand Assembler' : 'Collapse Assembler'}
            aria-label={isCollapsed ? 'Expand Assembler' : 'Collapse Assembler'}
            data-testid="toggle-puzzle-rail-btn"
          >
            {isCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {isCollapsed && (
        <div className="flex flex-col items-center gap-2 mt-4 select-none">
          <span className="text-[10px] font-mono font-bold tracking-widest text-indigo-400 uppercase -rotate-90 origin-center whitespace-nowrap mt-8" title="Assembler">
            Assembler
          </span>
        </div>
      )}

      {!isCollapsed && (
        <div className="space-y-1.5 pt-1">
          {/* Active Connection Subtitle */}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground px-0.5 pb-1">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {visiblePieces.length ? 'Connected Modular Stack' : 'Scaffold Ready'}
            </span>
            <span className="font-mono text-indigo-400 text-[9px]">
              {`${visiblePieces.length} Units`}
            </span>
          </div>

          {/* Interlocking Puzzle Pieces Stack */}
          <div className="flex flex-col relative space-y-[-6px]">
            {visiblePieces.length === 0 && (
              <div className="rounded-lg border border-dashed border-indigo-500/30 bg-indigo-500/5 px-3 py-5 text-center" data-testid="assembly-scaffold-empty-state">
                <Boxes className="mx-auto mb-2 h-5 w-5 text-indigo-400" />
                <p className="text-xs font-semibold text-foreground">Scaffold mode</p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                  No assembly layers are mounted yet. Ask the Crew to scaffold an app or document.
                </p>
              </div>
            )}
            {visiblePieces.map((piece, idx) => {
              const isSelected = selectedPieceId === piece.id;
              const isFirst = idx === 0;
              const isLast = idx === visiblePieces.length - 1;

              return (
                <div key={piece.id} className="relative group">
                  {/* The Puzzle Piece Card */}
                  <div
                    onClick={() => {
                      const next = isSelected ? null : piece.id;
                      if (!isControlled) setInternalSelectedId(next);
                      // Pieces carry the turn they came from; surface it so the
                      // dialogue can scroll there. Synthetic pieces use a
                      // sentinel index that lands outside `turns`, so the
                      // lookup yields undefined and nothing fires.
                      const originTurn = piece.turnIndex === undefined ? undefined : turns[piece.turnIndex]?.id;
                      if (next !== null && originTurn !== undefined) onShowTurn?.(originTurn);
                      // Publish the target so the composer can show which layer
                      // the next message lands on. Selecting is how you say
                      // "apply this to the pipeline DAG" without typing it.
                      onSelectionChange?.(
                        next === null
                          ? null
                          : {
                              id: piece.id,
                              label: piece.label,
                              sublabel: piece.sublabel,
                              type: piece.type,
                              properties: piece.properties,
                              agents: piece.agents,
                              jobSteps: piece.jobSteps,
                              decisions: piece.decisions,
                              metricsSummary: piece.metricsSummary,
                              semanticRole: piece.semanticRole,
                              ontologyRef: piece.ontologyRef,
                            },
                      );
                    }}
                    className={cn(
                      'relative cursor-pointer rounded-lg border bg-gradient-to-br p-2.5 shadow-sm transition-all duration-200 hover:shadow-md hover:scale-[1.01]',
                      piece.color.border,
                      piece.color.bg,
                      isSelected && 'ring-2 ring-indigo-500 shadow-indigo-500/20',
                      !isFirst && 'pt-3',
                      !isLast && 'pb-3',
                    )}
                  >
                    {/* Top Notch Tab / Receptor Indicator */}
                    {!isFirst && (
                      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 flex items-center justify-center">
                        <div className="h-2 w-5 rounded-full bg-border/80 border border-emerald-500/50 shadow-xs flex items-center justify-center">
                          <span className="h-1 w-1 rounded-full bg-emerald-400 animate-ping" />
                        </div>
                      </div>
                    )}

                    {/* Header Line */}
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={cn('shrink-0', piece.color.text)}>{piece.icon}</span>
                        <span className="text-[11px] font-bold text-foreground truncate">{piece.label}</span>
                      </div>
                      <Badge variant="outline" className={cn('text-[9px] px-1 py-0 h-4 font-mono shrink-0', piece.color.badge)}>
                        {piece.metrics}
                      </Badge>
                    </div>

                    {/* Subtitle / Key Identifier */}
                    <div className="mt-1 flex items-center justify-between text-[10px]">
                      <span className="font-medium text-foreground/85 truncate max-w-[150px]">
                        {piece.sublabel}
                      </span>
                      <span className="text-emerald-400 text-[9px] flex items-center gap-0.5">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Wired
                      </span>
                    </div>

                    {/* Expandable Details Drawer */}
                    {isSelected && (
                      <div className="mt-2 pt-2 border-t border-border/40 text-[10px] space-y-1 text-muted-foreground animate-in fade-in slide-in-from-top-1">
                        <div className="font-semibold text-foreground/80">Active Components:</div>
                        <ul className="list-disc list-inside space-y-0.5 text-foreground/70 font-mono text-[9px]">
                          {piece.details.map((d, i) => (
                            <li key={i} className="truncate">
                              {d}
                            </li>
                          ))}
                        </ul>
                        <div className="pt-1.5 flex items-center justify-between border-t border-border/30">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectionChange?.(
                                {
                                  id: piece.id,
                                  label: piece.label,
                                  sublabel: piece.sublabel,
                                  type: piece.type,
                                  properties: piece.properties,
                                },
                                `Inspect X-Ray architectural lineage for ${piece.label}`
                              );
                            }}
                            className="inline-flex items-center gap-1 text-[9px] font-semibold text-primary hover:text-primary/80 transition-colors py-0.5 px-1.5 rounded border border-primary/30 bg-primary/5 hover:bg-primary/10"
                            data-testid={`inspect-xray-${piece.id}`}
                          >
                            <Eye className="h-2.5 w-2.5" />
                            Inspect in X-Ray
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Bottom Interlocking Tab / Convex Joint Indicator */}
                    {!isLast && (
                      <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center">
                        <div className="h-2.5 w-6 rounded-b-md bg-card border-b border-x border-emerald-500/50 shadow-xs flex items-center justify-center">
                          <span className="h-1 w-2 rounded-full bg-emerald-400/80" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      )}
      </div>

    </div>
  );
};

export default ModularAssemblyPuzzleRail;
