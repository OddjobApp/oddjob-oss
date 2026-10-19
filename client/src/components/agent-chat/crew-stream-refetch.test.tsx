/**
 * An agent turn is announced over SSE twice — a `turn` metadata frame and the
 * `turn-content` frame carrying the record — and the client acted on both: it
 * appended the content AND refetched the room. That refetch is a `?since=`
 * request the server answers with nine queries, spent re-reading a turn the
 * client already held, once per agent, per round.
 *
 * Frames for anyone else carry no content, so those must still reconcile.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queryClient')>()),
  apiRequest: vi.fn(),
}));

type Listener = (event: MessageEvent) => void;

const listeners = new Map<string, Listener[]>();

class EventSourceStub {
  static readonly OPEN = 1;
  readyState = 1;
  onerror: ((e: any) => void) | null = null;
  onopen: ((e: any) => void) | null = null;
  addEventListener(type: string, fn: Listener) {
    listeners.set(type, [...(listeners.get(type) ?? []), fn]);
  }
  removeEventListener() {}
  close() {}
}

const emit = (type: string, payload: Record<string, unknown>) => {
  for (const fn of listeners.get(type) ?? []) {
    fn({ data: JSON.stringify({ type, payload }) } as MessageEvent);
  }
};

import { apiRequest } from '@/lib/queryClient';
import { AgentChatPanel } from './AgentChatPanel';

const ROOM_KEY = 'crew-stream-refetch-test';

/** Room reads only — the count that matters, without the roster or primers. */
const roomReads = () =>
  (apiRequest as any).mock.calls.filter(
    ([, url]: [string, string]) =>
      url.startsWith(`/api/crew/${ROOM_KEY}`) && !url.startsWith('/api/crew/primers'),
  ).length;

beforeEach(() => {
  listeners.clear();
  (globalThis as any).EventSource = EventSourceStub;
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();

  (apiRequest as any).mockImplementation((_m: string, url: string) => {
    if (url.startsWith('/api/agent-cards')) {
      return Promise.resolve({ json: () => Promise.resolve([]) });
    }
    if (url.startsWith('/api/crew/primers')) {
      return Promise.resolve({ json: () => Promise.resolve({ primers: [], topicArchetypes: [] }) });
    }
    if (url.startsWith('/api/crew/')) {
      return Promise.resolve({
        json: () =>
          Promise.resolve({ turns: [], notes: [], plans: [], issues: [], members: [], session: null }),
      });
    }
    return Promise.resolve({ json: () => Promise.resolve({}) });
  });
});

describe('SSE turn frames', () => {
  it('does not refetch the room when an agent turn is announced', async () => {
    render(<AgentChatPanel roomKey={ROOM_KEY} />);
    await waitFor(() => expect(listeners.get('turn')?.length).toBeGreaterThan(0));

    const before = roomReads();
    emit('turn', { speakerType: 'agent', speakerName: 'Copilot', round: 1 });

    await Promise.resolve();
    expect(roomReads()).toBe(before);
  });

  it('still reconciles when the frame is somebody else speaking', async () => {
    render(<AgentChatPanel roomKey={ROOM_KEY} />);
    await waitFor(() => expect(listeners.get('turn')?.length).toBeGreaterThan(0));

    const before = roomReads();
    emit('turn', { speakerType: 'user', speakerName: 'Another participant', round: 1 });

    await waitFor(() => expect(roomReads()).toBe(before + 1));
  });

  it('renders the agent turn from the content frame it already receives', async () => {
    render(<AgentChatPanel roomKey={ROOM_KEY} />);
    await waitFor(() => expect(listeners.get('turn-content')?.length).toBeGreaterThan(0));

    const before = roomReads();
    emit('turn-content', {
      round: 1,
      turn: {
        id: 42,
        speakerType: 'agent',
        speakerName: 'Copilot',
        userId: null,
        content: 'Arrived over the stream.',
        round: 1,
        agentCardId: 1,
        inReplyToTurnId: null,
        topic: null,
        intent: null,
        latencyMs: 120,
        toolsUsed: [],
        artifacts: [],
      },
    });

    await waitFor(() => expect(document.body.textContent).toContain('Arrived over the stream.'));
    expect(roomReads()).toBe(before);
  });
});
