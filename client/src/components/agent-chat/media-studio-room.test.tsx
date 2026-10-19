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

// The artifact a room turn carries after mount_media_studio runs.
const MEDIA_MOUNT = [{
  tool: 'mount_media_studio',
  payload: {
    type: 'media_studio_pod', module: 'MediaStudioPod', component: 'MediaStudioPod',
    title: 'Rooftop chase', sceneId: 'SCENE-03', sceneTitle: 'Rooftop chase', aspectRatio: '2.39:1',
  },
}];

const agent = { id: 1, name: 'Line Producer', personaType: 'Producer', tools: [], capabilities: [], enabled: true };

function stubRoom() {
  (apiRequest as any).mockImplementation((_method: string, url: string) => {
    if (url.startsWith('/api/agent-cards')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([agent]) });
    if (url.startsWith('/api/crew/primers')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ primers: [], topicArchetypes: [] }) });
    if (url.startsWith('/api/crew/')) {
      return Promise.resolve({
        ok: true, status: 200, json: () => Promise.resolve({
          turns: [{
            id: 1, speakerType: 'agent', speakerName: 'Line Producer', userId: null, content: 'Opening Media Studio for the chase.',
            round: 1, agentCardId: 1, inReplyToTurnId: null, topic: 'film', intent: 'spec', latencyMs: 100, toolsUsed: [], artifacts: MEDIA_MOUNT,
          }],
          notes: [], plans: [], issues: [], members: [agent],
          session: { consensusLevel: 100, activeTopic: 'Rooftop chase' },
        }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe('Media Studio in a CREW room', () => {
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AgentChatPanel roomKey="crew-media-test" /></QueryClientProvider>);

    await waitFor(() => expect(screen.getByTestId('media-studio-rail')).toBeInTheDocument());
    // The room has no production yet, so the studio offers to start one.
    expect(await screen.findByTestId('media-studio-start')).toBeInTheDocument();
    // The room switches to its studio layout: the chat pane beside a studio can be resized.
    expect(screen.getByTestId('chat-pane-resize-handle')).toBeInTheDocument();
    expect(screen.getByText('Media Studio is open beside the conversation')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('close-media-studio-btn'));
    await waitFor(() => expect(screen.queryByTestId('media-studio-rail')).not.toBeInTheDocument());
  });
});
