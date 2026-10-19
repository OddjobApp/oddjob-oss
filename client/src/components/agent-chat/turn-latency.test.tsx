/**
 * The latency a turn reports, and what happens when it has none.
 *
 * The guard read `turn.latencyMs !== null`, which an absent field passes —
 * undefined is not null — so the row rendered `(undefined / 1000).toFixed(1)`
 * and printed "NaNs" beside the speaker's name. Anything that builds a turn
 * without the field hits it: a fixture, an older row, a partial payload.
 *
 * It is a small thing to see and a hard thing to explain, which is why it sat
 * in every frame of the product tour without anyone reading it as a bug.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

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
import { AgentChatPanel } from './AgentChatPanel';

/** How a rendered latency looks, and nothing else on the page does. */
const LATENCY = /^\d+\.\d+s$/;

const turn = (over: Record<string, unknown>) => ({
  id: 1,
  speakerType: 'agent',
  speakerName: 'Scribe Lead',
  userId: null,
  content: 'Scribe Studio is ready. Start with the document brief.',
  round: 1,
  agentCardId: 1,
  inReplyToTurnId: null,
  topic: 'authoring',
  intent: 'draft',
  toolsUsed: [],
  artifacts: [],
  ...over,
});

const stubRoom = (turns: any[]) => {
  (apiRequest as any).mockImplementation((_m: string, url: string) => {
    if (url.startsWith('/api/agent-cards')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ id: 1, name: 'Scribe Lead', personaType: 'Lead Directive', tools: [], capabilities: [], enabled: true }]) });
    }
    if (url.startsWith('/api/crew/primers')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ primers: [], topicArchetypes: [] }) });
    }
    if (url.startsWith('/api/crew/')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ turns, notes: [], plans: [], issues: [], members: [], session: { consensusLevel: 100 } }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
};

describe('turn latency', () => {
  beforeEach(() => {
    (globalThis as any).EventSource = EventSourceStub;
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.clearAllMocks();
  });

  it('says nothing when the turn carries no latency at all', async () => {
    stubRoom([turn({})]);

    render(<AgentChatPanel roomKey="crew-latency-test" />);

    await screen.findByText(/document brief/);
    // The latency badge is the only thing rendered in this shape.
    expect(screen.queryByText(LATENCY)).not.toBeInTheDocument();
    expect(screen.queryByText("NaNs")).not.toBeInTheDocument();
  });

  it('says nothing when the latency is explicitly null', async () => {
    stubRoom([turn({ latencyMs: null })]);

    render(<AgentChatPanel roomKey="crew-latency-test" />);

    await screen.findByText(/document brief/);
    expect(screen.queryByText(LATENCY)).not.toBeInTheDocument();
  });

  it('still reports a latency it was given', async () => {
    stubRoom([turn({ latencyMs: 1240 })]);

    render(<AgentChatPanel roomKey="crew-latency-test" />);

    expect(await screen.findByText('1.2s')).toBeInTheDocument();
  });

  it('says nothing for a latency that is not a number', async () => {
    // A partial payload can carry the key without a value.
    stubRoom([turn({ latencyMs: "fast" })]);

    render(<AgentChatPanel roomKey="crew-latency-test" />);

    await screen.findByText(/document brief/);
    await waitFor(() => expect(screen.queryByText("NaNs")).not.toBeInTheDocument());
    expect(screen.queryByText(LATENCY)).not.toBeInTheDocument();
  });
});
