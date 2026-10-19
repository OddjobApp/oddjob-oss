import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Mock apiRequest
// importOriginal + spread so the factory cannot go stale as the module gains
// exports; listing them by hand is what broke when resolveActiveOrgId was added.
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

describe('CREW Room Re-Engagement & Deep-Linked Turn Highlighting', () => {
  beforeEach(() => {
    (globalThis as any).EventSource = EventSourceStub;
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.clearAllMocks();
  });

  it('scrolls to and applies luminous highlight to the deep-linked turn from URL parameter', async () => {
    // Set window.location.search to include highlightTurn=102
    delete (window as any).location;
    (window as any).location = new URL('http://localhost:5000/crew/room-123?highlightTurn=102&focus=simulation');

    (apiRequest as any).mockImplementation((method: string, url: string) => {
      if (url.startsWith('/api/agent-cards')) {
        return Promise.resolve({
          ok: true, status: 200, json: () =>
            Promise.resolve([
              { id: 1, name: 'Simulator Lead', personaType: 'Simulation', tools: [], capabilities: [], enabled: true },
            ]),
        });
      }
      if (url.startsWith('/api/crew/primers')) {
        return Promise.resolve({
          ok: true, status: 200, json: () => Promise.resolve({ primers: [], topicArchetypes: [] }),
        });
      }
      if (url.startsWith('/api/crew/')) {
        return Promise.resolve({
          ok: true, status: 200, json: () =>
            Promise.resolve({
              turns: [
                {
                  id: 101,
                  speakerType: 'user',
                  speakerName: 'Operator',
                  userId: 'user-1',
                  content: 'Can you simulate the load under peak conditions?',
                  round: 1,
                  agentCardId: null,
                  inReplyToTurnId: null,
                  topic: 'simulation',
                  intent: 'request',
                  artifacts: [],
                  toolsUsed: [],
                  createdAt: new Date().toISOString(),
                },
                {
                  id: 102,
                  speakerType: 'agent',
                  speakerName: 'Simulator Lead',
                  userId: null,
                  content: '### 📊 Monte Carlo Simulation Completed\n\nStrategy A demonstrated 99.98% reliability under 10,000 iterations.',
                  round: 2,
                  agentCardId: 1,
                  inReplyToTurnId: 101,
                  topic: 'Simulation Results',
                  intent: 'scenario_simulation',
                  artifacts: [],
                  toolsUsed: [],
                  createdAt: new Date().toISOString(),
                },
              ],
              session: { id: 1, sessionKey: 'room-123', status: 'active' },
              participants: [],
              notes: [],
              plans: [],
              issues: [],
              raisedHands: [],
              currentUserId: 'user-1',
            }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    render(<AgentChatPanel roomKey="room-123" />);

    await waitFor(() => {
      expect(screen.getByText(/Monte Carlo Simulation Completed/i)).toBeInTheDocument();
    });

    await waitFor(() => {
      const targetTurn = document.getElementById('turn-102');
      expect(targetTurn).not.toBeNull();
      expect(targetTurn?.getAttribute('data-turn-id')).toBe('102');
      expect(targetTurn?.className).toContain('ring-2 ring-primary');
      expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });
});
