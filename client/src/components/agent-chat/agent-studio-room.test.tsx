import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

const AGENT_MOUNT = [{ tool: 'mount_agent_studio', payload: { type: 'agent_studio_pod', props: { agentId: 1, view: 'identity' } } }];

const agent = { id: 1, name: 'Line Producer', personaType: 'Producer', tools: [], capabilities: [], enabled: true };

function stubRoom() {
  (apiRequest as any).mockImplementation((_method: string, url: string) => {
    if (url.startsWith('/api/agent-cards')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([agent]) });
    if (url.startsWith('/api/crew/primers')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ primers: [], topicArchetypes: [] }) });
    if (url.startsWith('/api/crew/')) {
      return Promise.resolve({
        ok: true, status: 200, json: () => Promise.resolve({
          turns: [{
            id: 1, speakerType: 'agent', speakerName: 'Line Producer', userId: null, content: 'Opening Agent Studio.',
            round: 1, agentCardId: 1, inReplyToTurnId: null, topic: 'film', intent: 'spec', latencyMs: 100, toolsUsed: [], artifacts: AGENT_MOUNT,
          }],
          notes: [], plans: [], issues: [], members: [agent],
          session: { consensusLevel: 100, activeTopic: 'Rooftop chase' },
        }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe('Agent Studio in a CREW room', () => {
  beforeEach(() => {
    (globalThis as any).EventSource = EventSourceStub;
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    localStorage.clear();
    vi.clearAllMocks();
    stubRoom();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('opens the studio beside the chat, points to it from the turn, and closes it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["/api/agent-cards"], [agent]);
    render(<QueryClientProvider client={client}><AgentChatPanel roomKey="crew-agent-test" /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByTestId('agent-studio')).toBeInTheDocument());
    expect(await screen.findByTestId('agent-studio-identity')).toBeInTheDocument();
    // The room switches to its studio layout: the chat pane beside a studio can be resized.
    expect(screen.getByTestId('chat-pane-resize-handle')).toBeInTheDocument();
    expect(screen.getByText('Agent Studio is open beside the conversation')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('agent-studio-close'));
    await waitFor(() => expect(screen.queryByTestId('agent-studio')).not.toBeInTheDocument());
  });

  it('shows a labeled chat toggle while focused', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["/api/agent-cards"], [agent]);
    render(<QueryClientProvider client={client}><AgentChatPanel roomKey="crew-agent-focus-test" /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByTestId('agent-studio')).toBeInTheDocument());
    const focusButton = screen.getByRole('button', { name: 'Focus Studio' });
    expect(focusButton).toHaveTextContent('Focus Studio');

    fireEvent.click(focusButton);
    const showChatButton = await screen.findByRole('button', { name: 'Show Chat' });
    expect(showChatButton).toHaveTextContent('Show Chat');

    fireEvent.click(showChatButton);
    expect(await screen.findByRole('button', { name: 'Focus Studio' })).toBeInTheDocument();
  });
});
