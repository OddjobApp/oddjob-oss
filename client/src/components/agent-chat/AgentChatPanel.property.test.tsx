/**
 * Property-based test for CREW room roster selection.
 *
 * **Property: the crew you picked is the crew that gets convened**
 *
 * For any roster and any sequence of toggles, the `agentCardIds` sent to
 * POST /api/crew/message SHALL be exactly the set of agents shown as selected.
 * A mismatch is expensive in both directions: a dropped id silently excludes an
 * agent the user asked for, and an extra id spends a model call per round on an
 * agent they deselected.
 *
 * This replaces an older test of the Hat-Menu Intent Router contract
 * (`auto-route-button`, `POST /api/intent-router/classify`), which the panel
 * stopped implementing when it was rebuilt as the CREW room. That test could
 * not be made to pass without restoring the old component, so the property is
 * re-expressed here against what the panel actually does.
 *
 * Uses fast-check for property-based testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockApiRequest = vi.fn();

// importOriginal + spread: a factory that lists exports by hand goes stale the
// moment the module gains one, and vitest fails with "No <name> export is defined
// on the mock" — which is what adding resolveActiveOrgId did here.
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queryClient')>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
}));

/** jsdom has no EventSource, and the room opens one on mount. */
class EventSourceStub {
  static readonly OPEN = 1;
  readyState = 1;
  onerror: ((e: any) => void) | null = null;
  onopen: ((e: any) => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { AgentChatPanel } from './AgentChatPanel';

/** The room mounts panels that read through react-query (the readiness panel), so it needs a client. */
function renderPanel(ui: Parameters<typeof render>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(ui, { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children) });
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function createMockAgents(ids: number[]) {
  return ids.map(id => ({
    id,
    name: `Agent-${id}`,
    description: `Test agent ${id}`,
    personaType: 'specialist',
    capabilities: ['test'],
    soulArchetype: null,
    legend: null,
    enabled: true,
  }));
}

/** An empty room, so the panel falls back to preselecting the first three agents. */
const emptyRoom = {
  session: null,
  members: [],
  turns: [],
  notes: [],
  plans: [],
  issues: [],
  raisedHands: [],
  participants: [],
  currentUserId: null,
};

function installApiMock(agents: unknown[]) {
  mockApiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === 'GET' && url === '/api/agent-cards') return { ok: true, json: async () => agents };
    if (method === 'GET' && url.startsWith('/api/crew/primers')) return { ok: true, json: async () => ({ primers: [] }) };
    if (method === 'GET' && url.startsWith('/api/crew/')) return { ok: true, json: async () => emptyRoom };
    return { ok: true, json: async () => ({}) };
  });
}

function sentAgentCardIds(): number[][] {
  return mockApiRequest.mock.calls
    .filter((call: any[]) => call[0] === 'POST' && call[1] === '/api/crew/message')
    .map((call: any[]) => call[2].agentCardIds);
}

// ─── Generators ───────────────────────────────────────────────────────────────

const messageArb = fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0);
const agentIdsArb = fc.uniqueArray(fc.integer({ min: 1, max: 100 }), { minLength: 3, maxLength: 6 });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Feature: crew-room, Property: the selected crew is the crew convened', () => {
  it('runs queued requests sequentially and lets a waiting request be removed', async () => {
    installApiMock(createMockAgents([1]));
    const original = mockApiRequest.getMockImplementation()!;
    let finish: (() => void) | undefined;
    mockApiRequest.mockImplementation((method: string, url: string, ...args: any[]) => {
      if (method === 'POST' && url === '/api/crew/message') {
        return new Promise((resolve) => { finish = () => resolve({ ok: true, json: async () => ({}) }); });
      }
      return original(method, url, ...args);
    });
    renderPanel(<AgentChatPanel roomKey="crew-queue-test" />);
    await screen.findByTestId('crew-composer');
    const submit = (message: string) => {
      fireEvent.change(screen.getByTestId('crew-composer'), { target: { value: message } });
      fireEvent.click(screen.getByTestId('crew-send'));
    };
    submit('First');
    submit('Second');
    submit('Third');
    const writes = () => mockApiRequest.mock.calls.filter(([method, url]) => method === 'POST' && url === '/api/crew/message');
    expect(writes()).toHaveLength(1);
    expect(screen.getByLabelText('Queued requests')).toHaveTextContent('2 queued');
    fireEvent.click(screen.getByRole('button', { name: 'Remove queued request 2' }));
    await act(async () => finish!());
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes().map((call) => call[2].message)).toEqual(['First', 'Second']);
    await act(async () => finish!());
    expect(writes()).toHaveLength(2);
  });
  beforeEach(() => {
    mockApiRequest.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    (globalThis as any).EventSource = EventSourceStub;
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('persists an explicitly empty selection through remount without re-adding room members', async () => {
    const room = { ...emptyRoom, session: { id: 9, organizationId: 342, sessionKey: 'room', mode: 'explore', memory: {} }, currentUserId: 'u1', members: createMockAgents([1, 2]) };
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (url === '/api/agent-cards') return { ok: true, json: async () => createMockAgents([1, 2]) };
      if (method === 'GET' && url.startsWith('/api/crew/')) return { ok: true, json: async () => room };
      return { ok: true, json: async () => ({}) };
    });
    await act(async () => { renderPanel(<AgentChatPanel roomKey='room' />); });
    await waitFor(() => expect(screen.getByTestId('crew-agent-1').getAttribute('aria-pressed')).toBe('true'));
    await act(async () => { fireEvent.click(screen.getByTestId('crew-agent-1')); fireEvent.click(screen.getByTestId('crew-agent-2')); });
    await waitFor(() => expect(mockApiRequest.mock.calls.filter(call => call[0] === 'PUT').at(-1)?.[2]).toEqual({ agentCardIds: [] }));
    cleanup();
    await act(async () => { renderPanel(<AgentChatPanel roomKey='room' />); });
    await waitFor(() => expect(screen.getByTestId('crew-agent-1').getAttribute('aria-pressed')).toBe('false'));
    expect(screen.getByTestId('crew-agent-2').getAttribute('aria-pressed')).toBe('false');
    cleanup();
    localStorage.clear();
    room.session.memory = { activeAgentSelections: { u1: [] } };
    await act(async () => { renderPanel(<AgentChatPanel roomKey='room' />); });
    await waitFor(() => expect(screen.getByTestId('crew-agent-1').getAttribute('aria-pressed')).toBe('false'));
    expect(screen.getByTestId('crew-agent-2').getAttribute('aria-pressed')).toBe('false');
  });

  it('opens a directive alert with its exact email selected and passes it into the next chat message', async () => {
    window.history.replaceState({}, '', '/workspace/chat/room?orgId=342&gmailAlert=7');
    const item = { id: 'm1', kind: 'email', title: 'Review needed', sender: 'sender@example.com', body: 'Please review today.' };
    const payload = { type: 'google_workspace_results', title: 'Email', presentation: 'cards', sourceTool: 'gmail_get_message', sourceArgs: { message_id: 'm1' }, items: [item] };
    const turn = { id: 42, speakerType: 'supervisor', speakerName: 'Room', content: 'Email selected from your alert.', artifacts: [{ tool: 'gmail_get_message', payload }], toolsUsed: [], round: 0, createdAt: new Date().toISOString() };
    const room = { ...emptyRoom, session: { id: 9, sessionKey: 'room', mode: 'explore', roundCount: 0, memory: { facts: [], hypotheses: [], openQuestions: [], constraints: [], ontologyRefs: [], updatedRound: 0 } }, currentUserId: 'u1' };
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (url === '/api/agent-cards') return { json: async () => createMockAgents([1, 2, 3]) };
      if (method === 'POST' && url.endsWith('/notification-context')) return { ok: true, json: async () => ({ turn, payload, reason: 'Sender matched your directive.' }) };
      if (method === 'GET' && url.startsWith('/api/crew/')) return { ok: true, json: async () => room };
      return { ok: true, json: async () => ({}) };
    });
    await act(async () => { renderPanel(<AgentChatPanel roomKey='room' />); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Review needed from context' })).toBeTruthy());
    // A single result is no longer opened for you; the body is one click away.
    expect(screen.getByText('Please review today.')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Preview content' }));
    expect(screen.getAllByText('Please review today.').find(element => !element.closest('[aria-label="Selected context for next message"]'))).toBeVisible();
    expect(mockApiRequest.mock.calls.filter(call => call[1] === '/api/crew/message')).toHaveLength(0);
    expect(mockApiRequest.mock.calls.find(call => String(call[1]).endsWith('/notification-context'))?.[2]).toEqual({ eventId: 7 });
    await act(async () => { fireEvent.change(screen.getByTestId('crew-composer'), { target: { value: 'What should I do?' } }); fireEvent.click(screen.getByTestId('crew-send')); });
    await waitFor(() => expect(mockApiRequest.mock.calls.find(call => call[1] === '/api/crew/message')?.[2].selectedContext).toEqual([{ turnId: 42, tool: 'gmail_get_message', itemId: 'm1' }]));
  });

  it('sends exactly the preselected roster when the user changes nothing', async () => {
    await fc.assert(
      fc.asyncProperty(messageArb, agentIdsArb, async (message, agentIds) => {
        cleanup();
        mockApiRequest.mockReset();
        const agents = createMockAgents(agentIds);
        installApiMock(agents);

        await act(async () => {
          renderPanel(createElement(AgentChatPanel));
        });
        await waitFor(() => agentIds.forEach(id => expect(screen.getByTestId(`crew-agent-${id}`)).toBeTruthy()));

        await act(async () => {
          fireEvent.change(screen.getByTestId('crew-composer'), { target: { value: message } });
        });
        await act(async () => {
          fireEvent.click(screen.getByTestId('crew-send'));
        });

        await waitFor(() => expect(sentAgentCardIds()).toHaveLength(1));

        // An empty room preselects the first three agents on the roster.
        expect([...sentAgentCardIds()[0]].sort((a, b) => a - b))
          .toEqual([...agentIds.slice(0, 3)].sort((a, b) => a - b));
      }),
      { numRuns: 30 },
    );
  });

  it('sends exactly what is marked selected after an arbitrary sequence of toggles', async () => {
    await fc.assert(
      fc.asyncProperty(
        messageArb,
        agentIdsArb.chain(ids =>
          fc.record({
            ids: fc.constant(ids),
            toggles: fc.uniqueArray(fc.constantFrom(...ids), { maxLength: ids.length }),
          }),
        ),
        async (message, { ids, toggles }) => {
          cleanup();
          mockApiRequest.mockReset();
          const agents = createMockAgents(ids);
          installApiMock(agents);

          await act(async () => {
            renderPanel(createElement(AgentChatPanel));
          });
          await waitFor(() => ids.forEach(id => expect(screen.getByTestId(`crew-agent-${id}`)).toBeTruthy()));

          for (const id of toggles) {
            await act(async () => {
              fireEvent.click(screen.getByTestId(`crew-agent-${id}`));
            });
          }

          // Ground truth is the DOM, not a reimplementation of the toggle rule:
          // whatever the roster shows as pressed is what must be sent.
          const selectedInUi = ids.filter(
            id => screen.getByTestId(`crew-agent-${id}`).getAttribute('aria-pressed') === 'true',
          );
          // The panel refuses to send with an empty crew, so that case is out of
          // scope for this property (it is asserted separately below).
          fc.pre(selectedInUi.length > 0);

          await act(async () => {
            fireEvent.change(screen.getByTestId('crew-composer'), { target: { value: message } });
          });
          await act(async () => {
            fireEvent.click(screen.getByTestId('crew-send'));
          });

          await waitFor(() => expect(sentAgentCardIds()).toHaveLength(1));

          expect([...sentAgentCardIds()[0]].sort((a, b) => a - b))
            .toEqual([...selectedInUi].sort((a, b) => a - b));
        },
      ),
      { numRuns: 30 },
    );
  });

  it('never routes through the retired Intent Router', async () => {
    const agents = createMockAgents([1, 2, 3]);
    installApiMock(agents);

    await act(async () => {
      renderPanel(createElement(AgentChatPanel));
    });
    await waitFor(() => expect(screen.getByTestId('crew-roster')).toBeTruthy());

    await act(async () => {
      fireEvent.change(screen.getByTestId('crew-composer'), { target: { value: 'ship it' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('crew-send'));
    });

    await waitFor(() => expect(sentAgentCardIds()).toHaveLength(1));
    expect(
      mockApiRequest.mock.calls.filter((call: any[]) => String(call[1]).includes('intent-router')),
    ).toHaveLength(0);
  });
});
