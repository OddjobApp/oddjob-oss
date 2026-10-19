/**
 * The Copilot in the Crew Room: it is always in the room, and when it launches
 * an app the room can actually open it.
 *
 * Two failures these cover, both of which shipped:
 *   - a crew agent asked to open the SDLC Workbench answered in prose, because
 *     no card declared an app tool and the panel could not have rendered the
 *     result anyway — an `assistant_app` payload carries no `module`, so the
 *     artifact loop fell through to the instant-app branch and returned null;
 *   - href derivation mangled routes it did not recognise into dead
 *     `/app/<segment>` paths, which is why that logic now lives in one shared
 *     module rather than being reimplemented per surface.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { normalizeAssistantAppHref } from '@/lib/assistant-app-href';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockApiRequest = vi.fn();

// importOriginal + spread: a factory that lists exports by hand goes stale the
// moment the module gains one, and vitest fails with "No <name> export is defined
// on the mock" — which is what adding resolveActiveOrgId did here.
vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queryClient')>()),
  apiRequest: (...args: any[]) => mockApiRequest(...args),
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

import {
  AgentChatPanel,
  DEFAULT_TOPIC_ARCHETYPES,
  reconcileTopicArchetypes,
} from './AgentChatPanel';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const copilotCard = {
  id: 7,
  name: 'Copilot',
  description: 'Platform copilot.',
  personaType: 'copilot',
  capabilities: ['app launch'],
  soulArchetype: 'Lead Directive',
  legend: null,
  enabled: true,
};

const specialistCard = {
  id: 12,
  name: 'Coder',
  description: 'Coding specialist.',
  personaType: 'coder',
  capabilities: ['code review'],
  soulArchetype: null,
  legend: null,
  enabled: true,
};

function roomWith(overrides: Record<string, unknown> = {}) {
  return {
    session: null,
    members: [],
    turns: [],
    notes: [],
    plans: [],
    issues: [],
    raisedHands: [],
    participants: [],
    currentUserId: null,
    ...overrides,
  };
}

function installApiMock(agents: unknown[], room: unknown, topicArchetypes: unknown[] = []) {
  mockApiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === 'GET' && url === '/api/agent-cards') return { ok: true, status: 200, json: async () => agents };
    if (method === 'GET' && url.startsWith('/api/crew/primers')) {
      return { ok: true, status: 200, json: async () => ({ primers: [], topicArchetypes }) };
    }
    if (method === 'GET' && url.startsWith('/api/crew/')) return { ok: true, status: 200, json: async () => room };
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('assistant app href resolution', () => {
  it('sends a blueprint to the scaffolding page rather than a dead /app/ path', () => {
    expect(normalizeAssistantAppHref({ title: 'CRUD App', source: 'blueprint', slug: 'crud-app' }))
      .toBe('/armory/new?blueprint=crud-app');
  });

  it('appends a cycle app route to the app base href', () => {
    expect(
      normalizeAssistantAppHref({
        title: 'Ops',
        source: 'app',
        slug: 'ops-workbench',
        routePath: 'queue',
      }),
    ).toBe('/app/ops-workbench/queue');
  });

  it('passes a recognised platform route through untouched', () => {
    expect(
      normalizeAssistantAppHref({
        title: 'Sessions',
        href: '/pipeline/sessions?embed=cycle&orgId=291',
      }),
    ).toBe('/pipeline/sessions?embed=cycle&orgId=291');

    expect(
      normalizeAssistantAppHref({
        title: 'Component Dependency Flow & X-Ray Canvas',
        href: '/platform-maintenance/documentation?tab=xray&appId=chaos-drill',
      }),
    ).toBe('/platform-maintenance/documentation?tab=xray&appId=chaos-drill');
  });

  // Route prefixes match whole segments: "/a" is a route, "/acme-tracker" is a
  // slug. A raw startsWith("/a") passed it through as a dead link.
  it('treats a slug that merely starts like a route prefix as a slug', () => {
    expect(normalizeAssistantAppHref({ title: 'Acme', href: '/acme-tracker' }))
      .toBe('/app/acme-tracker');
    expect(normalizeAssistantAppHref({ title: 'Ops', href: '/ops-board?x=1' }))
      .toBe('/app/ops-board?x=1');
    expect(normalizeAssistantAppHref({ title: 'Assistant', href: '/assistant/chat' }))
      .toBe('/assistant/chat');
  });

  it('normalises the underscored SDLC workbench route the catalog still emits', () => {
    expect(normalizeAssistantAppHref({ title: 'SDLC', href: '/app/sdlc_workbench' }))
      .toBe('/app/sdlc-workbench');
  });

  it('returns null when there is nothing to open', () => {
    expect(normalizeAssistantAppHref({ title: 'Nothing' })).toBeNull();
  });
});

describe('Crew Room — the Copilot', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    sessionStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    (globalThis as any).EventSource = EventSourceStub;
  });

  afterEach(() => cleanup());

  it('is selected by default in a room whose saved roster predates it', async () => {
    installApiMock([specialistCard, copilotCard], roomWith({ members: [specialistCard] }));

    await act(async () => {
      render(createElement(AgentChatPanel));
    });
    await waitFor(() => expect(screen.getByTestId('crew-roster')).toBeTruthy());

    expect(screen.getByTestId(`crew-agent-${copilotCard.id}`).getAttribute('aria-pressed'))
      .toBe('true');
    // The saved roster is kept, not replaced.
    expect(screen.getByTestId(`crew-agent-${specialistCard.id}`).getAttribute('aria-pressed'))
      .toBe('true');
  });

  it('renders an openable card when an agent launches an app', async () => {
    const room = roomWith({
      turns: [
        {
          id: 1,
          speakerType: 'agent',
          speakerName: 'Copilot',
          userId: null,
          content: 'Opening the SDLC Workbench.',
          round: 1,
          agentCardId: copilotCard.id,
          inReplyToTurnId: null,
          topic: null,
          intent: null,
          latencyMs: 120,
          toolsUsed: [],
          artifacts: [
            {
              tool: 'render_app_surface',
              payload: {
                type: 'assistant_app',
                title: 'SDLC Workbench',
                description: 'Software development lifecycle workbench.',
                source: 'app',
                slug: 'sdlc-workbench',
                mode: 'embed',
                actionLabel: 'Open workbench',
              },
            },
          ],
        },
      ],
    });

    installApiMock([copilotCard], room);

    await act(async () => {
      render(createElement(AgentChatPanel));
    });

    await waitFor(() => expect(screen.getByTestId('tokenized-app-surface')).toBeTruthy());

    // /app/sdlc-workbench is a same-origin app route so it embeds as a native
    // tokenized surface card rather than a heavy iframe. Verify the surface rendered
    // with the correct title.
    expect(screen.getByText('SDLC Workbench')).toBeTruthy();
  });

  it('opens and launches a DIVERSE goal playbook', async () => {
    const topic = {
      id: 'build',
      label: 'Build a capability',
      icon: 'B',
      description: 'Turn a defined outcome into a governed implementation.',
      podComponent: 'ScaffoldPackPod',
      defaultDirection: 'Build and validate the requested capability.',
      suggestedRoles: ['Coder', 'Reviewer'],
      suggestedDeliverables: ['Working implementation'],
    };
    const room = roomWith({ members: [copilotCard] });
    installApiMock([copilotCard], room, [topic]);

    await act(async () => {
      render(createElement(AgentChatPanel));
    });

    await waitFor(() => expect(screen.getByTestId('crew-topic-build')).toBeTruthy());
    fireEvent.click(screen.getByTestId('crew-topic-build'));
    expect(screen.getByTestId('gqe-diverse-intake-card')).toBeTruthy();
    expect(screen.getByTestId('instant-app')).toBeTruthy();
    expect(screen.getByText('Adaptive Module Surface · Build a capability')).toBeTruthy();

    // `instant-app` is the renderer's chrome: it is present even when the pod
    // does not resolve, which is how the shipped grid passed this test while
    // mounting nothing. The card is only alive if the notice is absent.
    expect(screen.queryByText(/isn't available to render/)).toBeNull();
  });

  /**
   * The Goal Playbook grid went dark because the server's archetype payload
   * carried no `podComponent` and the room adopts that payload wholesale. Every
   * card then mounted `Component "undefined" isn't available to render.`
   */
  it('will not offer a playbook card it cannot mount a pod for', async () => {
    const podless = {
      id: 'nowhere',
      label: 'Goes nowhere',
      icon: '?',
      description: 'A playbook the server sent without a pod.',
      defaultDirection: 'Nothing mountable.',
      suggestedRoles: [],
      suggestedDeliverables: ['Nothing'],
    };
    installApiMock([copilotCard], roomWith({ members: [copilotCard] }), [podless]);

    await act(async () => {
      render(createElement(AgentChatPanel));
    });

    await waitFor(() => expect(screen.getByTestId('crew-topic-archetypes')).toBeTruthy());
    expect(screen.queryByTestId('crew-topic-nowhere')).toBeNull();
    // Falls back to the room's own playbooks rather than an empty grid.
    expect(screen.getByTestId('crew-topic-build_app')).toBeTruthy();
  });

  it('backfills a pod for a known playbook the server sent without one', async () => {
    const stripped = {
      id: 'research_topic',
      label: 'Research a Topic',
      icon: '🔬',
      description: 'Multi-hop research.',
      defaultDirection: 'Deep multi-source research mission',
      suggestedRoles: ['Researcher'],
      suggestedDeliverables: ['Executive Research Brief'],
    };
    installApiMock([copilotCard], roomWith({ members: [copilotCard] }), [stripped]);

    await act(async () => {
      render(createElement(AgentChatPanel));
    });

    await waitFor(() => expect(screen.getByTestId('crew-topic-research_topic')).toBeTruthy());
    fireEvent.click(screen.getByTestId('crew-topic-research_topic'));
    expect(screen.queryByText(/isn't available to render/)).toBeNull();
  });

  it('does not display goal playbooks when in app forge studio view', async () => {
    window.history.pushState({}, '', '/workspace/chat/crew-test?studio=forge');
    const room = roomWith({ members: [copilotCard] });
    installApiMock([copilotCard], room);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      render(createElement(QueryClientProvider, { client: qc }, createElement(AgentChatPanel)));
    });

    await waitFor(() => expect(screen.getByTestId('app-forge-chat-placeholder')).toBeTruthy());
    expect(screen.queryByTestId('crew-topic-archetypes')).toBeNull();
  });

  it('auto-selects domain knowledge and engineering squad when mounting app forge studio', async () => {
    window.history.pushState({}, '', '/workspace/chat/crew-test?studio=forge');
    const cards = [
      copilotCard,
      { id: 2, name: 'Knowledge Architect', personaType: 'knowledge-architect', capabilities: [] },
      { id: 3, name: 'Backend Architect', personaType: 'backend-architect', capabilities: [] },
      { id: 4, name: 'Coder', personaType: 'coder', capabilities: [] },
      { id: 5, name: 'Security Auditor', personaType: 'security', capabilities: [] },
      { id: 6, name: 'Growth Marketer', personaType: 'marketing', capabilities: [] },
    ];
    const room = roomWith({ members: cards });
    installApiMock(cards, room);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () => {
      render(createElement(QueryClientProvider, { client: qc }, createElement(AgentChatPanel)));
    });

    await waitFor(() => expect(screen.getByTestId('app-forge-chat-placeholder')).toBeTruthy());
  });
});

describe('Goal Playbooks — reconciling the primers payload', () => {
  const local = [
    { ...DEFAULT_TOPIC_ARCHETYPES[0] },
    { ...DEFAULT_TOPIC_ARCHETYPES[1] },
  ];

  it('keeps the local playbooks when the payload is not a list', () => {
    expect(reconcileTopicArchetypes(undefined, local)).toBeNull();
    expect(reconcileTopicArchetypes({ topicArchetypes: [] }, local)).toBeNull();
  });

  it('keeps the local playbooks rather than emptying the grid', () => {
    expect(reconcileTopicArchetypes([], local)).toBeNull();
    expect(reconcileTopicArchetypes([{ id: 'unknown', label: 'x' }], local)).toBeNull();
  });

  it('backfills a missing podComponent from the local playbook of the same id', () => {
    const served = [{ ...local[0], podComponent: undefined, label: 'Renamed upstream' }];
    const out = reconcileTopicArchetypes(served as any, local)!;

    expect(out).toHaveLength(1);
    expect(out[0].podComponent).toBe(local[0].podComponent);
    // Everything else still comes from the server, which owns the copy.
    expect(out[0].label).toBe('Renamed upstream');
  });

  it('prefers the served podComponent over the local one', () => {
    const served = [{ ...local[0], podComponent: 'MissionBriefPod' }];
    expect(reconcileTopicArchetypes(served, local)![0].podComponent).toBe('MissionBriefPod');
  });
});
