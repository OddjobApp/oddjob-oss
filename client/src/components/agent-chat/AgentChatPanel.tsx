import { CrewContextTray } from './CrewContextTray';
import { GoogleWorkspaceIcon } from './GoogleWorkspaceIcon';
import { activeAgentSelectionKey, loadActiveAgentSelection } from './active-agent-selection';
import type { SelectedWorkspaceItem, WorkspaceContextRef } from '@shared/crew-workspace-results';
/**
 * CREW Room — multi-agent group chat.
 *
 * Layout: transcript on the left, Supervisor and Blackboard columns on the right.
 *
 * Several agents are added to one room and reply to each other; the user is a
 * participant; the Supervisor speaks into the discussion (addressing agents by
 * @mention) while also keeping the panels — critique, consensus, summary, notes,
 * identified intents and plans.
 *
 * Agents speak with their own Legend + OCEAN personality and draw on the
 * knowledge graph they accumulated as workers; both are applied server-side.
 *
 * Visual language follows the app: rounded-[2rem] glass cards over
 * bg-card/80 + backdrop-blur, shadow-soft, semantic colour scales, and
 * theme-aware borders so light mode holds up.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { apiRequest, resolveActiveOrgId } from '@/lib/queryClient';
import { useCrewSession } from './useCrewSession';
import {
  crewHandoffStorageKey,
  formatCopilotCrewHandoff,
  type CopilotCrewHandoff,
} from '@/lib/copilot-crew-handoff';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import React from 'react';
import { CrewPlaybookLauncher, summarizePodPayload } from './CrewPlaybookLauncher';
export { summarizePodPayload };
import { isCopilotCard } from './CrewRoster';
import { TurnRow } from './TurnRow';
import { createDefaultDeckAst } from './deck-fallback-ast';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { AssemblyUnitSelection } from './ModularAssemblyPuzzleRail';
import { ExecutivePresentationModal } from './ExecutivePresentationModal';
import { useChatPaneResize } from './useChatPaneResize';
import { ChatPaneResizeHandle } from './ChatPaneResizeHandle';
import { CrewBottomActions } from './CrewBottomActions';
export { __assemblyHudTestHooks } from './SelectedWorkstreamContextHUD';
import { CrewAttachmentBar } from './CrewAttachmentBar';
import { Composer } from './CrewComposer';
import type { CrewOutputIntent } from '@shared/crew-output-intent';
import { CrewHeaderBar } from './CrewHeaderBar';
import { BlueprintStudioLauncher, blueprintSurfaces, matchCycleFleetApp, cycleAppFromLaunchRef, type CycleAppMountRef } from './BlueprintStudioLauncher';
import { CrewSurfaceConnections } from './CrewSurfaceConnections';
import type { CrewAppSurface } from '@shared/crew-surface-connections';
import { CrewAppActivityFeed } from './CrewAppActivityFeed';
import { CrewSurfaceRequestCard, type PendingSurfaceRequest } from './CrewSurfaceRequestCard';
import { mergeCrewAppActivity, type CrewAppActivity } from './crew-app-activity';
import { CrewRoomWorkspace } from './CrewRoomWorkspace';
import type { CrewRoomBrief } from '@shared/crew-room-brief';
import { CrewCycleAppCanvas, type CycleFleetApp } from './CrewCycleAppCanvas';
import { CrewRightRailPortal } from './CrewRightRailPortal';
import { AgoraDeliberationBriefing } from './AgoraDeliberationBriefing';
import { useCrewStudios } from './useCrewStudios';
import { CrewTopBanners } from './CrewTopBanners';
import { CrewRaisedHandsBar } from './CrewRaisedHandsBar';
import { CrewDeliberationPulseBar } from './CrewDeliberationPulseBar';
import { CrewTranscriptScrubber } from './CrewTranscriptScrubber';
import {
  MessageSquare,
  PanelLeftOpen,
  Hash,
  X,
} from 'lucide-react';
import { crewSendErrorMessage } from './crew-send-error';

/**
 * Turn count above which the transcript is windowed.
 *
 * A long deliberation renders markdown, tool pills, proposal cards and map pods
 * per turn, and a couple of hundred of them is tens of thousands of nodes.
 * Below this, every turn stays mounted: rows keep local state (expanded tool
 * pills, a map's camera) that windowing would discard on scroll, and jsdom has
 * no layout, so a windowed list renders nothing in tests.
 */
export const VIRTUALIZE_TURNS_AFTER = 40;


// ============================================================================
// TYPES
// ============================================================================

import { type TopicArchetype, DEFAULT_TOPIC_ARCHETYPES } from './crew-topic-archetypes';
export { type TopicArchetype, DEFAULT_TOPIC_ARCHETYPES };



/**
 * Reconcile the primers payload against the local playbooks.
 *
 * A card whose `podComponent` is absent is not a degraded card, it is a dead
 * one: it mounts `Component "undefined" isn't available to render.` and the user
 * has no way back except closing the surface. So an entry that arrives without
 * one is backfilled from the local copy by id, and an entry we cannot resolve at
 * all is dropped rather than shown as a button that goes nowhere.
 *
 * Returns null when nothing survives, so the caller can keep its own defaults.
 */
const EXCLUDED_PLAYBOOK_IDS = new Set([
  'workstreams_pipeline',
  'governance_audit',
  'incident_remediation',
  'ontology_relationships',
  'ontology_object_types',
  'ontology_actions',
  'datasets_schema',
]);

export function reconcileTopicArchetypes(
  incoming: unknown,
  defaults: TopicArchetype[] = DEFAULT_TOPIC_ARCHETYPES,
): TopicArchetype[] | null {
  if (!Array.isArray(incoming)) return null;

  const byId = new Map(defaults.map((d) => [d.id, d]));
  const resolved = incoming
    .filter((t): t is TopicArchetype => !!t && typeof t === 'object' && typeof (t as any).id === 'string' && !EXCLUDED_PLAYBOOK_IDS.has((t as any).id))
    .map((t) => (t.podComponent ? t : { ...t, podComponent: byId.get(t.id)?.podComponent ?? '' }))
    .filter((t) => !!t.podComponent);

  return resolved.length > 0 ? resolved : null;
}

export interface AgentCard {
  id: number;
  name: string;
  description: string;
  personaType: string;
  capabilities: string[];
  soulArchetype: string | null;
  legend: string | null;
  enabled: boolean;
  /** Learned classifier-category affinities + declared-label affinities. */
  topicAffinities?: string[];
  topicLabelAffinities?: Array<{ label: string; count: number }>;
}

export interface CrewTurn {
  id: number;
  speakerType: 'user' | 'agent' | 'supervisor';
  speakerName: string;
  userId: string | null;
  content: string;
  round: number;
  agentCardId: number | null;
  inReplyToTurnId: number | null;
  topic: string | null;
  intent: string | null;
  latencyMs: number | null;
  resolvedModelId?: string | null;
  /** What actually served the turn — under provider failover this differs from resolvedModelId. */
  servedModel?: string | null;
  servedProvider?: string | null;
  wasFallback?: boolean;
  toolsUsed: Array<{ name: string; ok: boolean; ms: number; error?: string }>;
  artifacts: Array<{ tool: string; payload: Record<string, any> }>;
}

// Tools whose artifact means the room is waiting on a human decision. Keep this in
// step with the crew tool allowlist — a gate tool missing here shows no banner.
const GATE_ARTIFACT_TOOLS = new Set(['request_human_input']);

export {
  type StudioSurfaceKind,
  STUDIO_TIE_PRIORITY,
  studioSurfaceKind,
} from './useCrewStudios';

export interface CrewPlan {
  id: number;
  title: string;
  steps: Array<{ order: number; description: string; owner?: string }>;
  status: string;
}

/**
 * A note the supervisor left on a round. Declared here with the room's other
 * shapes now that the panel it used to live in is gone.
 */
export interface SupervisorNote {
  id: number;
  noteType: 'note' | 'critique' | 'consensus' | 'summary' | 'intent';
  content: string;
  round?: number;
  targetTurnId?: number | null;
  createdAt?: string;
}

export interface CrewSession {
  id: number;
  sessionKey: string;
  organizationId?: number | null;
  title: string | null;
  activeTopic: string | null;
  nextSteps: string | null;
  consensusLevel: number | null;
  projectId: number | null;
  mode: 'explore' | 'decide' | 'build' | 'investigate' | 'operate' | 'review';
  /** 'archived' once the room is concluded. Set by the archive route. */
  status?: string | null;
  /** The room owner's user id — decides pending agent tags. */
  createdBy?: string | null;
  memory: { roomBrief?: CrewRoomBrief; facts: string[]; hypotheses: string[]; openQuestions: string[]; constraints: string[]; ontologyRefs: any[]; updatedRound: number; /** When true, agent-declared topic tags await the room owner's decision. */ agentTagApproval?: boolean };
}

/**
 * A declared-topic tag row (crew_turn_topics): what a speaker tagged a turn
 * with, bound to a knowledge_topics row when one resolved.
 */
export interface CrewTurnTopic {
  id: number;
  sessionId: number;
  turnId: number;
  organizationId: number;
  round: number;
  topicId: number | null;
  label: string;
  rawLabel: string;
  source: 'user' | 'agent' | 'supervisor' | 'system';
  /** 'pending' agent tags await the room owner's decision (agentTagApproval). */
  status: 'applied' | 'pending' | 'rejected';
  createdAt?: string;
}

export interface CrewDecision { id: number; statement: string; rationale: string | null; status: string; confidence: number | null; }
export interface CrewClaim { id: number; claim: string; status: string; confidence: number | null; agreementLevel: number | null; evidence: Array<{ label: string; uri?: string }>; positions: Array<{ agent: string; stance: 'support' | 'dissent'; confidence: number; proposition: string }>; }
export interface CrewCommitment { id: number; title: string; detail: string | null; ownerType: string; ownerId: string | null; dueAt: string | null; status: string; }

export interface CrewIssue {
  id: number;
  title: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
  consensusLevel: number | null;
  status: string;
}

/** A human in the room. */
export interface Participant {
  userId: string;
  username: string;
  displayName: string;
  role: 'owner' | 'member';
}

/** A member who did not speak but signalled it has something to contribute. */
export interface RaisedHand {
  agentCardId: number;
  agentName: string;
  reason: string;
  memoryHits: number;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * The room key identifies a shared room, so it comes from the URL — it used to
 * live in sessionStorage, which made every room per-browser and meant two people
 * could never reach the same one. A room opened without a key mints one and
 * rewrites the URL so it can be shared.
 */
function resolveRoomKey(fromRoute?: string): string {
  if (fromRoute) return fromRoute;
  if (typeof window !== 'undefined') {
    const match = window.location.pathname.match(/\/workspace\/chat\/([^/?#]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return `crew-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}



// ============================================================================
// MAIN
// ============================================================================

export function AgentChatPanel({
  className,
  roomKey,
}: { className?: string; roomKey?: string } = {}) {
  const currentRoomKey = resolveRoomKey(roomKey);

  const [workspaceItems, setWorkspaceItems] = useState<SelectedWorkspaceItem[]>([]);
  const [notificationHandoff, setNotificationHandoff] = useState<{ title?: string; reason?: string; loading?: boolean; error?: string } | null>(null);
  const [notificationRetry, setNotificationRetry] = useState(0);
  const loadedNotification = useRef('');
  const workspaceItemsRef = useRef<SelectedWorkspaceItem[]>([]);
  useEffect(() => { workspaceItemsRef.current = workspaceItems; }, [workspaceItems]);
  const selectWorkspaceItems = (items: SelectedWorkspaceItem[], tool: string, turnId: number, visibleIds: string[], resultIndex = 0) => setWorkspaceItems(previous => [...previous.filter(i => i.tool !== tool || i.turnId !== turnId || (i.resultIndex ?? 0) !== resultIndex || !visibleIds.includes(i.itemId)), ...items].slice(0, 20));
  const discussWorkspaceItems = (items: SelectedWorkspaceItem[], action: 'discuss' | 'respond' | 'summarize') => { setWorkspaceItems(items); setComposerDraft(action === 'summarize' ? 'Read the selected emails and provide a concise summary of each, highlighting requests, deadlines, and suggested next steps. Do not send or modify anything.' : action === 'discuss' ? 'Discuss the selected items.' : items.every(i => i.item.kind === 'email') ? 'Read the selected emails and draft replies for my review. Do not send them.' : items.every(i => i.item.kind === 'flight') ? 'Book the selected flight on FlightHub. Call flighthub_propose_booking with the session_id (sessionRef) and offer_ref (offerRef) carried in the selected item context, summarizing the itinerary on the proposal card. Stop for me at the payment step.' : 'Review the selected items and prepare any suggested responses or changes for my approval.'); };
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const selectedAgentIdsRef = useRef<number[]>([]);
  const selectionScopeRef = useRef<{ key: string; roomKey: string; serverReady: boolean } | null>(null);
  const explicitAgentSelectionRef = useRef(false);
  const selectionSaveQueue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => { selectedAgentIdsRef.current = selectedIds; }, [selectedIds]);
  const [recordKind, setRecordKind] = useState<'decision' | 'claim' | 'commitment'>('decision');
  const [recordText, setRecordText] = useState('');
  const [recordSaving, setRecordSaving] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteValue, setInviteValue] = useState('');
  const [copied, setCopied] = useState(false);
  const [cycleContext, setCycleContext] = useState<{
    cycleSlug?: string;
    cycleName?: string;
    stageId?: string;
    stageName?: string;
  } | null>(null);
  const [topicArchetypes, setTopicArchetypes] = useState<TopicArchetype[]>(DEFAULT_TOPIC_ARCHETYPES);
  const [activeIntakeTopic, setActiveIntakeTopic] = useState<TopicArchetype | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [queuedRequests, setQueuedRequests] = useState<Array<{
    id: number; roomKey: string; message: string; options?: { outputIntent?: CrewOutputIntent };
    agentCardIds: number[]; selectedContext: Array<{ turnId: number; tool: string; itemId: string }>;
    mountedApp?: { path: string; selectedRecord?: { collection: string; recordId: string } } | null;
  }>>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const queueId = useRef(0);
  useEffect(() => { setQueuedRequests([]); setQueuePaused(false); }, [currentRoomKey]);
  const [isTabbedRailCollapsed, setIsTabbedRailCollapsed] = useState(false);
  const [isCyclePipelineCollapsed, setIsCyclePipelineCollapsed] = useState(false);
  const [isMediaRailCollapsed, setIsMediaRailCollapsed] = useState(false);
  const [railTop, setRailTop] = useState(0);

  const {
    turns,
    workProductTurns,
    setTurns,
    notes,
    plans,
    issues,
    decisions,
    claims,
    commitments,
    turnTopics,
    raisedHands,
    dismissedHands,
    setDismissedHands,
    participants,
    setParticipants,
    currentUserId,
    session,
    setSession,
    isLoading,
    setIsLoading,
    connectionLost,
    awaitingFirstTurn,
    setAwaitingFirstTurn,
    isConcluding,
    isReopening,
    isConcludeDialogOpen,
    setIsConcludeDialogOpen,
    error,
    setError,
    breakoutLineage,
    cycleFleetData,
    fetchRoom,
    applyRoom,
    appendTurn,
    fetchBreakouts,
    fetchCycleFleet,
    handleConcludeMeeting,
    confirmConcludeMeeting,
    handleReopenMeeting,
    changeRoomMode,
    saveRoomBrief,
    saveWorkProduct,
    createStructuredRecord,
    updateStructuredRecord,
  } = useCrewSession({
    roomKey: currentRoomKey,
    onMembersDiscovered: useCallback((incomingMembers: AgentCard[]) => {
      setAgents((prev) => {
        const existingIds = new Set(prev.map((a) => a.id));
        const newAgents = incomingMembers.filter((m) => !existingIds.has(m.id));
        return newAgents.length > 0 ? [...prev, ...newAgents] : prev;
      });
      setSelectedIds((prev) => {
        if (explicitAgentSelectionRef.current) return prev;
        const memberIds = incomingMembers.map((m) => m.id);
        const combined = Array.from(new Set([...prev, ...memberIds]));
        return combined.length !== prev.length ? combined : prev;
      });
    }, []),
  });

  // A turn is gating only if it actually carries a gate artifact.
  //
  // This used to substring-match the prose ('Attestation', 'gated', 'Signature',
  // …), which is wrong in both directions: any agent that merely *discusses* a
  // signature flipped the banner on, and a real gate whose wording differed was
  // missed. Governance state has to come from the structured payload, never from
  // sniffing what the model happened to write.
  const pendingAttestation = useMemo(() => {
    return (
      turns.find((turn) =>
        turn.artifacts?.some((artifact) => GATE_ARTIFACT_TOOLS.has(artifact.tool)),
      ) ?? null
    );
  }, [turns]);
  // Declared-topic tags grouped by turn for chip rendering. turnTopics only
  // grows when a tagged turn lands — the map values are fresh arrays then, so
  // only tagged rows see a prop change.
  const topicsByTurnId = useMemo(() => {
    const map = new Map<number, CrewTurnTopic[]>();
    for (const t of turnTopics) {
      const list = map.get(t.turnId);
      if (list) list.push(t);
      else map.set(t.turnId, [t]);
    }
    return map;
  }, [turnTopics]);
  // Distinct labels for the composer's # lookup — this room's vocabulary first.
  const recentTopicLabels = useMemo(
    () => [...new Set(turnTopics.map((t) => t.label))],
    [turnTopics]
  );

  // The topic rail: distinct declared labels with turn counts. Clicking one
  // narrows the transcript to turns that declared it; ?topic= makes a
  // filtered view shareable. Read once — a room switch clears it below.
  const [topicFilter, setTopicFilter] = useState<string | null>(() =>
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('topic')
      : null,
  );
  const toggleTopicFilter = useCallback((label: string | null) => {
    setTopicFilter(label);
    try {
      const url = new URL(window.location.href);
      if (label) url.searchParams.set('topic', label);
      else url.searchParams.delete('topic');
      window.history.replaceState(null, '', url);
    } catch { /* sharing is a bonus; the filter itself is local */ }
  }, []);
  const topicCloud = useMemo(() => {
    const map = new Map<string, { label: string; count: number; pending: number }>();
    for (const t of turnTopics) {
      if (t.status === 'rejected') continue;
      const entry = map.get(t.label) ?? { label: t.label, count: 0, pending: 0 };
      entry.count += 1;
      if (t.status === 'pending') entry.pending += 1;
      map.set(t.label, entry);
    }
    return [...map.values()];
  }, [turnTopics]);

  // Room owner (server also permits org/super admins): decides 'pending'
  // agent tags and controls the agentTagApproval room setting.
  const canDecideTopics = Boolean(
    session?.createdBy != null && currentUserId != null && String(session.createdBy) === String(currentUserId),
  );
  const agentTagApproval = session?.memory?.agentTagApproval === true;
  const toggleAgentTagApproval = useCallback(async () => {
    const next = !agentTagApproval;
    if (session) setSession({ ...session, memory: { ...session.memory, agentTagApproval: next } });
    try {
      await apiRequest('PATCH', `/api/crew/${encodeURIComponent(currentRoomKey)}/state`, { agentTagApproval: next });
    } catch { /* the next room refresh restores the true value */ }
  }, [agentTagApproval, session, setSession, currentRoomKey]);
  const decideTopic = useCallback(async (turnTopicId: number, status: 'applied' | 'rejected') => {
    try {
      await apiRequest('POST', `/api/crew/${encodeURIComponent(currentRoomKey)}/topics/${turnTopicId}/decision`, { status });
      applyRoom(await fetchRoom());
    } catch { /* the next refresh reconciles */ }
  }, [currentRoomKey, applyRoom, fetchRoom]);
  const visibleTurns = useMemo(
    () => (topicFilter
      ? turns.filter((t) => (topicsByTurnId.get(t.id) ?? []).some((tt) => tt.label === topicFilter))
      : turns),
    [turns, topicFilter, topicsByTurnId],
  );

  const [handoffDraft] = useState(() => {
    if (!roomKey) return '';
    const key = crewHandoffStorageKey(roomKey);
    const stored = sessionStorage.getItem(key);
    if (!stored) return '';
    sessionStorage.removeItem(key);
    try {
      return formatCopilotCrewHandoff(JSON.parse(stored) as CopilotCrewHandoff);
    } catch {
      return '';
    }
  });


  useEffect(() => { setWorkspaceItems([]); workspaceItemsRef.current = []; setNotificationHandoff(null); loadedNotification.current = ''; }, [currentRoomKey]);
  // Deep-link ?topic= survives the first mount (the ref starts at the initial
  // key), then switching rooms clears it — a tag from another room should not
  // hold the new transcript hostage to an empty filter.
  const topicRoomRef = useRef(currentRoomKey);
  useEffect(() => {
    if (topicRoomRef.current !== currentRoomKey) {
      topicRoomRef.current = currentRoomKey;
      setTopicFilter(null);
    }
  }, [currentRoomKey]);
  const sessionId = useRef<string>(currentRoomKey);
  if (sessionId.current !== currentRoomKey) {
    sessionId.current = currentRoomKey;
  }
  const [roomAttachments, setRoomAttachments] = useState<Array<Record<string, any>>>([]);
  const [attachmentControl, setAttachmentControl] = useState<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  // Cursor for delta fetches: the highest REAL turn id this client holds.
  const lastSeenTurnId = useRef<number>(0);
  // Lets the Cancel button abort the in-flight round request.
  const sendAbortRef = useRef<AbortController | null>(null);
  const computerStudioActiveRef = useRef(false);
  const activeStudioRef = useRef<string | null>(null);
  const initialStudioParamRef = useRef<string | null>(
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('studio') || new URLSearchParams(window.location.search).get('mount') || null)
      : null
  );

  // Deep-link re-engagement: highlight target turn when arriving via intervention notification
  const [highlightedTurnId, setHighlightedTurnId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const param = new URLSearchParams(window.location.search).get('highlightTurn');
      const parsed = param ? parseInt(param, 10) : NaN;
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } catch {
      return null;
    }
  });

  const [transcriptEl, setTranscriptEl] = useState<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const virtualizeTurns = turns.length > VIRTUALIZE_TURNS_AFTER;

  useEffect(() => {
    if (!highlightedTurnId) return;
    const el = document.getElementById(`turn-${highlightedTurnId}`);
    if (el && transcriptEl?.contains(el)) {
      const target = el.getBoundingClientRect();
      const viewport = transcriptEl.getBoundingClientRect();
      transcriptEl.scrollTo({ top: transcriptEl.scrollTop + target.top - viewport.top - (transcriptEl.clientHeight - target.height) / 2, behavior: 'smooth' });
    } else {
      // A windowed transcript has not mounted a turn that is off screen, so
      // there is no element to find; scroll the list to it instead.
      const index = virtualizeTurns ? turns.findIndex((t) => t.id === highlightedTurnId) : -1;
      if (index < 0 || !virtuosoRef.current) return;
      virtuosoRef.current.scrollToIndex({ index, align: 'center' });
    }
    const timer = setTimeout(() => setHighlightedTurnId(null), 8000);
    return () => clearTimeout(timer);
  }, [highlightedTurnId, turns, virtualizeTurns, transcriptEl]);

  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const appStudioOrgId = session ? session.organizationId : resolveActiveOrgId();
  const [activeAppSurface, setActiveAppSurface] = useState<CrewAppSurface | null>(null);
  const mountedAppRef = useRef<{ path: string; selectedRecord?: { collection: string; recordId: string } } | null>(null);
  useEffect(() => {
    mountedAppRef.current = isCanvasOpen && activeAppSurface
      ? { path: activeAppSurface.path, ...(activeAppSurface.selectedRecord ? { selectedRecord: activeAppSurface.selectedRecord } : {}) }
      : null;
  }, [isCanvasOpen, activeAppSurface, currentRoomKey]);
  useEffect(() => { setActiveAppSurface(null); }, [currentRoomKey]);
  const [isAppStudioFullscreen, setIsAppStudioFullscreen] = useState(false);
  const [activeCanvasAppId, setActiveCanvasAppId] = useState<number | null>(null);
  const [blueprintStudioApps, setBlueprintStudioApps] = useState<CycleFleetApp[]>([]);
  const [appActivity, setAppActivity] = useState<CrewAppActivity | null>(null);
  const [surfaceRequests, setSurfaceRequests] = useState<PendingSurfaceRequest[]>([]);
  useEffect(() => { setSurfaceRequests([]); }, [currentRoomKey, activeCanvasAppId, isCanvasOpen]);
  const receiveSurfaceRequest = useCallback((request: PendingSurfaceRequest) => {
    setSurfaceRequests(previous => [...previous, request].slice(-20));
    setIsChatCollapsed(false);
  }, []);
  useEffect(() => { setAppActivity(null); }, [currentRoomKey, appStudioOrgId]);
  const receiveAppActivity = useCallback((activity: CrewAppActivity) => {
    setAppActivity((previous) => ({ ...activity, events: mergeCrewAppActivity(previous?.appTitle === activity.appTitle ? previous.events : [], activity.events) }));
  }, []);
  useEffect(() => { setBlueprintStudioApps([]); }, [currentRoomKey, appStudioOrgId]);

  /**
   * Open an installed app deployment in the App Studio canvas.
   *
   * Reached two ways: a render_app_surface artifact marked
   * studioSurface: 'cycle_canvas' (the tool resolved the target against this
   * org's deployments), and the launch card's "Open in App Studio" button,
   * which re-mounts the same surface through the 'crew-cycle-app:open' event.
   * Either way the canvas gets the full crewRoom binding — the transcript
   * iframe a bare embed produces has none of it.
   */
  const openCycleAppCanvas = useCallback(async (detail: CycleAppMountRef) => {
    let apps = blueprintStudioApps.length ? blueprintStudioApps : (cycleFleetData?.apps ?? []);
    let target = matchCycleFleetApp(apps, detail);
    if (!target && appStudioOrgId != null) {
      try {
        const res = await apiRequest('GET', `/api/apps/installed?organizationId=${appStudioOrgId}`);
        if (res.ok) {
          const rows = await res.json().catch(() => []);
          const fetched = blueprintSurfaces(Array.isArray(rows) ? rows : [], appStudioOrgId);
          const hit = matchCycleFleetApp(fetched, detail);
          if (hit) { apps = fetched; target = hit; }
        }
      } catch {
        // The artifact's own identifiers below still mount the surface.
      }
    }
    if (!target) {
      // The installed list can lag the deployment; the artifact carries enough
      // to mount the surface on its own. First position keeps it the active
      // app when its synthesized id matches nothing else.
      const synthesized = cycleAppFromLaunchRef(detail);
      if (!synthesized) return;
      target = synthesized;
      apps = [synthesized, ...apps.filter((a) => a.id !== synthesized.id)];
    }
    if (apps.length) setBlueprintStudioApps(apps);
    setActiveCanvasAppId(target.id);
    setIsTabbedRailCollapsed(true);
    setIsMediaRailCollapsed(true);
    setIsCanvasOpen(true);
  }, [blueprintStudioApps, cycleFleetData, appStudioOrgId]);

  /** Identity of the newest launch artifact that wants the canvas. */
  const canvasMountRequest = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const artifacts = (turns[i] as any).artifacts ?? [];
      for (let j = artifacts.length - 1; j >= 0; j--) {
        const p = artifacts[j]?.payload ?? {};
        if (p.type === 'assistant_app' && p.studioSurface === 'cycle_canvas' && (p.publicSlug || p.deploymentId)) {
          return {
            key: `${(turns[i] as any).id ?? i}:${(artifacts[j] as any).id ?? j}:${p.publicSlug ?? p.deploymentId}`,
            publicSlug: p.publicSlug,
            deploymentId: p.deploymentId ?? null,
            appId: p.appId ?? null,
            title: p.title,
            slug: p.slug,
            blueprint: p.blueprint,
            publicPath: p.publicPath,
          };
        }
      }
    }
    return null;
  }, [turns]);

  // Mount once per artifact — the author closing the canvas is honoured until
  // a genuinely new launch artifact arrives (same bargain the studios strike).
  const handledCanvasMountRef = useRef<string | null>(null);
  useEffect(() => {
    if (!canvasMountRequest || handledCanvasMountRef.current === canvasMountRequest.key) return;
    handledCanvasMountRef.current = canvasMountRequest.key;
    void openCycleAppCanvas(canvasMountRequest);
  }, [canvasMountRequest, openCycleAppCanvas]);

  useEffect(() => {
    const handler = (e: Event) => { void openCycleAppCanvas((e as CustomEvent).detail ?? {}); };
    window.addEventListener('crew-cycle-app:open', handler);
    return () => window.removeEventListener('crew-cycle-app:open', handler);
  }, [openCycleAppCanvas]);

  /**
   * In-flight guard for send().
   *
   * A ref rather than the isSending state, because state updates are not
   * synchronous: two submits in the same tick (double-click, or Enter landing
   * alongside a click) both read isSending as false and both POSTed. The server
   * absorbed the duplicate via its per-session cooldown, so it never surfaced as
   * an error — it just quietly charged a second round's worth of nothing.
   */
  const sendInFlightRef = useRef(false);
  const scribeActiveRef = useRef(false);

  useEffect(() => {
    lastSeenTurnId.current = 0;
    setRoomAttachments([]);
    setActiveIntakeTopic(null);
  }, [currentRoomKey]);

  useEffect(() => {
    let mounted = true;
    selectionScopeRef.current = null;
    explicitAgentSelectionRef.current = false;

    (async () => {
      // Fire sync in background without blocking initial roster loading
      apiRequest('POST', '/api/agent-cards/sync').catch(() => {});

      // The roster loads INDEPENDENTLY of the room: when these shared one
      // Promise.all, a failing room fetch also emptied the agent list, which
      // looked like the room had lost every agent.
      let list: AgentCard[] = [];
      try {
        const res = await apiRequest('GET', '/api/agent-cards');
        const cards = await res.json();
        const raw: AgentCard[] = Array.isArray(cards) ? cards : (cards.agents ?? []);
        // Copilot first. The roster strip scrolls horizontally, so anything
        // beyond the first few cards is off-screen on open — and it is the one
        // member every room is expected to have.
        list = [...raw].sort(
          (a, b) => Number(isCopilotCard(b)) - Number(isCopilotCard(a)),
        );
        if (mounted) setAgents(list);
      } catch {
        if (mounted) setError('Failed to load agents.');
      }

      const copilotId = list.find(isCopilotCard)?.id ?? null;

      /**
       * Include Copilot in a new room's default selection. Explicit saved
       * selections, including an empty roster, take precedence.
       */
      const withCopilot = (ids: number[]): number[] =>
        copilotId !== null && !ids.includes(copilotId) ? [copilotId, ...ids] : ids;

      try {
        const res = await apiRequest('GET', `/api/crew/${currentRoomKey}`);
        if (!res.ok) throw new Error(`Room fetch failed (${res.status})`);
        const room = await res.json();
        if (!mounted) return;
        applyRoom(room);
        const existing: number[] = (room.members ?? []).map((m: AgentCard) => m.id);
        const orgId = room.session?.organizationId ?? resolveActiveOrgId();
        const userId = room.currentUserId;
        const key = orgId != null && userId ? activeAgentSelectionKey(orgId, String(userId), currentRoomKey) : null;
        selectionScopeRef.current = key ? { key, roomKey: currentRoomKey, serverReady: Boolean(room.session) } : null;
        const local = key ? loadActiveAgentSelection(key, list.map((agent: AgentCard) => agent.id)) : null;
        const saved = room.session?.memory?.activeAgentSelections?.[String(userId)];
        const restored = local ?? (Array.isArray(saved) ? saved.filter((id: number) => list.some((agent: AgentCard) => agent.id === id)) : null);
        explicitAgentSelectionRef.current = restored !== null;
        const ids = restored ?? withCopilot(existing.length > 0 ? existing : list.slice(0, 3).map((a) => a.id));
        selectedAgentIdsRef.current = ids;
        setSelectedIds(ids);
      } catch {
        if (mounted) setSelectedIds(withCopilot(list.slice(0, 3).map((a) => a.id)));
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [applyRoom, currentRoomKey]);

  // A room opened without a key rewrites the URL to its generated one, so the
  // address bar is always shareable.
  useEffect(() => {
    if (roomKey) return;
    const search = window.location.search;
    const targetPath = `/workspace/chat/${currentRoomKey}`;
    const targetUrl = `${targetPath}${search}`;
    if (window.location.pathname !== targetPath) {
      window.history.replaceState(null, '', targetUrl);
    }
  }, [roomKey, currentRoomKey]);



  // Load cycle-calibrated playbooks for a cold room. Project-history primers
  // are intentionally not rendered here: they duplicated the room timeline
  // and crowded the first-use decision surface.
  useEffect(() => {
    if (turns.length > 0) return;

    const params = new URLSearchParams({ sessionId: sessionId.current });
    // ?projectKey= is how the room's Project Space reaches the server; without
    // it primers fall back to org-wide activity.
    const fromUrl = new URLSearchParams(window.location.search).get('projectKey');
    if (fromUrl) params.set('projectKey', fromUrl);

    apiRequest('GET', `/api/crew/primers?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setCycleContext(d.cycleContext ?? null);
        const reconciled = reconcileTopicArchetypes(d.topicArchetypes);
        if (reconciled) setTopicArchetypes(reconciled);
      })
      .catch(() => {
        setCycleContext(null);
        setTopicArchetypes(DEFAULT_TOPIC_ARCHETYPES);
      });
  }, [turns.length, currentRoomKey]);

  useEffect(() => {
    if (virtualizeTurns && virtuosoRef.current) {
      // Unmeasured rows are estimated, so the end marker's offset is a guess
      // until the last row mounts. Let the list land on it first.
      virtuosoRef.current.scrollToIndex({ index: 'LAST', align: 'end' });
      const frame = requestAnimationFrame(() => transcriptEl?.scrollTo({ top: transcriptEl.scrollHeight, behavior: 'smooth' }));
      return () => cancelAnimationFrame(frame);
    }
    // scrollIntoView also moves overflow-hidden ancestors, clipping the entire
    // room above the composer. Only the transcript owns conversation scrolling.
    transcriptEl?.scrollTo({ top: transcriptEl.scrollHeight, behavior: 'smooth' });
  }, [turns.length, isSending, virtualizeTurns, transcriptEl]);

  const invite = useCallback(async () => {
    const identifier = inviteValue.trim();
    if (!identifier) return;
    setError(null);
    try {
      const res = await apiRequest('POST', `/api/crew/${sessionId.current}/participants`, {
        identifier,
      });
      const data = await res.json();
      setParticipants(data.participants ?? []);
      setInviteValue('');
      setInviteOpen(false);
    } catch {
      setError(`Could not add "${identifier}" — check the username and that they are in this org.`);
    }
  }, [inviteValue]);

  const handleSelectTopic = useCallback((topic: TopicArchetype) => {
    setActiveIntakeTopic(topic);
  }, []);

  const toggleAgent = useCallback((id: number) => {
    const previous = selectedAgentIdsRef.current;
    const ids = previous.includes(id) ? previous.filter(x => x !== id) : [...previous, id];
    explicitAgentSelectionRef.current = true;
    selectedAgentIdsRef.current = ids;
    setSelectedIds(ids);
    const scope = selectionScopeRef.current;
    if (!scope) return;
    try { localStorage.setItem(scope.key, JSON.stringify(ids)); } catch { /* Server persistence remains available. */ }
    if (scope.serverReady) selectionSaveQueue.current = selectionSaveQueue.current.catch(() => {}).then(async () => {
      const response = await apiRequest('PUT', `/api/crew/${encodeURIComponent(scope.roomKey)}/active-agents`, { agentCardIds: ids });
      if (!response.ok) throw new Error('Agent selection was saved locally, but server synchronization failed.');
    }).catch((error: any) => { if (sessionId.current === scope.roomKey) setError(error.message); });
  }, [setError]);

  const send = useCallback(
    async (message: string, options?: { outputIntent?: CrewOutputIntent }, queued?: (typeof queuedRequests)[number]) => {
      if (sendInFlightRef.current && !scribeActiveRef.current) return;
      const previousController = sendAbortRef.current;
      const controller = new AbortController();
      sendAbortRef.current = controller;
      sendInFlightRef.current = true;
      setIsSending(true);
      setAwaitingFirstTurn(true);
      setComposerDraft('');
      setError(null);

      const optimistic: CrewTurn = {
        id: -Date.now(),
        speakerType: 'user',
        speakerName: 'You',
        userId: currentUserId,
        content: message,
        round: 0,
        agentCardId: null,
        inReplyToTurnId: null,
        topic: null,
        // The classifier's category arrives with the server's turn; an output
        // intent ("map", "present") is not one.
        intent: null,
        latencyMs: null,
        toolsUsed: [],
        artifacts: [],
      };
      setTurns((prev) => [...prev, optimistic]);

      try {
        if (previousController) {
          await apiRequest('POST', `/api/crew/${sessionId.current}/cancel`);
          previousController.abort();
        }
        const res = await apiRequest(
          'POST',
          '/api/crew/message',
          {
            message,
            selectedContext: queued?.selectedContext ?? workspaceItemsRef.current.map(({ turnId, tool, itemId }) => ({ turnId, tool, itemId })),
            mountedApp: queued ? queued.mountedApp : mountedAppRef.current,
            sessionId: sessionId.current,
            agentCardIds: queued?.agentCardIds ?? selectedIds,
            computerUseStudioActive: computerStudioActiveRef.current,
            studio: activeStudioRef.current || initialStudioParamRef.current || undefined,
            activeStudio: activeStudioRef.current,
            outputIntent: options?.outputIntent,
          },
          undefined,
          controller.signal,
        );
        await res.json();

        applyRoom(await fetchRoom());
      } catch (err: unknown) {
        setQueuePaused(true);
        // A cancelled round is not an error: the turns produced before the
        // cancel are real, so reconcile instead of rolling the message back.
        if (controller.signal.aborted) {
          fetchRoom().then(applyRoom).catch(() => {});
          return;
        }
        setTurns((prev) => prev.filter((t) => t.id !== optimistic.id));
        setError(crewSendErrorMessage(err));
      } finally {
        if (sendAbortRef.current === controller) {
          sendAbortRef.current = null;
          sendInFlightRef.current = false;
          setIsSending(false);
          setAwaitingFirstTurn(false);
        }
      }
    },
    [selectedIds, applyRoom, fetchRoom, currentUserId],
  );

  const submitRequest = useCallback((message: string, options?: { outputIntent?: CrewOutputIntent }) => {
    if (sendInFlightRef.current || queuedRequests.length > 0) {
      setQueuedRequests((previous) => [...previous, {
        id: ++queueId.current, roomKey: currentRoomKey, message, options,
        agentCardIds: [...selectedIds],
        selectedContext: workspaceItemsRef.current.map(({ turnId, tool, itemId }) => ({ turnId, tool, itemId })),
        mountedApp: mountedAppRef.current,
      }]);
      setComposerDraft('');
      return;
    }
    void send(message, options);
  }, [send, queuedRequests.length, currentRoomKey, selectedIds]);

  useEffect(() => {
    if (isSending || sendInFlightRef.current || queuePaused || queuedRequests.length === 0) return;
    const next = queuedRequests[0];
    setQueuedRequests((previous) => previous.filter((request) => request.id !== next.id));
    if (next.roomKey === currentRoomKey) void send(next.message, next.options, next);
  }, [isSending, queuePaused, queuedRequests, currentRoomKey, send]);


  /**
   * Stops an in-progress round. The server flag makes the orchestrator skip the
   * remaining speakers; aborting the fetch releases this client immediately
   * rather than waiting for the round already in flight to unwind.
   */
  const cancelRound = useCallback(async () => {
    setQueuePaused(true);
    try {
      await apiRequest('POST', `/api/crew/${sessionId.current}/cancel`);
    } catch {
      // A 409 means the round already ended — the abort below still applies.
    }
    sendAbortRef.current?.abort();
    setIsSending(false);
    setAwaitingFirstTurn(false);
  }, []);

  // Keyed on content so the array keeps its identity while turns stream in;
  // every memoized TurnRow receives it.
  const memberNamesKey = useMemo(() => {
    const names = new Set<string>();
    agents.forEach((a) => names.add(a.name));
    turns.forEach((t) => {
      if (t.speakerType === 'agent' && t.speakerName) names.add(t.speakerName);
    });
    return Array.from(names).join('\n');
  }, [agents, turns]);
  const memberNames = useMemo(() => (memberNamesKey ? memberNamesKey.split('\n') : []), [memberNamesKey]);

  const agentTurns = useMemo(
    () => turns.filter((t) => t.speakerType === 'agent').slice(-6).reverse(),
    [turns],
  );

  const handleCreateStructuredRecord = useCallback(async () => {
    const value = recordText.trim();
    if (!value || recordSaving || !session) return;
    setRecordSaving(true);
    try {
      await createStructuredRecord(recordKind, value);
      setRecordText('');
    } catch {
      // error handled in useCrewSession
    } finally {
      setRecordSaving(false);
    }
  }, [createStructuredRecord, recordKind, recordText, recordSaving, session]);

  /**
   * Right margin for transcript / raised-hands / composer — prevents content
   * sliding under the portal-fixed right rail panels.
   *
   * MEASURED, not enumerated. This used to be a table of three widths derived
   * from Supervisor + Blackboard only (96 / 384 / 672), and the rail container
   * carried the matching table (72 / 360 / 648). When the Assembly Stack was
   * added as a third child, neither table knew about it: it wants w-72 (288px)
   * and had no shrink-0, so it absorbed the entire deficit. Collapsing the
   * Blackboard shrank the container by 288px while freeing only 288px of
   * sibling, which is why collapsing a panel made the stack SMALLER rather
   * than larger, down to a clipped sliver.
   *
   * An enumerated table cannot express this anyway: the rail collapses
   * independently, and renders nothing at all when no assembly is active. So
   * the container now sizes to its children and the margin follows what is
   * actually on screen.
   *
   * Published as a CSS variable rather than an inline style so the margin stays
   * lg-only: below lg the rail is `hidden`, and an inline marginRight would
   * indent the transcript against nothing.
   */
  const {
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
  } = useCrewStudios({
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
  });

  useEffect(() => {
    const eventId = Number(new URLSearchParams(window.location.search).get('gmailAlert'));
    if (isLoading || session?.sessionKey !== currentRoomKey || !Number.isInteger(eventId) || eventId < 1) return;
    const key = `${currentRoomKey}:${eventId}:${notificationRetry}`;
    if (loadedNotification.current === key) return;
    loadedNotification.current = key;
    setNotificationHandoff({ loading: true });
    void (async () => {
      try {
        const response = await apiRequest('POST', `/api/crew/${encodeURIComponent(currentRoomKey)}/notification-context`, { eventId });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message ?? 'Could not load the triggering email.');
        if (sessionId.current !== currentRoomKey) return;
        const item = data.payload?.items?.[0];
        if (!item || !data.turn?.id) throw new Error('The email context is unavailable.');
        const selected = [{ turnId: data.turn.id, tool: 'gmail_get_message', itemId: item.id, resultIndex: 0, item }];
        workspaceItemsRef.current = selected;
        setWorkspaceItems(selected);
        appendTurn(data.turn);
        setHighlightedTurnId(data.turn.id);
        setNotificationHandoff({ title: item.title, reason: data.reason });
      } catch (error: any) {
        if (sessionId.current === currentRoomKey) setNotificationHandoff({ error: error.message ?? 'Could not load the triggering email.' });
      }
    })();
  }, [currentRoomKey, session?.sessionKey, isLoading, notificationRetry, appendTurn]);

  activeStudioRef.current = (activeStudioKind === 'app' && (initialStudioParamRef.current === 'forge' || initialStudioParamRef.current === 'builder'))
    ? initialStudioParamRef.current
    : (activeStudioKind ?? null);

  const handleActiveStudioChange = useCallback((kind: string | null) => {
    if (kind) {
      if (typeof window !== 'undefined') {
        try {
          const url = new URL(window.location.href);
          const currentParam = url.searchParams.get('studio');
          if (kind === 'app' && (currentParam === 'forge' || currentParam === 'builder')) {
            activeStudioRef.current = currentParam;
          } else {
            activeStudioRef.current = kind;
            if (currentParam !== kind) {
              url.searchParams.set('studio', kind);
              window.history.replaceState({}, '', url.toString());
            }
          }
        } catch {
          activeStudioRef.current = kind;
        }
      } else {
        activeStudioRef.current = kind;
      }
    }
  }, []);

  const [isExecutiveBriefViewerOpen, setIsExecutiveBriefViewerOpen] = useState(false);

  /**
   * Discovers the latest executive closing brief or presentation deck AST in the room.
   */
  const executiveDeckAst = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      for (const art of turns[i]?.artifacts ?? []) {
        const p = art?.payload ?? {};
        if (p.type === 'presentation_deck') {
          return (p.ast as any) || createDefaultDeckAst(
            turns[i].id,
            p.title as string,
            p.formatCategory as string,
            p.theme as string,
            p.blocks as any[],
          );
        }
      }
    }
    return null;
  }, [turns]);

  const railRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;

    const publish = () => {
      // +16px viewport inset (right-4) +8px buffer.
      const width = el.getBoundingClientRect().width;
      rootRef.current?.style.setProperty('--crew-rail-mr', `${Math.round(width) + 24}px`);
    };
    publish();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isCanvasOpen, isAppStudioFullscreen]);

  const transcriptMarginClass = isCanvasOpen || (hasStudioActive && !isChatCollapsed)
    ? ''
    : 'lg:mr-[var(--crew-rail-mr,672px)]';

  /**
   * Track the header's viewport-relative bottom and publish it as railTop state
   * so the portal-fixed right rail always sits flush beneath the header.
   *
   * position:fixed is relative to the viewport, so we need the actual
   * getBoundingClientRect().bottom (not just offsetHeight) — the two differ
   * whenever the outer page has scrolled. A ResizeObserver catches size changes;
   * a scroll listener on the nearest scrolling ancestor catches scroll changes.
   */
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const publish = () => {
      const rect = header.getBoundingClientRect();
      setRailTop(rect.bottom);
      if (rootRef.current) {
        rootRef.current.style.setProperty('--crew-header-h', `${header.offsetHeight}px`);
      }
    };
    publish();

    let roDisconnect = () => {};
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(publish);
      ro.observe(header);
      roDisconnect = () => ro.disconnect();
    }

    // Walk up the DOM to find the real scroll container.
    const findScroller = (el: HTMLElement | null): HTMLElement | Window => {
      let node = el?.parentElement ?? null;
      while (node) {
        const { overflow, overflowY } = getComputedStyle(node);
        if (/(auto|scroll)/.test(overflow + overflowY)) return node;
        node = node.parentElement;
      }
      return window;
    };
    const scroller = findScroller(rootRef.current);
    scroller.addEventListener('scroll', publish, { passive: true });

    return () => {
      roDisconnect();
      scroller.removeEventListener('scroll', publish);
    };
  }, []);

  // ── Chat Pane Resizing & Dynamic Side-Rail Expansion ──────────────────────────
  const {
    sidebarLeft,
    effectiveChatWidth,
    maxChatWidth,
    isDraggingChatWidth,
    handleMouseDownResize,
    handleTouchStartResize,
    handleResetChatWidth,
    handleKeyResize,
  } = useChatPaneResize({
    rootRef,
    isCyclePipelineCollapsed,
    hasMediaStudioActive,
    isMediaRailCollapsed,
  });

  return (
    <div
      ref={rootRef}
      // Seeded here rather than as a var() fallback so the arbitrary Tailwind
      // values stay comma-free, and so the rails have a sane offset for the
      // first paint, before the header has been measured.
      style={{ '--crew-header-h': '0px' } as React.CSSProperties}
      className={cn('flex h-full flex-col bg-background', className)}
      data-testid="crew-room"
      data-hover-tutorial="off"
    >
      {/* Crew Header (Agent Bar & Participants) — rendered in normal flow within the main layout scroller so it tracks left navigation expand/collapse transitions synchronously without layout lag or overlap. */}
      <CrewHeaderBar
        appStudioControl={<BlueprintStudioLauncher organizationId={appStudioOrgId} onMount={(apps) => { setBlueprintStudioApps(apps); setActiveCanvasAppId(apps[0].id); setIsTabbedRailCollapsed(true); setIsMediaRailCollapsed(true); setIsCanvasOpen(true); }} />}
        headerRef={headerRef}
        breakoutLineage={breakoutLineage}
        cycleFleetData={cycleFleetData}
        session={session}
        executiveDeckAst={executiveDeckAst}
        isCanvasOpen={isCanvasOpen}
        onToggleCanvas={() => setIsCanvasOpen(prev => !prev)}
        agents={agents}
        selectedIds={selectedIds}
        onToggleAgent={toggleAgent}
        isLoading={isLoading}
        participants={participants}
        inviteOpen={inviteOpen}
        setInviteOpen={setInviteOpen}
        inviteValue={inviteValue}
        setInviteValue={setInviteValue}
        onInvite={invite}
        copied={copied}
        onCopyLink={() => {
          const orgId = session?.organizationId || resolveActiveOrgId();
          const shareUrl = `${window.location.origin}/workspace/chat/${sessionId.current}${orgId ? `?orgId=${orgId}` : ''}`;
          navigator.clipboard
            ?.writeText(shareUrl)
            .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
            .catch(() => {});
        }}
        decisions={decisions}
        claims={claims}
      />

      <CrewTopBanners
        pendingAttestation={pendingAttestation}
        error={error}
        connectionLost={connectionLost}
        activeDraftId={(session as any)?.metadata?.activeDraftId}
        organizationId={session?.organizationId}
        projectId={session?.projectId}
      />

      <div className={cn("flex min-h-0 flex-1 overflow-hidden relative", isCanvasOpen && 'lg:mr-[var(--crew-rail-mr,48px)]')}>
        {/* ── Collapsed Chat Rail (Shown when chat is collapsed in Zen / Scribe mode) ── */}
        {isChatCollapsed ? (
          <div className="hidden lg:flex w-14 shrink-0 flex-col items-center py-4 border-r border-border/60 bg-card/75 backdrop-blur-md gap-4 z-20 select-none">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsChatCollapsed(false)}
              className="h-9 w-9 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 shadow-xs"
              title="Expand Agent Chat (Split View)"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
            <div className="h-px w-6 bg-border/60" />
            <div
              onClick={() => setIsChatCollapsed(false)}
              className="cursor-pointer flex flex-col items-center gap-1.5 p-1 rounded-lg hover:bg-muted/40 transition-colors"
              title="Click to view conversation"
            >
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <Badge variant="outline" className="h-4 px-1 text-[9px] font-mono text-cyan-700 dark:text-cyan-300 border-cyan-500/30">
                {turns.length}
              </Badge>
            </div>
          </div>
        ) : (
          /* ── Transcript ──────────────────────────────────────────────── */
          <main
            style={
              hasStudioActive && !isChatCollapsed
                ? { width: `${effectiveChatWidth}px` }
                : undefined
            }
            className={cn(
              "flex min-h-0 min-w-0 flex-col relative",
              !isDraggingChatWidth && "transition-all duration-300",
              hasStudioActive && !isChatCollapsed ? "shrink-0 border-r border-border/60" : "flex-1",
            )}
          >
            {/* Transcript Timeline Scrubber */}
            <CrewTranscriptScrubber
              turns={visibleTurns}
              activeTurnId={highlightedTurnId}
              onTurnClick={setHighlightedTurnId}
            />

            {/* Declared-topic rail: the room's #[x] vocabulary. A click narrows
                the transcript to the turns that declared that label. */}
            {(topicCloud.length > 0 || canDecideTopics) && (
              <div
                className="flex flex-wrap items-center gap-1.5 border-b border-border/40 px-4 py-2"
                data-testid="crew-topic-rail"
              >
                <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {topicCloud.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => toggleTopicFilter(topicFilter === t.label ? null : t.label)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                      topicFilter === t.label
                        ? 'border-primary/60 bg-primary/15 text-primary'
                        : 'border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                      t.pending > 0 && 'border-dashed',
                    )}
                    data-testid={`crew-topic-pill-${t.label}`}
                  >
                    #{t.label}
                    <span className="text-[9px] opacity-70">{t.count}</span>
                    {t.pending > 0 && <span className="text-[9px] opacity-70">·{t.pending} pending</span>}
                  </button>
                ))}
                {topicFilter && (
                  <button
                    type="button"
                    onClick={() => toggleTopicFilter(null)}
                    className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                    data-testid="crew-topic-clear"
                  >
                    <X className="h-3 w-3" /> Clear
                  </button>
                )}
                {canDecideTopics && (
                  <button
                    type="button"
                    onClick={() => void toggleAgentTagApproval()}
                    className={cn(
                      'ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                      agentTagApproval
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    title={agentTagApproval
                      ? 'Agent-declared topics await your approval. Click to auto-apply them.'
                      : 'Agent-declared topics auto-apply. Click to require your approval first.'}
                    data-testid="crew-topic-gate-toggle"
                  >
                    Agent tags: {agentTagApproval ? 'approval' : 'auto-apply'}
                  </button>
                )}
              </div>
            )}
            {/*
              * axe: scrollable-region-focusable, serious. A scrolling region
              * whose content holds no focusable element cannot be scrolled from
              * the keyboard at all — an empty room, or one whose turns are plain
              * prose, simply could not be read without a mouse.
              */}
            <div
              ref={setTranscriptEl}
              className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-4', transcriptMarginClass)}
              data-testid="crew-transcript"
              tabIndex={0}
              role="log"
              aria-label="Meeting transcript"
            >
            {currentRoomKey.startsWith('deliberation-') && parseInt(currentRoomKey.replace('deliberation-', '')) > 0 && (
              <div className="mb-4">
                <AgoraDeliberationBriefing
                  approvalId={parseInt(currentRoomKey.replace('deliberation-', ''))}
                  onResolved={() => fetchRoom()}
                />
              </div>
            )}
            {turns.length === 0 ? (
              // `min-h-full`, not `h-full`: a fixed-height flex box centres
              // content that then overflows past the composer instead of
              // scrolling inside the transcript. min-height lets a tall opener
              // grow and scroll instead.
              //
              // `items-start`, not `items-center`: once the opener fits, centring
              // it pushed the heading a couple of hundred pixels below the agent
              // strip and left the gap dead. It reads as a page header, so it
              // starts at the top.
              <div className="flex items-start justify-center px-2 pt-0 pb-6">
                <CrewPlaybookLauncher
                  activeIntakeTopic={activeIntakeTopic}
                  setActiveIntakeTopic={setActiveIntakeTopic}
                  hasAppStudioActive={hasAppStudioActive}
                  cycleContext={cycleContext}
                  topicArchetypes={topicArchetypes}
                  onSelectTopic={handleSelectTopic}
                  isSending={isSending}
                  selectedAgentIds={selectedIds}
                  onLaunchTopicDirective={(prompt) => send(prompt)}
                />
              </div>
            ) : topicFilter && visibleTurns.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
                No turns in this room declared <span className="font-semibold text-foreground">#{topicFilter}</span>.
                <button type="button" className="ml-2 underline" onClick={() => toggleTopicFilter(null)}>Show everything</button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {virtualizeTurns ? (
                  // The transcript div stays the scroller, so the briefing above
                  // and the end marker below scroll with the turns as before.
                  transcriptEl && (
                    <Virtuoso
                      ref={virtuosoRef}
                      customScrollParent={transcriptEl}
                      data={visibleTurns}
                      computeItemKey={(_, turn) => turn.id}
                      // Generous overscan: map and media pods are costly to
                      // remount, so keep a screen or so of them alive each way.
                      increaseViewportBy={{ top: 1200, bottom: 1200 }}
                      itemContent={(index, turn) => (
                        // Items are absolutely stacked; padding stands in for gap-3.
                        <div className={index < visibleTurns.length - 1 ? 'pb-3' : undefined}>
                          <TurnRow
                            turn={turn}
                            topics={topicsByTurnId.get(turn.id)}
                            canDecideTopics={canDecideTopics}
                            onTopicDecision={decideTopic}
                            onTopicFilter={(label) => toggleTopicFilter(topicFilter === label ? null : label)}
                            names={memberNames}
                            onArtifactSubmit={send}
                            selectedWorkspaceItems={workspaceItems}
                            onSelectWorkspaceItems={selectWorkspaceItems}
                            onDiscussWorkspaceItems={discussWorkspaceItems}
                            currentUserId={currentUserId}
                            isHighlighted={turn.id === highlightedTurnId}
                            hasScribeActive={hasScribeActive}
                            hasAppStudioActive={hasAppStudioActive}
                            selectedAssemblyUnit={selectedAssemblyUnit}
                            appliedAgentProposals={appliedAgentProposals}
                          />
                        </div>
                      )}
                    />
                  )
                ) : (
                  visibleTurns.map((turn) => (
                    <TurnRow
                      key={turn.id}
                      turn={turn}
                      topics={topicsByTurnId.get(turn.id)}
                      canDecideTopics={canDecideTopics}
                      onTopicDecision={decideTopic}
                      onTopicFilter={(label) => toggleTopicFilter(topicFilter === label ? null : label)}
                      selectedWorkspaceItems={workspaceItems}
                      onSelectWorkspaceItems={selectWorkspaceItems}
                      onDiscussWorkspaceItems={discussWorkspaceItems}
                      names={memberNames}
                      onArtifactSubmit={send}
                      currentUserId={currentUserId}
                      isHighlighted={turn.id === highlightedTurnId}
                      hasScribeActive={hasScribeActive}
                      hasAppStudioActive={hasAppStudioActive}
                      selectedAssemblyUnit={selectedAssemblyUnit}
                      appliedAgentProposals={appliedAgentProposals}
                    />
                  ))
                )}
                {isSending && awaitingFirstTurn && (
                  <CrewDeliberationPulseBar
                    agents={agents}
                    activeAgentIds={selectedIds}
                    onCancel={cancelRound}
                  />
                )}
                {appActivity && <CrewAppActivityFeed activity={appActivity} />}
                <div ref={endRef} />
              </div>
            )}
            {surfaceRequests.map(pending => (
              <CrewSurfaceRequestCard
                key={pending.request.requestId}
                pending={pending}
                onDismiss={() => setSurfaceRequests(prev => prev.filter(item => item.request.requestId !== pending.request.requestId))}
              />
            ))}
          </div>
          <CrewRaisedHandsBar
            raisedHands={raisedHands}
            dismissedHands={dismissedHands}
            setDismissedHands={setDismissedHands}
            isSending={isSending}
            transcriptMarginClass={transcriptMarginClass}
            onCallOnAgent={(agentName) => send(`@${agentName} what would you add here?`)}
            pendingAttestation={pendingAttestation}
          />

          {/* Attachments sit with the composer, not in the transcript: they are
              something you bring TO the conversation, and the room's files
              should stay visible while typing about them. */}
          <div className={cn('flex items-center gap-2 px-4 pb-1.5', transcriptMarginClass)}>
            <div className="min-w-0 flex-1">
              <CrewAttachmentBar
                triggerContainer={attachmentControl}
                roomKey={sessionId.current}
                organizationId={session?.organizationId}
                projectScoped={true}
                // The bar already holds the room's files; hand them up so the
                // rail shows the same list rather than fetching it a second time.
                onAttached={setRoomAttachments}
                onLoaded={setRoomAttachments}
              />
            </div>
          </div>
          <div className={cn(transcriptMarginClass)}>
            {notificationHandoff && <section aria-label="Email notification handoff" role="status" className="mb-2 rounded-lg border border-primary/30 bg-card p-3 text-sm">
              <div className="flex items-center gap-2"><GoogleWorkspaceIcon kind="email" /><strong>{notificationHandoff.loading ? 'Preparing your email context…' : notificationHandoff.error ? 'Email context could not be loaded' : 'Email opened from your directive'}</strong><button type="button" className="ml-auto text-xs" onClick={() => setNotificationHandoff(null)}>Dismiss</button></div>
              {notificationHandoff.title && <p className="mt-2 font-medium">{notificationHandoff.title}</p>}
              {notificationHandoff.reason && <p className="mt-1 text-xs text-muted-foreground">{notificationHandoff.reason}</p>}
              {notificationHandoff.error && <><p className="mt-2">{notificationHandoff.error}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => setNotificationRetry(value => value + 1)}>Try again</Button></>}
              {!notificationHandoff.loading && !notificationHandoff.error && <p className="mt-2 text-xs text-muted-foreground">The triggering email is highlighted above. Its card lets you summarize it, draft a reply, or open it in Gmail.</p>}
            </section>}
            <CrewContextTray items={workspaceItems} onClear={() => setWorkspaceItems([])} onRemove={item => setWorkspaceItems(previous => previous.filter(p => p !== item))} />
            <Composer
              allowQueue
              attachmentControlRef={setAttachmentControl}
              onSend={submitRequest}
              disabled={false}
              isBusy={isSending}
              onCancel={isSending ? cancelRound : undefined}
              memberCount={selectedIds.length}
              initialValue={composerDraft || handoffDraft}
              draftValue={composerDraft}
              assemblyUnit={selectedAssemblyUnit}
              onClearAssemblyUnit={() => {
                setSelectedAssemblyUnit(null);
                setComposerDraft('');
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('scribe:clear-focus'));
                }
              }}
              agents={agents}
              recentTopics={recentTopicLabels}
            />
            {queuedRequests.length > 0 && <section aria-label="Queued requests" className="px-4 pb-2 text-xs">
              <div className="flex items-center gap-2 py-1 text-muted-foreground">
                <span>{queuedRequests.length} queued{queuePaused ? ' · paused' : ''}</span>
                {queuePaused && <button type="button" className="underline" onClick={() => setQueuePaused(false)}>Resume queue</button>}
              </div>
              <ol className="space-y-1">
                {queuedRequests.map((request, index) => <li key={request.id} className="flex min-w-0 items-center gap-2 rounded border border-border/60 px-2 py-1">
                  <span className="text-muted-foreground">{index + 1}.</span>
                  <span className="min-w-0 flex-1 truncate" title={request.message}>{request.message}</span>
                  <button type="button" aria-label={`Remove queued request ${index + 1}`} className="shrink-0 px-1" onClick={() => setQueuedRequests((previous) => previous.filter((item) => item.id !== request.id))}>×</button>
                </li>)}
              </ol>
            </section>}
            {isSending && <div className="flex items-center justify-between px-4 pb-2 pt-1 text-xs text-muted-foreground border-t border-border/40">
              <span className="text-[11px] text-muted-foreground/75 flex items-center gap-1.5">
                  <span role="status" className="text-primary font-medium flex items-center gap-1.5" data-testid="crew-bottom-busy-hint">
                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
                    </span>
                    {(() => {
                      const userTurnIndex = turns.map((turn) => turn.speakerType).lastIndexOf('user');
                      const responses = turns.slice(userTurnIndex + 1).filter((turn) => turn.speakerType === 'agent');
                      const latest = responses.at(-1);
                      return latest
                        ? `${latest.speakerName} · ${responses.length} response${responses.length === 1 ? '' : 's'} received · continuing…`
                        : 'Agents preparing their responses…';
                    })()}
                  </span>
              </span>
            </div>}
          </div>

          {/* ── Draggable Resize Handle on Chat Pane ────────────────────────── */}
          <ChatPaneResizeHandle
            hasStudioActive={hasStudioActive}
            isChatCollapsed={isChatCollapsed}
            effectiveChatWidth={effectiveChatWidth}
            maxChatWidth={maxChatWidth}
            isDraggingChatWidth={isDraggingChatWidth}
            onMouseDown={handleMouseDownResize}
            onTouchStart={handleTouchStartResize}
            onDoubleClick={handleResetChatWidth}
            onKeyDown={handleKeyResize}
          />
        </main>
        )}

        {isCanvasOpen && (blueprintStudioApps.length > 0 || Boolean(cycleFleetData?.apps?.length)) && (
          <CrewCycleAppCanvas
            cycleSlug={cycleFleetData?.cycleSlug}
            cycleName={cycleFleetData?.cycleName}
            stageName={cycleFleetData?.stageName}
            apps={blueprintStudioApps.length ? blueprintStudioApps : cycleFleetData?.apps ?? []}
            roomKey={currentRoomKey}
            organizationId={appStudioOrgId}
            onShowChat={() => setIsChatCollapsed(false)}
            onFullscreenChange={setIsAppStudioFullscreen}
            onActivity={receiveAppActivity}
            onInputRequest={receiveSurfaceRequest}
            onSurfaceChange={setActiveAppSurface}
            rightRailCollapsed={isTabbedRailCollapsed}
            onToggleRightRail={() => setIsTabbedRailCollapsed((collapsed) => !collapsed)}
            onDiscuss={(app) => { setComposerDraft(`Discuss the mounted Blueprint app "${app.title}" (app ${app.appId}, deployment ${app.id}, ${app.publicPath}). `); setIsChatCollapsed(false); }}
            onRequestCycle={(app, reference) => {
              setComposerDraft(reference
                ? `Read-only: use read_app_records with app ${app.slug}, collection sdlc_stage_handoffs and recordId ${reference.handoffId}. Read the exact source evidence using its collection and persisted recordId. Verify this room's repository, cycle, commit, destination acknowledgement and applicable approvals. Distinguish source validation at receipt time from current mission status; report current status as unverified unless an executed read establishes it. State the verified next action and blockers. Do not launch or approve anything. `
                : `Review the next lifecycle step for the mounted app "${app.title}". Resolve the repository, cycle, prerequisites and approvals before proposing execution. `);
              if (reference) setActiveAppSurface(previous => previous ? { ...previous, selectedRecord: { collection: 'sdlc_stage_handoffs', recordId: reference.handoffId } } : previous);
              setIsChatCollapsed(false);
            }}
            activeAppId={activeCanvasAppId}
            onSelectApp={(id) => setActiveCanvasAppId(id)}
            onClose={() => { setIsCanvasOpen(false); setIsChatCollapsed(false); setIsTabbedRailCollapsed(false); }}
          />
        )}

        {/* ── Right rail portal: Supervisor + Blackboard ─────────────────
            Rendered into document.body so it escapes the sidebar's transform.
            railTop tracks the header's viewport-relative bottom via
            getBoundingClientRect, updated on every scroll + resize.
        ──────────────────────────────────────────────────────────────── */}
        {!isAppStudioFullscreen && <CrewRightRailPortal
          surfaceConnections={isCanvasOpen && activeAppSurface && session?.organizationId != null ? <CrewSurfaceConnections surface={activeAppSurface} roomKey={currentRoomKey} organizationId={session.organizationId} /> : undefined}
          railRef={railRef}
          railTop={railTop}
          sidebarLeft={sidebarLeft}
          effectiveChatWidth={effectiveChatWidth}
          isDraggingChatWidth={isDraggingChatWidth}
          hasStudioActive={hasStudioActive}
          isChatCollapsed={isChatCollapsed}
          setIsChatCollapsed={setIsChatCollapsed}
          session={session}
          roomDirection={session && <CrewRoomWorkspace key={`${currentRoomKey}-supervisor`} placement="supervisor" session={session} turns={turns} workProductTurns={workProductTurns} commitments={commitments} decisions={decisions} claims={claims} issues={issues} working={isSending || awaitingFirstTurn} onSaveBrief={saveRoomBrief} onSaveProduct={saveWorkProduct} onRequest={message => void send(message)} />}
          roomWork={session && <CrewRoomWorkspace key={`${currentRoomKey}-blackboard`} placement="blackboard" session={session} turns={turns} workProductTurns={workProductTurns} commitments={commitments} decisions={decisions} claims={claims} issues={issues} working={isSending || awaitingFirstTurn} onSaveBrief={saveRoomBrief} onSaveProduct={saveWorkProduct} onRequest={message => void send(message)} />}
          roomKey={currentRoomKey}
          turns={turns}
          roomAttachments={roomAttachments}
          selectedAssemblyUnit={selectedAssemblyUnit}
          setSelectedAssemblyUnit={setSelectedAssemblyUnit}
          setComposerDraft={setComposerDraft}
          activeStudioKind={activeStudioKind}
          hasScribeActive={hasScribeActive}
          manuscriptRailTarget={manuscriptRailTarget}
          setManuscriptRailTarget={setManuscriptRailTarget}
          exitScribeToScaffold={exitScribeToScaffold}
          hasAppStudioActive={hasAppStudioActive}
          exitAppStudioToScaffold={exitAppStudioToScaffold}
          hasFormStudioActive={hasFormStudioActive}
          exitFormStudioToScaffold={exitFormStudioToScaffold}
          hasFlowStudioActive={hasFlowStudioActive}
          exitFlowStudioToScaffold={exitFlowStudioToScaffold}
          hasPredictionStudioActive={hasPredictionStudioActive}
          exitPredictionStudioToScaffold={exitPredictionStudioToScaffold}
          hasMediaStudioActive={hasMediaStudioActive}
          exitMediaStudioToScaffold={exitMediaStudioToScaffold}
          openMediaStudio={openMediaStudio}
          mediaProductionId={mediaProductionId}
          setMediaProductionId={setMediaProductionId}
          isMediaRailCollapsed={isMediaRailCollapsed}
          setIsMediaRailCollapsed={setIsMediaRailCollapsed}
          hasProjectStudioActive={hasProjectStudioActive}
          exitProjectStudioToScaffold={exitProjectStudioToScaffold}
          openProjectStudio={openProjectStudio}
          hasAgentStudioActive={hasAgentStudioActive}
          exitAgentStudioToScaffold={exitAgentStudioToScaffold}
          hasComputerStudioActive={hasComputerStudioActive}
          exitComputerStudioToScaffold={exitComputerStudioToScaffold}
          openComputerStudio={openComputerStudio}
          hasSignalStudioActive={hasSignalStudioActive}
          exitSignalStudioToScaffold={exitSignalStudioToScaffold}
          openSignalStudio={openSignalStudio}
          onActiveStudioChange={handleActiveStudioChange}
          cycleContext={cycleContext}
          cycleFleetData={cycleFleetData}
          isCyclePipelineCollapsed={isCyclePipelineCollapsed}
          setIsCyclePipelineCollapsed={setIsCyclePipelineCollapsed}
          isTabbedRailCollapsed={isTabbedRailCollapsed}
          setIsTabbedRailCollapsed={setIsTabbedRailCollapsed}
          onSendMessage={(msg) => send(msg)}
          notes={notes}
          decisions={decisions}
          claims={claims}
          commitments={commitments}
          issues={issues}
          plans={plans}
          agentTurns={agentTurns}
          recordKind={recordKind}
          setRecordKind={setRecordKind}
          recordText={recordText}
          setRecordText={setRecordText}
          recordSaving={recordSaving}
          onCreateRecord={handleCreateStructuredRecord}
          onUpdateRecord={updateStructuredRecord}
          onChangeRoomMode={(mode) => void changeRoomMode(mode as CrewSession['mode'])}
        />}

      {/* ── Fixed Bottom-Right Action: Close Room / Re-Open Room ───────────── */}
      {!isCanvasOpen && <CrewBottomActions
        executiveDeckAst={executiveDeckAst}
        onOpenExecutiveBrief={() => setIsExecutiveBriefViewerOpen(true)}
        session={session}
        isReopening={isReopening}
        isConcluding={isConcluding}
        isSending={isSending}
        onReopenMeeting={handleReopenMeeting}
        onConcludeMeeting={handleConcludeMeeting}
        isConcludeDialogOpen={isConcludeDialogOpen}
        setIsConcludeDialogOpen={setIsConcludeDialogOpen}
        onConfirmConcludeMeeting={() => void confirmConcludeMeeting()}
      />}
      </div>

      {/* Interactive Executive Presentation Viewer Modal */}
      <ExecutivePresentationModal
        open={isExecutiveBriefViewerOpen}
        onOpenChange={setIsExecutiveBriefViewerOpen}
        ast={executiveDeckAst}
      />
    </div>
  );
}

export default AgentChatPanel;
