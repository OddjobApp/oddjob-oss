import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInterventionEngine, type AssistantInboxItem } from '../use-intervention-engine';

let currentUser: { id: string } | null = { id: 'user-1' };

vi.mock('@domain-ui/auth/ui/modules/auth', () => ({
  useAuth: () => ({ user: currentUser }),
}));

// Capture router navigation. Accepting a deliberation used to assign
// window.location.href, which tears down the SPA and refetches the bundle to
// reach a route this router already owns; jsdom does not implement navigation,
// so the old behaviour could not have been asserted at all.
const setLocation = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/somewhere', setLocation],
}));

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(
    public url: string,
    public options?: EventSourceInit,
  ) {
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(eventType: string, payload: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ eventType, payload }) } as MessageEvent);
  }

  static latest() {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }
}

function makeInboxItem(overrides: Partial<AssistantInboxItem> = {}): AssistantInboxItem {
  return {
    id: 'iv-inbox',
    memoryId: 17,
    thresholdId: 21,
    vector: 'C',
    title: 'Review queue pressure',
    description: 'A scored intervention needs attention.',
    aiPrompt: 'Help me triage this intervention.',
    actionLabel: 'Open',
    rationale: 'High confidence test rationale.',
    priority: 'high',
    sessionId: 'session-1',
    source: 'intervention.triggered',
    receivedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    outcome: 'unread',
    context: { source: 'test' },
    confidence: 0.92,
    ...overrides,
  };
}

function emitIntervention(id: string, priority: AssistantInboxItem['priority'] = 'medium') {
  act(() => {
    MockEventSource.latest().emit('intervention.triggered', {
      interventionId: id,
      memoryId: 10,
      thresholdId: 20,
      vector: 'C',
      title: `Intervention ${id}`,
      description: `Description for ${id}`,
      aiPrompt: `Prompt for ${id}`,
      priority,
      sessionId: 'session-1',
      receivedAt: Date.now(),
      context: { source: 'test' },
    });
  });
}

function outcomeBodies() {
  return vi.mocked(globalThis.fetch).mock.calls
    .filter(([url]) => url === '/api/scoring/interventions/outcome')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

describe('useInterventionEngine workbench outcomes', () => {
  beforeEach(() => {
    currentUser = { id: 'user-1' };
    MockEventSource.instances = [];
    // Module-level mock: without this it carries the previous test's navigation.
    setLocation.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-07T16:00:00.000Z'));
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports accepted when an inbox item is opened from the workbench', () => {
    const inboxItem = makeInboxItem({ id: 'iv-inbox-open' });
    localStorage.setItem('oddjob_assistant_inbox', JSON.stringify([inboxItem]));
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const { result } = renderHook(() => useInterventionEngine());

    act(() => {
      result.current.acceptInboxItem(result.current.assistantInbox[0]);
    });

    expect(outcomeBodies()).toEqual([
      {
        interventionId: 'iv-inbox-open',
        outcome: 'accepted',
        timestamp: inboxItem.receivedAt,
      },
    ]);
    expect(result.current.assistantInbox[0].outcome).toBe('accepted');
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent-assist-request',
      detail: expect.objectContaining({ prompt: inboxItem.aiPrompt, context: expect.objectContaining({ assistantView: 'chat' }) }),
    }));
  });

  it('reports dismissed for the active and queued interventions when clearing the live queue', () => {
    const { result } = renderHook(() => useInterventionEngine());
    emitIntervention('iv-active', 'high');
    emitIntervention('iv-queued', 'medium');

    expect(result.current.active?.id).toBe('iv-active');
    expect(result.current.queueLength).toBe(1);

    act(() => {
      result.current.clearQueue();
    });

    expect(outcomeBodies()).toEqual([
      expect.objectContaining({ interventionId: 'iv-active', outcome: 'dismissed' }),
      expect.objectContaining({ interventionId: 'iv-queued', outcome: 'dismissed' }),
    ]);
    expect(result.current.active).toBeNull();
    expect(result.current.queueLength).toBe(0);
  });

  it('reports ignored for unread persisted inbox items when clearing the workbench inbox', () => {
    const unread = makeInboxItem({ id: 'iv-unread', outcome: 'unread' });
    const accepted = makeInboxItem({ id: 'iv-accepted', outcome: 'accepted' });
    localStorage.setItem('oddjob_assistant_inbox', JSON.stringify([unread, accepted]));

    const { result } = renderHook(() => useInterventionEngine());

    act(() => {
      result.current.clearAssistantInbox();
    });

    expect(outcomeBodies()).toEqual([
      {
        interventionId: 'iv-unread',
        outcome: 'ignored',
        timestamp: unread.receivedAt,
      },
    ]);
    expect(result.current.assistantInbox).toEqual([]);
  });


  it.each(['accepted', 'expired'] as const)('opens the room from a persisted %s deliberation card', (outcome) => {
    const item = makeInboxItem({ id: 'deliberation-77', outcome, context: { deliberationRoom: '/workspace/chat/deliberation-77' } });
    localStorage.setItem('oddjob_assistant_inbox', JSON.stringify([item]));
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { result } = renderHook(() => useInterventionEngine());
    act(() => result.current.acceptInboxItem(result.current.assistantInbox[0]));
    expect(setLocation).toHaveBeenCalledWith('/workspace/chat/deliberation-77');
    expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'agent-assist-request' }));
    expect(result.current.assistantInbox[0].outcome).toBe('accepted');
  });

  it('routes to the deliberation room instead of reloading the page', () => {
    const { result } = renderHook(() => useInterventionEngine());

    act(() => {
      MockEventSource.latest().emit('deliberation.started', {
        approvalId: 77,
        pipelineName: 'Warehouse Optimization',
        stepName: 'Partition Migration',
      });
    });

    act(() => {
      result.current.accept();
    });

    expect(setLocation).toHaveBeenCalledWith('/workspace/chat/deliberation-77');
  });

  it('still dispatches the assist event for interventions with no room', () => {
    const dispatched: CustomEvent[] = [];
    const listener = (e: Event) => dispatched.push(e as CustomEvent);
    window.addEventListener('agent-assist-request', listener);

    const { result } = renderHook(() => useInterventionEngine());

    act(() => {
      MockEventSource.latest().emit('intervention.triggered', {
        interventionId: 'iv-plain',
        title: 'Assistant Insight',
        description: 'Something to look at',
        aiPrompt: 'help me',
      });
    });

    act(() => {
      result.current.accept();
    });

    window.removeEventListener('agent-assist-request', listener);

    // The room branch must not have swallowed the ordinary path.
    expect(setLocation).not.toHaveBeenCalled();
    expect(dispatched).toHaveLength(1);
  });

  it('enqueues a deliberation intervention when deliberation.started is received', () => {
    const { result } = renderHook(() => useInterventionEngine());

    act(() => {
      MockEventSource.latest().emit('deliberation.started', {
        approvalId: 1042,
        pipelineName: 'Warehouse Optimization',
        stepName: 'Partition Migration',
        description: 'Partition Migration paused for human quorum. Guardian & Optimizer are deliberating trade-offs.',
      });
    });

    expect(result.current.active).not.toBeNull();
    expect(result.current.active?.id).toBe('deliberation-1042');
    expect(result.current.active?.title).toContain('Agora Deliberation: Warehouse Optimization');
    expect(result.current.active?.actionLabel).toBe('Join Deliberation Room');
    expect(result.current.active?.context?.deliberationRoom).toBe('/workspace/chat/deliberation-1042');
  });
});
