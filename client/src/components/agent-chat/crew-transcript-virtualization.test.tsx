import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { VirtuosoMockContext } from 'react-virtuoso';

vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queryClient')>()),
  apiRequest: vi.fn(),
}));

class EventSourceStub {
  static readonly OPEN = 1;
  readyState = 1;
  onerror: ((e: any) => void) | null = null;
  onopen: ((e: any) => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

import { apiRequest } from '@/lib/queryClient';
import { AgentChatPanel, VIRTUALIZE_TURNS_AFTER } from './AgentChatPanel';

function makeTurns(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: 1000 + i,
    speakerType: i % 2 === 0 ? 'user' : 'agent',
    speakerName: i % 2 === 0 ? 'Operator' : 'Analyst',
    userId: i % 2 === 0 ? 'user-1' : null,
    content: `Turn number ${i}`,
    round: Math.floor(i / 2) + 1,
    agentCardId: i % 2 === 0 ? null : 1,
    inReplyToTurnId: null,
    topic: null,
    intent: null,
    artifacts: [],
    toolsUsed: [],
    createdAt: new Date().toISOString(),
  }));
}

function mockRoom(turnCount: number) {
  (apiRequest as any).mockImplementation((_method: string, url: string) => {
    const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    if (url.startsWith('/api/agent-cards')) {
      return json([{ id: 1, name: 'Analyst', personaType: 'Analyst', tools: [], capabilities: [], enabled: true }]);
    }
    if (url.startsWith('/api/crew/primers')) return json({ primers: [], topicArchetypes: [] });
    if (url.startsWith('/api/crew/')) {
      return json({
        turns: makeTurns(turnCount),
        session: { id: 1, sessionKey: 'room-long', status: 'active' },
        participants: [],
        notes: [],
        plans: [],
        issues: [],
        raisedHands: [],
        currentUserId: 'user-1',
      });
    }
    return json({});
  });
}

const mountedTurns = () => document.querySelectorAll('[data-turn-id]').length;

describe('CREW transcript windowing', () => {
  beforeEach(() => {
    (globalThis as any).EventSource = EventSourceStub;
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.clearAllMocks();
    delete (window as any).location;
    (window as any).location = new URL('http://localhost:5000/crew/room-long');
  });

  it('keeps every turn mounted at the threshold', async () => {
    mockRoom(VIRTUALIZE_TURNS_AFTER);
    render(<AgentChatPanel roomKey="room-long" />);

    await waitFor(() => expect(mountedTurns()).toBe(VIRTUALIZE_TURNS_AFTER));
  });

  it('mounts only a window of turns once a room passes the threshold', async () => {
    const total = VIRTUALIZE_TURNS_AFTER * 5;
    mockRoom(total);
    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 100 }}>
        <AgentChatPanel roomKey="room-long" />
      </VirtuosoMockContext.Provider>,
    );

    await waitFor(() => expect(mountedTurns()).toBeGreaterThan(0));
    expect(mountedTurns()).toBeLessThan(total);
  });
});
