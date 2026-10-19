import { useState, useRef, useEffect, useCallback } from 'react';
import { apiRequest, resolveActiveOrgId } from '@/lib/queryClient';
import { mergeById, mergeTurns } from './crew-delta';
import {
  subscribeSharedStream,
  type SharedStreamMessage,
  type SharedStreamState,
} from '@domain-ui/core/ui/services/shared-event-source';
import type {
  AgentCard,
  CrewTurn,
  SupervisorNote,
  CrewSession,
  CrewPlan,
  CrewIssue,
  CrewDecision,
  CrewClaim,
  CrewCommitment,
  Participant,
  RaisedHand,
  CrewTurnTopic,
} from './AgentChatPanel';
import type { CycleFleetApp } from './CrewCycleAppCanvas';
import type { CrewRoomBrief } from '@shared/crew-room-brief';
import type { CrewWorkProduct } from '@shared/crew-work-product';

/** The room stream's named events this hook acts on. */
const CREW_STREAM_EVENTS = ['ready', 'turn', 'turn-content', 'round-complete', 'round-cancelled', 'participant', 'blackboard-sync'] as const;

export interface UseCrewSessionOptions {
  roomKey?: string;
  onMembersDiscovered?: (members: AgentCard[]) => void;
  onError?: (error: string | null) => void;
}

export function useCrewSession({
  roomKey,
  onMembersDiscovered,
  onError,
}: UseCrewSessionOptions = {}) {
  const [turns, setTurns] = useState<CrewTurn[]>([]);
  const [workProductTurns, setWorkProductTurns] = useState<Array<{ id: number; speakerName: string; artifacts?: Array<{ payload?: unknown }> }>>([]);
  const [notes, setNotes] = useState<SupervisorNote[]>([]);
  const [plans, setPlans] = useState<CrewPlan[]>([]);
  const [issues, setIssues] = useState<CrewIssue[]>([]);
  const [decisions, setDecisions] = useState<CrewDecision[]>([]);
  const [claims, setClaims] = useState<CrewClaim[]>([]);
  const [commitments, setCommitments] = useState<CrewCommitment[]>([]);
  const [turnTopics, setTurnTopics] = useState<CrewTurnTopic[]>([]);
  const [raisedHands, setRaisedHands] = useState<RaisedHand[]>([]);
  const [dismissedHands, setDismissedHands] = useState<Set<number>>(new Set());
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [session, setSession] = useState<CrewSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionLost, setConnectionLost] = useState(false);
  const [awaitingFirstTurn, setAwaitingFirstTurn] = useState(false);
  const [isConcluding, setIsConcluding] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [isConcludeDialogOpen, setIsConcludeDialogOpen] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);

  const setError = useCallback((msg: string | null) => {
    setErrorState(msg);
    onError?.(msg);
  }, [onError]);

  const [breakoutLineage, setBreakoutLineage] = useState<{
    parent: { sessionKey: string; title: string | null; url: string } | null;
    children: Array<{ id: number; subTopic: string; suggestedBy: string; sessionKey: string; title: string | null; url: string }>;
  } | null>(null);

  const [cycleFleetData, setCycleFleetData] = useState<{
    cycleSlug: string | null;
    cycleName: string | null;
    stageId: string | null;
    stageName: string | null;
    apps: CycleFleetApp[];
  } | null>(null);

  const lastSeenTurnId = useRef<number>(0);
  const sessionIdRef = useRef<string>(roomKey || '');
  if (roomKey && sessionIdRef.current !== roomKey) {
    sessionIdRef.current = roomKey;
  }

  const fetchCycleFleet = useCallback(async () => {
    try {
      const res = await apiRequest('GET', `/api/crew/${sessionIdRef.current}/cycle-fleet`);
      if (res.ok) {
        const data = await res.json();
        setCycleFleetData(data);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const fetchBreakouts = useCallback(async () => {
    try {
      const res = await apiRequest('GET', `/api/crew/${sessionIdRef.current}/breakouts`);
      if (res.ok) {
        const data = await res.json();
        setBreakoutLineage(data);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const applyRoom = useCallback((room: any) => {
    const isDelta = room.delta === true;
    setWorkProductTurns(room.workProductTurns ?? []);

    setTurns((prev) => (isDelta ? mergeTurns(prev, room.turns ?? []) : (room.turns ?? [])));
    setNotes((prev) => (isDelta ? mergeById(prev, room.notes ?? [], 'asc') : (room.notes ?? [])));
    setPlans((prev) => (isDelta ? mergeById(prev, room.plans ?? [], 'desc') : (room.plans ?? [])));
    setIssues((prev) => (isDelta ? mergeById(prev, room.issues ?? [], 'desc') : (room.issues ?? [])));
    setDecisions((prev) => (isDelta ? mergeById(prev, room.decisions ?? [], 'desc') : (room.decisions ?? [])));
    setClaims((prev) => (isDelta ? mergeById(prev, room.claims ?? [], 'desc') : (room.claims ?? [])));
    setCommitments((prev) => (isDelta ? mergeById(prev, room.commitments ?? [], 'desc') : (room.commitments ?? [])));
    setTurnTopics((prev) => (isDelta ? mergeById(prev, room.turnTopics ?? [], 'asc') : (room.turnTopics ?? [])));
    setParticipants(room.participants ?? []);
    setCurrentUserId(room.currentUserId ?? null);
    setRaisedHands(room.raisedHands ?? []);

    if (Array.isArray(room.members) && room.members.length > 0) {
      onMembersDiscovered?.(room.members as AgentCard[]);
    }

    if (typeof room.cursor === 'number' && room.cursor > lastSeenTurnId.current) {
      lastSeenTurnId.current = room.cursor;
    }

    const incomingSession = room.session ?? null;
    setSession(incomingSession);

    if (incomingSession?.organizationId && typeof window !== 'undefined') {
      try {
        const currentParams = new URLSearchParams(window.location.search);
        if (currentParams.get('orgId') !== String(incomingSession.organizationId)) {
          currentParams.set('orgId', String(incomingSession.organizationId));
          const newUrl = `${window.location.pathname}?${currentParams.toString()}`;
          window.history.replaceState(null, '', newUrl);
        }
        sessionStorage.setItem('selectedOrganizationId', String(incomingSession.organizationId));
      } catch {}
    }

    void fetchBreakouts();
    void fetchCycleFleet();
  }, [fetchBreakouts, fetchCycleFleet, onMembersDiscovered]);

  const appendTurn = useCallback((turn: CrewTurn) => {
    setTurns((prev) => mergeTurns(prev, [turn]));
    if (turn.id > lastSeenTurnId.current) lastSeenTurnId.current = turn.id;
    if (turn.speakerType !== 'user') setAwaitingFirstTurn(false);
  }, []);

  const handleConcludeMeeting = useCallback(() => {
    if (isConcluding) return;
    setIsConcludeDialogOpen(true);
  }, [isConcluding]);

  const confirmConcludeMeeting = useCallback(async () => {
    setIsConcludeDialogOpen(false);
    setIsConcluding(true);
    try {
      const res = await apiRequest('POST', `/api/crew/${sessionIdRef.current}/conclude`);
      if (!res.ok) throw new Error(`The room could not be concluded (${res.status}).`);
      const data = await res.json();
      if (data.turn) appendTurn(data.turn);
      if (data.session) setSession(data.session);
    } catch (err: any) {
      console.error('Failed to conclude meeting:', err);
      setError(err?.message || 'Failed to conclude the room.');
    } finally {
      setIsConcluding(false);
    }
  }, [appendTurn, setError]);

  const handleReopenMeeting = useCallback(async () => {
    if (isReopening) return;
    setIsReopening(true);
    try {
      const res = await apiRequest('POST', `/api/crew/${sessionIdRef.current}/reopen`);
      if (res.ok) {
        const data = await res.json();
        if (data.turn) appendTurn(data.turn);
        if (data.session) setSession(data.session);
      }
    } catch (err) {
      console.error('Failed to reopen meeting:', err);
    } finally {
      setIsReopening(false);
    }
  }, [appendTurn, isReopening]);

  const fetchRoom = useCallback(async (opts?: { full?: boolean }) => {
    const since = lastSeenTurnId.current;
    const url =
      opts?.full || since <= 0
        ? `/api/crew/${sessionIdRef.current}`
        : `/api/crew/${sessionIdRef.current}?since=${since}`;
    const res = await apiRequest('GET', url);
    // An error body is JSON too — letting it reach applyRoom would parse a
    // 4xx/5xx as an empty room and wipe the transcript until the next poll.
    if (!res.ok) throw new Error(`Room fetch failed (${res.status})`);
    return res.json();
  }, []);

  const changeRoomMode = useCallback(async (mode: CrewSession['mode']) => {
    if (session === null) return;
    try {
      const response = await apiRequest('PATCH', `/api/crew/${sessionIdRef.current}/state`, { mode });
      const body = await response.json();
      setSession(body.session);
    } catch (err: any) {
      setError(err?.message || 'Could not change the room mode.');
    }
  }, [session, setError]);

  const saveRoomBrief = useCallback(async (brief: CrewRoomBrief) => {
    const response = await apiRequest('PATCH', `/api/crew/${sessionIdRef.current}/brief`, brief);
    if (!response.ok) throw new Error(`Could not save the room brief (${response.status}).`);
    const body = await response.json();
    setSession(body.session);
  }, []);

  const saveWorkProduct = useCallback(async (product: CrewWorkProduct) => {
    const response = await apiRequest('POST', `/api/crew/${sessionIdRef.current}/work-product`, product);
    if (!response.ok) throw new Error(`Could not save the work product (${response.status}).`);
    const body = await response.json();
    if (body.turn) appendTurn(body.turn);
  }, [appendTurn]);

  const createStructuredRecord = useCallback(async (kind: 'decision' | 'claim' | 'commitment', text: string) => {
    const value = text.trim();
    if (!value || !session) return;
    try {
      const path = kind === 'decision' ? 'decisions' : kind === 'claim' ? 'claims' : 'commitments';
      const payload = kind === 'decision' ? { statement: value } : kind === 'claim' ? { claim: value } : { title: value };
      await apiRequest('POST', `/api/crew/${sessionIdRef.current}/${path}`, payload);
      applyRoom(await fetchRoom({ full: true }));
    } catch (err: any) {
      setError(err?.message || `Could not record the ${kind}.`);
      throw err;
    }
  }, [session, applyRoom, fetchRoom, setError]);

  const updateStructuredRecord = useCallback(async (kind: 'decisions' | 'claims' | 'commitments', id: number, status: string) => {
    try {
      await apiRequest('PATCH', `/api/crew/${sessionIdRef.current}/${kind}/${id}`, { status });
      applyRoom(await fetchRoom({ full: true }));
    } catch (err: any) {
      setError(err?.message || 'Could not update the record.');
    }
  }, [applyRoom, fetchRoom, setError]);

  // Reset state on roomKey change
  useEffect(() => {
    lastSeenTurnId.current = 0;
    setTurns([]);
    setWorkProductTurns([]);
    setNotes([]);
    setPlans([]);
    setIssues([]);
    setDecisions([]);
    setClaims([]);
    setCommitments([]);
    setTurnTopics([]);
    setRaisedHands([]);
    setDismissedHands(new Set());
    setSession(null);
    setIsLoading(true);
    setError(null);
  }, [roomKey, setError]);

  // Live SSE updates, through the shared stream: the same room open in several
  // tabs holds one connection between them instead of one each, against the
  // browser's six-per-host HTTP/1.1 limit. The org is read here, as before, not
  // followed: useCrewSession pins it to the room's own org, and a room does not
  // move between orgs.
  useEffect(() => {
    if (!roomKey) return;
    const streamOrgId = resolveActiveOrgId();
    const streamUrl = `/api/crew/${roomKey}/stream`
      + (streamOrgId !== null ? `?orgId=${streamOrgId}` : '');

    const refresh = () => {
      fetchRoom().then(applyRoom).catch(() => {});
    };

    const onMessage = ({ event, data }: SharedStreamMessage) => {
      switch (event) {
        case 'turn-content':
          try {
            const payload = JSON.parse(data)?.payload;
            const turn = payload?.turn;
            if (turn && typeof turn.id === 'number') appendTurn(turn);
            // Agent-declared tags arrive with the turn so chips render
            // immediately; the next delta fetch reconciles them anyway.
            if (Array.isArray(payload?.turnTopics) && turn && typeof turn.id === 'number') {
              const rows: CrewTurnTopic[] = payload.turnTopics.map((t: any) => ({
                id: t.turnTopicId,
                sessionId: turn.sessionId,
                turnId: turn.id,
                organizationId: turn.organizationId,
                round: payload.round ?? turn.round,
                topicId: t.topicId ?? null,
                label: t.label,
                rawLabel: t.rawLabel ?? t.label,
                source: 'agent' as const,
                status: t.status ?? 'applied',
              }));
              setTurnTopics((prev) => mergeById(prev, rows, 'asc'));
            }
          } catch {}
          return;
        case 'turn':
          try {
            if (JSON.parse(data)?.payload?.speakerType === 'agent') return;
          } catch {}
          refresh();
          return;
        case 'round-complete':
          setDismissedHands(new Set());
          refresh();
          return;
        case 'round-cancelled':
          setAwaitingFirstTurn(false);
          refresh();
          return;
        case 'participant':
        case 'blackboard-sync':
          refresh();
          return;
        case 'ready':
          setConnectionLost(false);
          refresh();
          return;
      }
    };

    // A reopened stream may have missed frames, so it reconciles; the first
    // open does not, because the room was just fetched.
    let hasOpened = false;
    const onState = (state: SharedStreamState) => {
      if (state === 'open') {
        setConnectionLost(false);
        if (hasOpened) refresh();
        hasOpened = true;
      } else if (state === 'closed' || hasOpened) {
        setConnectionLost(true);
      }
    };

    return subscribeSharedStream(streamUrl, onMessage, onState, {
      events: [...CREW_STREAM_EVENTS],
      // Every frame here triggers a refetch; a replayed backlog would fire one
      // per message. The room is fetched on mount instead.
      replay: false,
    });
  }, [roomKey, applyRoom, appendTurn, fetchRoom]);

  return {
    turns,
    workProductTurns,
    setTurns,
    notes,
    setNotes,
    plans,
    setPlans,
    issues,
    setIssues,
    decisions,
    setDecisions,
    claims,
    setClaims,
    commitments,
    setCommitments,
    turnTopics,
    setTurnTopics,
    raisedHands,
    setRaisedHands,
    dismissedHands,
    setDismissedHands,
    participants,
    setParticipants,
    currentUserId,
    setCurrentUserId,
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
  };
}
