import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { COPILOT_PERSONA_TYPE } from '@shared/constants/agent-personas';
import { type AssemblyUnitSelection } from './ModularAssemblyPuzzleRail';
import { studioMountKind, type StudioMountKind } from './StudioMountNotice';
import { STUDIO_KINDS } from '@shared/studio-registry';
import type { AgentCard, CrewTurn, CrewSession } from './AgentChatPanel';

export type StudioSurfaceKind = StudioMountKind | 'scribe';

// Mirrors the winner order in ModularAssemblyPuzzleRail when two mounts share a turn.
export const STUDIO_TIE_PRIORITY: StudioSurfaceKind[] = STUDIO_KINDS as StudioSurfaceKind[];

export function studioSurfaceKind(artifact: { tool?: string; payload?: Record<string, any> }): StudioSurfaceKind | null {
  const p = artifact.payload ?? {};
  if (
    artifact.tool === 'mount_scribe_studio' ||
    p.type === 'scribe_foundry_pod' ||
    p.module === 'ScribeStudioPod' ||
    p.component === 'ScribeStudioPod'
  ) {
    return 'scribe';
  }
  return studioMountKind(artifact);
}

export interface UseCrewStudiosOptions {
  turns: CrewTurn[];
  agents: AgentCard[];
  setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>;
  session: CrewSession | null;
  isSending: boolean;
  send: (prompt: string) => Promise<void>;
  currentRoomKey: string;
  setIsTabbedRailCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setIsMediaRailCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  scribeActiveRef?: React.MutableRefObject<boolean>;
  computerStudioActiveRef?: React.MutableRefObject<boolean>;
}

export interface UseCrewStudiosResult {
  // Selection and composer draft
  selectedAssemblyUnit: AssemblyUnitSelection | null;
  setSelectedAssemblyUnit: React.Dispatch<React.SetStateAction<AssemblyUnitSelection | null>>;
  composerDraft: string;
  setComposerDraft: React.Dispatch<React.SetStateAction<string>>;

  // Chat collapsed state
  isChatCollapsed: boolean;
  setIsChatCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  // Active studio identification
  activeStudioKind: StudioSurfaceKind | null;
  hasStudioActive: boolean;

  // Scribe Studio
  hasScribeActive: boolean;
  manuscriptRailTarget: HTMLElement | null;
  setManuscriptRailTarget: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
  exitScribeToScaffold: () => void;

  // App Studio (Forge & Builder)
  hasAppStudioActive: boolean;
  exitAppStudioToScaffold: () => void;

  // Form Studio
  hasFormStudioActive: boolean;
  exitFormStudioToScaffold: () => void;

  // Flow Studio
  hasFlowStudioActive: boolean;
  exitFlowStudioToScaffold: () => void;

  // Prediction Studio
  hasPredictionStudioActive: boolean;
  exitPredictionStudioToScaffold: () => void;

  // Media Studio
  hasMediaStudioActive: boolean;
  openMediaStudio: boolean;
  mediaProductionId: number | null;
  setMediaProductionId: React.Dispatch<React.SetStateAction<number | null>>;
  exitMediaStudioToScaffold: () => void;

  // Project Studio
  hasProjectStudioActive: boolean;
  openProjectStudio: boolean;
  exitProjectStudioToScaffold: () => void;

  // Computer Use Studio
  hasComputerStudioActive: boolean;
  openComputerStudio: boolean;
  exitComputerStudioToScaffold: () => void;

  // Signal Studio
  hasSignalStudioActive: boolean;
  openSignalStudio: boolean;
  exitSignalStudioToScaffold: () => void;

  // Agent Studio
  hasAgentStudioActive: boolean;
  appliedAgentProposals: Set<string>;
  exitAgentStudioToScaffold: () => void;
}

export function useCrewStudios({
  turns,
  agents,
  setSelectedIds,
  session,
  isSending,
  send,
  currentRoomKey,
  setIsTabbedRailCollapsed,
  setIsMediaRailCollapsed,
  scribeActiveRef,
  computerStudioActiveRef,
}: UseCrewStudiosOptions): UseCrewStudiosResult {
  /** Assembly layer the next message is scoped to; drives the composer accent. */
  const [selectedAssemblyUnit, setSelectedAssemblyUnit] = useState<AssemblyUnitSelection | null>(null);
  const [composerDraft, setComposerDraft] = useState<string>('');
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [manuscriptRailTarget, setManuscriptRailTarget] = useState<HTMLElement | null>(null);

  // Local studio room selections
  const [mediaRoom, setMediaRoom] = useState<string | null>(null);
  const [mediaProductionId, setMediaProductionId] = useState<number | null>(null);
  const openMediaStudio = mediaRoom === currentRoomKey;

  const [projectRoom, setProjectRoom] = useState<string | null>(null);
  const openProjectStudio = projectRoom === currentRoomKey;

  const [computerRoom, setComputerRoom] = useState<string | null>(null);
  const openComputerStudio = computerRoom === currentRoomKey;

  // Cross-component focus bridge: listen for Scribe excerpt / persona focus requests
  useEffect(() => {
    const handleFocusChat = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.selection) {
        setSelectedAssemblyUnit({
          id: `scribe-${detail.selection.documentId}-${detail.selection.nodeId || detail.selection.stationKey || 'draft'}`,
          label: detail.selection.stationTitle || (detail.selection.stationKey ? `Station ${detail.selection.stationKey}` : 'Manuscript'),
          sublabel: detail.selection.excerpt ? `"${detail.selection.excerpt.slice(0, 30)}${detail.selection.excerpt.length > 30 ? '...' : ''}"` : undefined,
          type: 'scribe',
          scribe: detail.selection,
        });
      }
      if (detail?.prompt) {
        setComposerDraft(detail.prompt);
      }
      setIsChatCollapsed(false);
    };
    window.addEventListener('scribe:focus-chat', handleFocusChat);
    return () => window.removeEventListener('scribe:focus-chat', handleFocusChat);
  }, []);

  /** Identity of the latest Scribe mount. A later mount reopens a locally dismissed studio. */
  const scribeMountKey = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const art = artifacts[j];
        const p = art.payload ?? {};
        if (
          art.tool === 'mount_scribe_studio' ||
          p.type === 'scribe_foundry_pod' ||
          p.module === 'ScribeStudioPod' ||
          p.component === 'ScribeStudioPod'
        ) {
          return `${(turns[i] as any).id ?? i}:${(art as any).id ?? j}:${p.documentId ?? p.title ?? 'scribe'}`;
        }
      }
    }
    return null;
  }, [turns]);
  const [dismissedScribeKey, setDismissedScribeKey] = useState<string | null>(null);
  const hasScribeActive = Boolean(scribeMountKey && dismissedScribeKey !== scribeMountKey);
  if (scribeActiveRef) scribeActiveRef.current = hasScribeActive;

  // Give the authoring canvas the rail when a Scribe mount first arrives.
  // Remember the handled mount so an author's later panel toggles remain theirs;
  // a genuinely new Scribe artifact collapses the supporting panels again.
  const collapsedForScribeMountRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scribeMountKey || collapsedForScribeMountRef.current === scribeMountKey) return;
    collapsedForScribeMountRef.current = scribeMountKey;
    setIsTabbedRailCollapsed(true);
    // A complete Scribe workspace needs a manuscript, station spine and critic
    // dock in addition to a useful chat column. Windows display scaling turns
    // many nominally-wide screens into a constrained CSS viewport, so forcing
    // a split there inevitably clips one of those surfaces. Open focused below
    // the viable split threshold; Show Chat remains an explicit, reversible
    // switch, while genuinely wide displays retain side-by-side authoring.
    if (window.matchMedia('(max-width: 2199px)').matches) {
      setIsChatCollapsed(true);
    }
  }, [scribeMountKey, setIsTabbedRailCollapsed]);

  const exitScribeToScaffold = useCallback(() => {
    if (scribeMountKey) setDismissedScribeKey(scribeMountKey);
    if (isChatCollapsed) setIsChatCollapsed(false);
  }, [isChatCollapsed, scribeMountKey]);

  /** Identity of the latest App Studio mount, on the same terms as Scribe's. */
  const appStudioMountKey = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const art = artifacts[j];
        const p = art.payload ?? {};
        if (
          art.tool === 'mount_app_studio' ||
          p.type === 'app_studio_pod' ||
          p.module === 'AppStudioPod' ||
          p.component === 'AppStudioPod'
        ) {
          // The mode is part of the identity: a forge run that finishes and is
          // then re-mounted as Builder is a new studio to reopen, not the same
          // one the author dismissed.
          return `${(turns[i] as any).id ?? i}:${(art as any).id ?? j}:${p.mode ?? 'builder'}:${p.appId ?? p.jobId ?? 'app'}`;
        }
      }
    }
    return null;
  }, [turns]);
  const [dismissedAppStudioKey, setDismissedAppStudioKey] = useState<string | null>(null);
  const isUrlForgeRequested = typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('studio') === 'forge' ||
     (new URLSearchParams(window.location.search).get('studio') === 'app' && !new URLSearchParams(window.location.search).get('appId')) ||
     new URLSearchParams(window.location.search).get('mount') === 'forge');
  const isUrlBuilderRequested = typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('studio') === 'builder' ||
     (new URLSearchParams(window.location.search).get('studio') === 'app' && Boolean(new URLSearchParams(window.location.search).get('appId'))) ||
     new URLSearchParams(window.location.search).get('mount') === 'builder' ||
     Boolean(new URLSearchParams(window.location.search).get('appId')));
  const isUrlStudioRequested = isUrlForgeRequested || isUrlBuilderRequested;

  const hasAppStudioActive = Boolean(
    (appStudioMountKey || isUrlStudioRequested) &&
    dismissedAppStudioKey !== (appStudioMountKey || (isUrlBuilderRequested ? 'url-builder' : 'url-forge'))
  );

  /**
   * Identity of the latest Form Studio mount, on the same terms. An applied change
   * posts a new mount, so it reopens a studio the author had closed.
   */
  const formStudioMountKey = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const p = artifacts[j].payload ?? {};
        if (p.type === 'form_studio_pod' && typeof p.formId === 'number') {
          return `${(turns[i] as any).id ?? i}:${(artifacts[j] as any).id ?? j}:${p.formId}`;
        }
      }
    }
    return null;
  }, [turns]);
  const [dismissedFormStudioKey, setDismissedFormStudioKey] = useState<string | null>(null);
  const hasFormStudioActive = Boolean(formStudioMountKey && dismissedFormStudioKey !== formStudioMountKey);

  // Auto-mount App Studio in Forge mode if requested via URL query params (?studio=forge or ?mount=forge)
  const initialStudioParamRef = useRef<string | null>(null);
  const autoPromptSentRef = useRef(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && initialStudioParamRef.current === null) {
      const sp = new URLSearchParams(window.location.search);
      initialStudioParamRef.current = sp.get('studio') || sp.get('mount') || '';
    }
  }, []);

  // When forge studio is active from URL, auto-seed the conversation with Copilot if room is fresh
  useEffect(() => {
    if (isUrlForgeRequested && !autoPromptSentRef.current && session && !isSending) {
      autoPromptSentRef.current = true;
      if (turns.length === 0) {
        send('I want to build an app');
      }
    }
  }, [isUrlForgeRequested, session, turns.length, isSending, send]);

  // Same bargain the Scribe mount strikes: the studio needs the rail, so the
  // supporting panels fold away on arrival and the author's later toggles are
  // left alone until a genuinely new studio mounts.
  const collapsedForAppStudioMountRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasAppStudioActive || collapsedForAppStudioMountRef.current === (appStudioMountKey || 'url-forge')) return;
    collapsedForAppStudioMountRef.current = (appStudioMountKey || 'url-forge');
    setIsTabbedRailCollapsed(true);

    // Auto-select App Forge core squad: Knowledge/Analyst, Architect, Coder, Security, Evaluator/QA, and Copilot
    const forgeSquad = agents.filter(
      (a) =>
        /copilot/i.test(a.name) ||
        a.personaType === COPILOT_PERSONA_TYPE ||
        /architect/i.test(a.name) ||
        /architect/i.test(a.personaType ?? '') ||
        /analyst|knowledge/i.test(a.name) ||
        /analyst|knowledge/i.test(a.personaType ?? '') ||
        /developer|engineer|coder/i.test(a.name) ||
        /coder/i.test(a.personaType ?? '') ||
        /security|auditor/i.test(a.name) ||
        /security/i.test(a.personaType ?? '') ||
        /evaluator|critic|qa/i.test(a.name) ||
        /evaluator|qa/i.test(a.personaType ?? ''),
    );
    if (forgeSquad.length > 0) {
      const forgeSquadIds = forgeSquad.map((a) => a.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...forgeSquadIds])));
    }
  }, [hasAppStudioActive, appStudioMountKey, agents, setIsTabbedRailCollapsed, setSelectedIds]);

  const exitAppStudioToScaffold = useCallback(() => {
    setDismissedAppStudioKey(appStudioMountKey || 'url-forge');
    if (isChatCollapsed) setIsChatCollapsed(false);
  }, [isChatCollapsed, appStudioMountKey]);

  // Form Studio takes the rail the same way. Keyed by form, so applying a change to
  // the open form does not fold panels the author has since reopened.
  const collapsedForFormStudioRef = useRef<string | null>(null);
  const mountedFormId = formStudioMountKey?.split(':').pop() ?? null;
  useEffect(() => {
    if (!hasFormStudioActive || !mountedFormId || collapsedForFormStudioRef.current === mountedFormId) return;
    collapsedForFormStudioRef.current = mountedFormId;
    setIsTabbedRailCollapsed(true);
  }, [hasFormStudioActive, mountedFormId, setIsTabbedRailCollapsed]);

  const exitFormStudioToScaffold = useCallback(() => {
    setDismissedFormStudioKey(formStudioMountKey);
    if (isChatCollapsed) setIsChatCollapsed(false);
  }, [isChatCollapsed, formStudioMountKey]);

  /** Identity of the latest Media Studio mount, on the same terms as Scribe and Form Studio's, keyed by scene. */
  const mediaStudioMountKey = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const art = artifacts[j];
        const p = art.payload ?? {};
        if (
          art.tool === 'mount_media_studio' ||
          p.type === 'media_studio_pod'
        ) {
          return `${(turns[i] as any).id ?? i}:${(art as any).id ?? j}:${p.sceneId ?? 'scene'}`;
        }
      }
    }
    return null;
  }, [turns]);
  const [dismissedMediaStudioKey, setDismissedMediaStudioKey] = useState<string | null>(null);
  const hasMediaStudioActive = openMediaStudio || Boolean(mediaStudioMountKey && dismissedMediaStudioKey !== mediaStudioMountKey);

  // A shared Media Studio link (?studio=media&production=…) opens the studio in its room;
  // the studio itself goes to the tab, scene and shot the link names.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('studio') !== 'media') return;
      setMediaRoom(currentRoomKey);
      const production = Number(params.get('production'));
      if (Number.isInteger(production) && production > 0) setMediaProductionId(production);
    } catch {
      // No address to read.
    }
  }, [currentRoomKey]);

  // Auto-sync mediaProductionId from artifacts if not already set
  useEffect(() => {
    if (mediaProductionId) return;
    for (let i = turns.length - 1; i >= 0; i--) {
      for (const art of turns[i]?.artifacts ?? []) {
        const p = art?.payload ?? {};
        if ((art.tool === 'mount_media_studio' || p.type === 'media_studio_pod') && typeof p.productionId === 'number') {
          setMediaProductionId(p.productionId);
          return;
        }
      }
    }
  }, [turns, mediaProductionId]);

  const collapsedForMediaStudioRef = useRef<string | null>(null);
  const mountedSceneId = openMediaStudio ? 'selected' : mediaStudioMountKey?.split(':').pop() ?? null;
  useEffect(() => {
    if (!hasMediaStudioActive || !mountedSceneId || collapsedForMediaStudioRef.current === mountedSceneId) return;
    collapsedForMediaStudioRef.current = mountedSceneId;
    // Auto-fold the Assembly Stack rail when Media Studio mounts to give the storyboard breathing room
    setIsTabbedRailCollapsed(true);
    setIsMediaRailCollapsed(false);
  }, [hasMediaStudioActive, mountedSceneId, setIsTabbedRailCollapsed, setIsMediaRailCollapsed]);

  const exitMediaStudioToScaffold = useCallback(() => {
    setMediaRoom(null);
    if (mediaStudioMountKey) {
      setDismissedMediaStudioKey(mediaStudioMountKey);
    }
    if (isChatCollapsed) setIsChatCollapsed(false);
    setIsTabbedRailCollapsed(false);
  }, [isChatCollapsed, mediaStudioMountKey, setIsTabbedRailCollapsed]);

  /** Identity of the latest Project Studio mount, on the same terms as Media and Form Studio's */
  const projectStudioMountKey = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const art = artifacts[j];
        const p = art.payload ?? {};
        if (
          art.tool === 'mount_project_studio' ||
          p.type === 'project_studio_pod' ||
          p.module === 'ProjectStudioPod' ||
          p.component === 'ProjectStudioPod' ||
          ((art.tool === 'mount_builder_pod' || p.type === 'builder_pod' || p.type === 'assistant_app') &&
            (p.podComponent === 'ProjectPlanningPod' || p.podComponent === 'ProjectStudioPod' || p.component === 'ProjectStudioPod' || p.module === 'ProjectStudioPod'))
        ) {
          return `${(turns[i] as any).id ?? i}:${(art as any).id ?? j}:project_studio`;
        }
      }
    }
    return null;
  }, [turns]);
  const [dismissedProjectStudioKey, setDismissedProjectStudioKey] = useState<string | null>(null);
  const isUrlProjectRequested = typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('studio') === 'project' ||
     new URLSearchParams(window.location.search).get('studio') === 'project-studio' ||
     new URLSearchParams(window.location.search).get('mount') === 'project' ||
     new URLSearchParams(window.location.search).get('mount') === 'project-studio');

  const hasProjectStudioActive = Boolean(
    (openProjectStudio || isUrlProjectRequested || projectStudioMountKey) &&
    dismissedProjectStudioKey !== (projectStudioMountKey || 'url-project')
  );

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const studio = params.get('studio') || params.get('mount');
      if (studio !== 'project' && studio !== 'project-studio') return;
      setProjectRoom(currentRoomKey);
    } catch {
      // No address to read.
    }
  }, [currentRoomKey]);

  const collapsedForProjectStudioRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasProjectStudioActive || collapsedForProjectStudioRef.current === (projectStudioMountKey || 'url-project')) return;
    collapsedForProjectStudioRef.current = (projectStudioMountKey || 'url-project');
    setIsTabbedRailCollapsed(true);
  }, [hasProjectStudioActive, projectStudioMountKey, setIsTabbedRailCollapsed]);

  const exitProjectStudioToScaffold = useCallback(() => {
    setProjectRoom(null);
    if (projectStudioMountKey) {
      setDismissedProjectStudioKey(projectStudioMountKey);
    } else {
      setDismissedProjectStudioKey('url-project');
    }
    if (isChatCollapsed) setIsChatCollapsed(false);
    setIsTabbedRailCollapsed(false);
  }, [isChatCollapsed, projectStudioMountKey, setIsTabbedRailCollapsed]);

  /** Identity of the latest Computer Use Studio mount */
  const computerStudioMountKey = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const art = artifacts[j];
        const p = art.payload ?? {};
        if (
          art.tool === 'mount_computer_studio' ||
          p.type === 'computer_use_studio_pod' ||
          p.module === 'ComputerUseStudioPod' ||
          p.component === 'ComputerUseStudioPod' ||
          ((art.tool === 'mount_builder_pod' || p.type === 'builder_pod' || p.type === 'assistant_app') &&
            (p.podComponent === 'ComputerUseStudioPod' || p.component === 'ComputerUseStudioPod' || p.module === 'ComputerUseStudioPod'))
        ) {
          return `${(turns[i] as any).id ?? i}:${(art as any).id ?? j}:computer_studio`;
        }
      }
    }
    return null;
  }, [turns]);
  const [dismissedComputerStudioKey, setDismissedComputerStudioKey] = useState<string | null>(null);
  const isUrlComputerRequested = typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('studio') === 'computer' ||
     new URLSearchParams(window.location.search).get('studio') === 'computer-studio' ||
     new URLSearchParams(window.location.search).get('desktop') === 'computer' ||
     new URLSearchParams(window.location.search).get('mount') === 'computer' ||
     new URLSearchParams(window.location.search).get('mount') === 'computer-studio');

  const hasComputerStudioActive = Boolean(
    (openComputerStudio || isUrlComputerRequested || computerStudioMountKey) &&
    dismissedComputerStudioKey !== (computerStudioMountKey || 'url-computer')
  );
  if (computerStudioActiveRef) computerStudioActiveRef.current = hasComputerStudioActive;

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const studio = params.get('studio') || params.get('mount') || params.get('desktop');
      if (studio !== 'computer' && studio !== 'computer-studio' && studio !== 'desktop') return;
      setComputerRoom(currentRoomKey);
    } catch {
      // No address to read.
    }
  }, [currentRoomKey]);

  const exitComputerStudioToScaffold = useCallback(() => {
    setComputerRoom(null);
    if (computerStudioMountKey) {
      setDismissedComputerStudioKey(computerStudioMountKey);
    } else {
      setDismissedComputerStudioKey('url-computer');
    }
    if (isChatCollapsed) setIsChatCollapsed(false);
    setIsTabbedRailCollapsed(false);
  }, [isChatCollapsed, computerStudioMountKey, setIsTabbedRailCollapsed]);

  const collapsedForComputerStudioRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasComputerStudioActive || collapsedForComputerStudioRef.current === (computerStudioMountKey || 'url-computer')) return;
    collapsedForComputerStudioRef.current = (computerStudioMountKey || 'url-computer');
    setIsTabbedRailCollapsed(true);
  }, [hasComputerStudioActive, computerStudioMountKey, setIsTabbedRailCollapsed]);

  const agentStudioMountKey = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        if (artifacts[j].payload?.type === 'agent_studio_pod') return `${turns[i].id ?? i}:${j}:agent_studio`;
      }
    }
    return null;
  }, [turns]);
  const [dismissedAgentStudioKey, setDismissedAgentStudioKey] = useState<string | null>(null);
  const hasAgentStudioActive = Boolean(agentStudioMountKey && dismissedAgentStudioKey !== agentStudioMountKey);

  // Applying a draft posts a studio pod carrying the same proposalId — those ids are
  // how a proposal card that is still on screen knows it has already been used.
  // Keyed on content so the Set keeps its identity while turns stream in — every
  // memoized TurnRow receives it, and a new Set per turn would re-render them all.
  const appliedProposalKey = useMemo(() => {
    const applied = new Set<string>();
    for (const turn of turns) {
      for (const artifact of turn.artifacts ?? []) {
        const p = artifact?.payload as Record<string, unknown> | undefined;
        if (p?.type === 'agent_studio_pod' && typeof p.proposalId === 'string') applied.add(p.proposalId);
      }
    }
    return [...applied].join('\n');
  }, [turns]);
  const appliedAgentProposals = useMemo(
    () => new Set(appliedProposalKey ? appliedProposalKey.split('\n') : []),
    [appliedProposalKey],
  );

  const collapsedForAgentStudioRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasAgentStudioActive || collapsedForAgentStudioRef.current === agentStudioMountKey) return;
    collapsedForAgentStudioRef.current = agentStudioMountKey;
    setIsTabbedRailCollapsed(true);
  }, [hasAgentStudioActive, agentStudioMountKey, setIsTabbedRailCollapsed]);

  const exitAgentStudioToScaffold = useCallback(() => {
    setDismissedAgentStudioKey(agentStudioMountKey);
    setIsChatCollapsed(false);
    setIsTabbedRailCollapsed(false);
  }, [agentStudioMountKey, setIsTabbedRailCollapsed]);

  // Signal Studio
  const [signalRoom, setSignalRoom] = useState<string | null>(null);
  const openSignalStudio = signalRoom === currentRoomKey;

  const signalStudioMountKey = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const art = artifacts[j];
        const p = art.payload ?? {};
        if (
          art.tool === 'mount_signal_studio' ||
          p.type === 'signal_studio_pod' ||
          p.module === 'SignalStudioPod' ||
          p.component === 'SignalStudioPod' ||
          ((art.tool === 'render_app_surface' || art.tool === 'mount_builder_pod' || p.type === 'builder_pod' || p.type === 'assistant_app') &&
            (p.podComponent === 'SignalStudioPod' ||
             p.component === 'SignalStudioPod' ||
             p.module === 'SignalStudioPod' ||
             (typeof p.title === 'string' && /signal|spatial/i.test(p.title)) ||
             (typeof p.href === 'string' && /(?:signal|spatial)/i.test(p.href))))
        ) {
          return `${(turns[i] as any).id ?? i}:${(art as any).id ?? j}:signal_studio`;
        }
      }
    }
    return null;
  }, [turns]);

  const [dismissedSignalStudioKey, setDismissedSignalStudioKey] = useState<string | null>(null);
  const isUrlSignalRequested = typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('studio') === 'signal' ||
     new URLSearchParams(window.location.search).get('studio') === 'signals' ||
     new URLSearchParams(window.location.search).get('studio') === 'spatial' ||
     new URLSearchParams(window.location.search).get('mount') === 'signal' ||
     new URLSearchParams(window.location.search).get('mount') === 'signals' ||
     new URLSearchParams(window.location.search).get('mount') === 'spatial');

  const hasSignalStudioActive = Boolean(
    (openSignalStudio || isUrlSignalRequested || signalStudioMountKey) &&
    dismissedSignalStudioKey !== (signalStudioMountKey || 'url-signal')
  );

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const studio = params.get('studio') || params.get('mount');
      if (studio !== 'signal' && studio !== 'signals' && studio !== 'spatial') return;
      setSignalRoom(currentRoomKey);
    } catch {
      // No address to read.
    }
  }, [currentRoomKey]);

  const collapsedForSignalStudioRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasSignalStudioActive || collapsedForSignalStudioRef.current === (signalStudioMountKey || 'url-signal')) return;
    collapsedForSignalStudioRef.current = (signalStudioMountKey || 'url-signal');
    setIsTabbedRailCollapsed(true);
  }, [hasSignalStudioActive, signalStudioMountKey, setIsTabbedRailCollapsed]);

  const exitSignalStudioToScaffold = useCallback(() => {
    setSignalRoom(null);
    if (signalStudioMountKey) {
      setDismissedSignalStudioKey(signalStudioMountKey);
    } else {
      setDismissedSignalStudioKey('url-signal');
    }
    if (isChatCollapsed) setIsChatCollapsed(false);
    setIsTabbedRailCollapsed(false);
  }, [isChatCollapsed, signalStudioMountKey, setIsTabbedRailCollapsed]);

  // Flow Studio
  const flowStudioMountKey = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const art = artifacts[j];
        const p = art.payload ?? {};
        if (
          art.tool === 'mount_flow_studio' ||
          p.type === 'flow_studio_pod' ||
          p.module === 'FlowStudioPod' ||
          p.component === 'FlowStudioPod' ||
          p.podComponent === 'FlowStudioPod' ||
          p.type === 'flow_create_proposal'
        ) {
          return `${(turns[i] as any).id ?? i}:${(art as any).id ?? j}:flow_studio`;
        }
      }
    }
    return null;
  }, [turns]);

  const [dismissedFlowStudioKey, setDismissedFlowStudioKey] = useState<string | null>(null);
  const isUrlFlowRequested = typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('studio') === 'flow' ||
     new URLSearchParams(window.location.search).get('studio') === 'flow-studio' ||
     new URLSearchParams(window.location.search).get('studio') === 'pipeline' ||
     new URLSearchParams(window.location.search).get('mount') === 'flow' ||
     new URLSearchParams(window.location.search).get('mount') === 'flow-studio');

  const hasFlowStudioActive = Boolean(
    (isUrlFlowRequested || flowStudioMountKey) &&
    dismissedFlowStudioKey !== (flowStudioMountKey || 'url-flow')
  );

  const collapsedForFlowStudioRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasFlowStudioActive || collapsedForFlowStudioRef.current === (flowStudioMountKey || 'url-flow')) return;
    collapsedForFlowStudioRef.current = (flowStudioMountKey || 'url-flow');
    setIsTabbedRailCollapsed(true);
  }, [hasFlowStudioActive, flowStudioMountKey, setIsTabbedRailCollapsed]);

  const exitFlowStudioToScaffold = useCallback(() => {
    if (flowStudioMountKey) {
      setDismissedFlowStudioKey(flowStudioMountKey);
    } else {
      setDismissedFlowStudioKey('url-flow');
    }
    if (isChatCollapsed) setIsChatCollapsed(false);
    setIsTabbedRailCollapsed(false);
  }, [isChatCollapsed, flowStudioMountKey, setIsTabbedRailCollapsed]);

  // Prediction Studio
  const predictionStudioMountKey = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = turns[i].artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const art = artifacts[j];
        const p = art?.payload ?? {};
        if (
          art?.tool === 'mount_prediction_studio' ||
          p.type === 'prediction_studio_pod' ||
          p.module === 'PredictionStudioPod' ||
          p.component === 'PredictionStudioPod' ||
          p.podComponent === 'PredictionStudioPod'
        ) {
          return `${(turns[i] as any).id ?? i}:${(art as any).id ?? j}:prediction_studio`;
        }
      }
    }
    return null;
  }, [turns]);

  const [dismissedPredictionStudioKey, setDismissedPredictionStudioKey] = useState<string | null>(null);
  const isUrlPredictionRequested = typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('studio') === 'prediction' ||
     new URLSearchParams(window.location.search).get('studio') === 'prediction-studio' ||
     new URLSearchParams(window.location.search).get('mount') === 'prediction' ||
     new URLSearchParams(window.location.search).get('mount') === 'prediction-studio');

  const hasPredictionStudioActive = Boolean(
    (isUrlPredictionRequested || predictionStudioMountKey) &&
    dismissedPredictionStudioKey !== (predictionStudioMountKey || 'url-prediction')
  );

  const collapsedForPredictionStudioRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasPredictionStudioActive || collapsedForPredictionStudioRef.current === (predictionStudioMountKey || 'url-prediction')) return;
    collapsedForPredictionStudioRef.current = (predictionStudioMountKey || 'url-prediction');
    setIsTabbedRailCollapsed(true);
  }, [hasPredictionStudioActive, predictionStudioMountKey, setIsTabbedRailCollapsed]);

  const exitPredictionStudioToScaffold = useCallback(() => {
    if (predictionStudioMountKey) {
      setDismissedPredictionStudioKey(predictionStudioMountKey);
    } else {
      setDismissedPredictionStudioKey('url-prediction');
    }
    if (isChatCollapsed) setIsChatCollapsed(false);
    setIsTabbedRailCollapsed(false);
  }, [isChatCollapsed, predictionStudioMountKey, setIsTabbedRailCollapsed]);

  // Reset local dismissal state when switching rooms
  useEffect(() => {
    setDismissedScribeKey(null);
    setDismissedAppStudioKey(null);
    setDismissedFormStudioKey(null);
    setDismissedMediaStudioKey(null);
    setDismissedProjectStudioKey(null);
    setDismissedComputerStudioKey(null);
    setDismissedAgentStudioKey(null);
    setDismissedSignalStudioKey(null);
    setDismissedFlowStudioKey(null);
    setDismissedPredictionStudioKey(null);
    setSelectedAssemblyUnit(null);
    setComposerDraft('');
  }, [currentRoomKey]);

  const activeStudioKind = useMemo<StudioSurfaceKind | null>(() => {
    const activeByKind: Record<StudioSurfaceKind, boolean> = {
      scribe: hasScribeActive,
      app: hasAppStudioActive,
      form: hasFormStudioActive,
      media: hasMediaStudioActive,
      project: hasProjectStudioActive,
      computer: hasComputerStudioActive,
      signal: hasSignalStudioActive,
      agent: hasAgentStudioActive,
      flow: hasFlowStudioActive,
      prediction: hasPredictionStudioActive,
    };
    const candidates: Array<{ kind: StudioSurfaceKind; turnIndex: number }> = [];

    if (hasMediaStudioActive && openMediaStudio) candidates.push({ kind: 'media', turnIndex: Infinity });
    if (hasAppStudioActive && isUrlStudioRequested) candidates.push({ kind: 'app', turnIndex: Infinity });
    if (hasProjectStudioActive && (openProjectStudio || isUrlProjectRequested)) candidates.push({ kind: 'project', turnIndex: Infinity });
    if (hasComputerStudioActive && (openComputerStudio || isUrlComputerRequested)) candidates.push({ kind: 'computer', turnIndex: Infinity });
    if (hasSignalStudioActive && (openSignalStudio || isUrlSignalRequested)) candidates.push({ kind: 'signal', turnIndex: Infinity });
    if (hasFlowStudioActive && isUrlFlowRequested) candidates.push({ kind: 'flow', turnIndex: Infinity });
    if (hasPredictionStudioActive && isUrlPredictionRequested) candidates.push({ kind: 'prediction', turnIndex: Infinity });

    turns.forEach((turn, turnIndex) => {
      for (const artifact of turn.artifacts ?? []) {
        const kind = studioSurfaceKind(artifact);
        if (kind && activeByKind[kind]) candidates.push({ kind, turnIndex });
      }
    });

    if (candidates.length === 0) return null;
    const latestTurnIndex = Math.max(...candidates.map((candidate) => candidate.turnIndex));
    return STUDIO_TIE_PRIORITY.find((kind) =>
      candidates.some((candidate) => candidate.kind === kind && candidate.turnIndex === latestTurnIndex)
    ) ?? null;
  }, [
    turns,
    hasScribeActive,
    hasAppStudioActive,
    hasFormStudioActive,
    hasMediaStudioActive,
    hasProjectStudioActive,
    hasComputerStudioActive,
    hasSignalStudioActive,
    hasAgentStudioActive,
    hasFlowStudioActive,
    hasPredictionStudioActive,
    openMediaStudio,
    isUrlStudioRequested,
    openProjectStudio,
    isUrlProjectRequested,
    openComputerStudio,
    isUrlComputerRequested,
    openSignalStudio,
    isUrlSignalRequested,
    isUrlFlowRequested,
    isUrlPredictionRequested,
  ]);

  /**
   * Any studio holding the rail.
   *
   * The rail's width, focus and panel-hiding rules are about a studio being on
   * screen, not about which one — so they key off this rather than off Scribe.
   * `hasScribeActive` stays for the genuinely Scribe-specific affordances, like
   * offering a transcript paragraph as a draft insert.
   */
  const hasStudioActive =
    hasScribeActive ||
    hasAppStudioActive ||
    hasFormStudioActive ||
    hasMediaStudioActive ||
    hasProjectStudioActive ||
    hasComputerStudioActive ||
    hasSignalStudioActive ||
    hasAgentStudioActive ||
    hasFlowStudioActive ||
    hasPredictionStudioActive;

  return {
    selectedAssemblyUnit,
    setSelectedAssemblyUnit,
    composerDraft,
    setComposerDraft,
    isChatCollapsed,
    setIsChatCollapsed,
    activeStudioKind,
    hasStudioActive,
    hasScribeActive,
    manuscriptRailTarget,
    setManuscriptRailTarget,
    exitScribeToScaffold,
    hasAppStudioActive,
    exitAppStudioToScaffold,
    hasFormStudioActive,
    exitFormStudioToScaffold,
    hasFlowStudioActive,
    exitFlowStudioToScaffold,
    hasPredictionStudioActive,
    exitPredictionStudioToScaffold,
    hasMediaStudioActive,
    openMediaStudio,
    mediaProductionId,
    setMediaProductionId,
    exitMediaStudioToScaffold,
    hasProjectStudioActive,
    openProjectStudio,
    exitProjectStudioToScaffold,
    hasComputerStudioActive,
    openComputerStudio,
    exitComputerStudioToScaffold,
    hasSignalStudioActive,
    openSignalStudio,
    exitSignalStudioToScaffold,
    hasAgentStudioActive,
    appliedAgentProposals,
    exitAgentStudioToScaffold,
  };
}
