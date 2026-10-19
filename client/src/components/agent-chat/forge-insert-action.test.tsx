/**
 * The "Add to App Requirements" action, offered per structured specification
 * rather than conversational turns.
 *
 * Tests:
 * 1. Action is offered only when App Forge Studio is active.
 * 2. Filters out conversational pleasantries and greeting banter.
 * 3. Extracts clean specifications without handoff openers/closers.
 * 4. Dispatches the `forge:add-requirement` CustomEvent with text and agentName.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

const SPEC_SAMPLE =
  'Feature: Real-Time Fleet Tracking\n' +
  '- As an operations lead, I want to track active vehicle positions on an Eulerian hex map.\n' +
  '- Endpoints: GET /api/fleet/live, POST /api/fleet/geofence\n' +
  '- Data Model: vehicles (id, vin, status, h3_index, updated_at)';

const turn = (id: number, content: string, artifacts: any[] = []) => ({
  id,
  speakerType: 'agent',
  speakerName: 'Systems Architect',
  userId: null,
  content,
  round: 1,
  agentCardId: 1,
  inReplyToTurnId: null,
  topic: 'architecture',
  intent: 'spec',
  latencyMs: 100,
  toolsUsed: [],
  artifacts,
});

/** Mount artifact that activates App Forge mode in the rail */
const FORGE_MOUNT = [
  {
    tool: 'mount_app_studio',
    payload: {
      type: 'app_studio_pod',
      mode: 'forge',
      appName: 'Fleet Tracker',
    },
  },
];

const stubRoom = (turns: any[]) => {
  (apiRequest as any).mockImplementation((_m: string, url: string) => {
    if (url.startsWith('/api/agent-cards')) {
      return Promise.resolve({
        ok: true, status: 200, json: () =>
          Promise.resolve([
            { id: 1, name: 'Systems Architect', personaType: 'Architect', tools: [], capabilities: [], enabled: true },
          ]),
      });
    }
    if (url.startsWith('/api/crew/primers')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ primers: [], topicArchetypes: [] }) });
    }
    if (url.startsWith('/api/crew/')) {
      return Promise.resolve({
        ok: true, status: 200, json: () =>
          Promise.resolve({ turns, notes: [], plans: [], issues: [], members: [], session: { consensusLevel: 100 } }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
};

let queryClient: QueryClient;

function renderWithClient(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}

describe('adding agent specifications to App Forge requirements', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    (globalThis as any).EventSource = EventSourceStub;
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.clearAllMocks();
    // The panel mirrors the open studio into ?studio=, and jsdom keeps one
    // window for the whole file — so a test that mounts App Forge leaves
    // ?studio=app behind, which useCrewStudios reads as a standing request to
    // open Forge (studio=app with no appId). Without this reset the
    // "not mounted" case inherits the previous test's URL and sees a mounted
    // studio. Resetting the URL, not the behaviour: arriving with ?studio=app
    // really should open Forge.
    window.history.replaceState({}, '', '/');
  });

  it('offers "Add to App Requirements" only for turns with actual specifications', async () => {
    stubRoom([
      turn(1, "Hello! I am your Systems Architect. I'm ready to design this service.", FORGE_MOUNT),
      turn(2, "Let me analyze the uploaded workflow and draft the requirements."),
      turn(3, `Certainly! Here is the architecture specification:\n\n${SPEC_SAMPLE}`),
    ]);

    renderWithClient(<AgentChatPanel roomKey="crew-forge-insert-test" />);

    await waitFor(() => expect(screen.getAllByTestId('forge-insert-requirement')).toHaveLength(1));
  });

  it('dispatches forge:add-requirement with stripped specification and agentName', async () => {
    stubRoom([
      turn(
        1,
        `Certainly! Based on the uploaded diagram, here is the spec:\n\n${SPEC_SAMPLE}\n\nLet me know if you would like me to adjust any fields.`,
        FORGE_MOUNT,
      ),
    ]);

    const events: { text: string; agentName: string }[] = [];
    window.addEventListener('forge:add-requirement', (e) => {
      events.push((e as CustomEvent).detail);
    });

    renderWithClient(<AgentChatPanel roomKey="crew-forge-insert-test" />);

    const button = await screen.findByTestId('forge-insert-requirement');
    fireEvent.click(button);

    expect(events).toHaveLength(1);
    expect(events[0].text).toBe(SPEC_SAMPLE);
    expect(events[0].agentName).toBe('Systems Architect');
  });

  it('does not offer the action when App Forge studio is not mounted', async () => {
    stubRoom([
      turn(1, `Here is the architecture specification:\n\n${SPEC_SAMPLE}`),
    ]);

    renderWithClient(<AgentChatPanel roomKey="crew-forge-insert-test" />);

    // Wait for the room to render turns
    await screen.findByText(/Here is the architecture specification/);
    expect(screen.queryByTestId('forge-insert-requirement')).toBeNull();
  });
});
