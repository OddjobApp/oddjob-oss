import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/queryClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queryClient')>()),
  apiRequest: vi.fn(),
}));

vi.mock('@/modules/project-studio/ProjectStudio', () => ({
  default: () => <div data-testid="project-studio-stub" />,
}));

vi.mock('@/modules/scribe/ScribeStudioPod', () => ({
  ScribeStudioPod: () => <div data-testid="scribe-studio-stub" />,
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

const FORGE_MOUNT = [
  {
    tool: 'mount_app_studio',
    payload: {
      type: 'app_studio_pod',
      mode: 'forge',
      appId: 101,
      appName: 'Fleet Tracker',
      title: 'Fleet Tracker',
    },
  },
];

const SCRIBE_MOUNT = [
  {
    tool: 'mount_scribe_studio',
    payload: {
      type: 'scribe_foundry_pod',
      module: 'ScribeStudioPod',
      title: 'Incident Report Draft',
    },
  },
];

const AGENT_MOUNT = [
  {
    tool: 'mount_agent_studio',
    payload: {
      type: 'agent_studio_pod',
      title: 'Agent Studio',
      props: { agentId: 1 },
    },
  },
];

const MEDIA_MOUNT = [
  {
    tool: 'mount_media_studio',
    payload: {
      type: 'media_studio_pod',
      sceneId: 'SCENE-01',
      sceneTitle: 'Chase Sequence',
    },
  },
];

const PROJECT_MOUNT = [
  {
    tool: 'mount_project_studio',
    payload: {
      type: 'project_studio_pod',
      module: 'ProjectStudioPod',
      title: 'Project Studio',
      projectTitle: 'Incident Response Plan',
    },
  },
];

const stubRoom = (turns: any[], roomState: Record<string, unknown> = {}) => {
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
    // The Cycle Pipeline rail only renders for a room with a cycle or fleet apps, so
    // the fleet has to be stubbed for a test about collapsing that rail. `ok` matters:
    // fetchCycleFleet ignores a response that does not report it.
    if (url.includes('/cycle-fleet')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            cycleSlug: 'fleet-tracking',
            cycleName: 'Fleet Tracking',
            stageId: 'build',
            stageName: 'Build',
            apps: [
              {
                id: 1, appId: 101, title: 'Fleet Tracker', description: null,
                slug: 'fleet-tracker', publicSlug: 'fleet-tracker', publicPath: '/a/fleet-tracker',
                status: 'deployed', isLive: true,
              },
            ],
          }),
      });
    }
    if (url.startsWith('/api/crew/')) {
      return Promise.resolve({
        ok: true, status: 200, json: () =>
          Promise.resolve({
            turns,
            notes: [],
            plans: [],
            issues: [],
            members: [
              { id: 1, name: 'Systems Architect', personaType: 'Architect', tools: [], capabilities: [], enabled: true },
            ],
            session: { consensusLevel: 100, activeTopic: 'Fleet Tracking', mode: 'explore' },
            ...roomState,
          }),
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

describe('Chat Pane Resize Handle & Dynamic Side-Rail Expansion', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    (globalThis as any).EventSource = EventSourceStub;
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.innerWidth = 1920;
    localStorage.clear();
    vi.clearAllMocks();
    // Same reason localStorage is cleared: the panel mirrors the open studio
    // into ?studio=, and jsdom keeps one window for the whole file. Without
    // this, the Project Studio test above leaves ?studio=project behind and
    // the next test starts with Project Studio considered active, which
    // suppresses the Cycle Pipeline rail it is asserting on.
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('shows Supervisor and Blackboard tabs when no Studio is loaded', async () => {
    stubRoom([], {
      notes: [{ id: 1, noteType: 'critique', content: 'Validate the rollback path.' }],
      decisions: [{ id: 1, statement: 'Use the staged rollout.', status: 'accepted', confidence: 92 }],
    });

    renderWithClient(<AgentChatPanel roomKey="crew-rails-test" />);

    expect(await screen.findByTestId('crew-supervisor-panel')).toBeInTheDocument();
    expect(screen.getByText('Validate the rollback path.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tab-blackboard'));
    expect(await screen.findByTestId('crew-blackboard')).toBeInTheDocument();
    expect(within(screen.getByTestId('crew-blackboard')).getByText('Use the staged rollout.')).toBeInTheDocument();
    expect(screen.queryByTestId('crew-active-studio-canvas')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('blackboard-record-text'), { target: { value: 'Preserve the rollback window.' } });
    fireEvent.click(screen.getByTestId('blackboard-record-submit'));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(
      'POST',
      '/api/crew/crew-rails-test/decisions',
      { statement: 'Preserve the rollback window.' },
    ));
  });

  it('renders a draggable resize handle on the chat pane when studio mode is active', async () => {
    stubRoom([
      turn(1, "Mounting Forge Studio.", FORGE_MOUNT),
    ]);

    renderWithClient(<AgentChatPanel roomKey="crew-resize-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-pane-resize-handle')).toBeInTheDocument();
    });

    const handle = screen.getByTestId('chat-pane-resize-handle');
    expect(handle).toHaveAttribute('role', 'separator');
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-valuenow');
  });

  it('keeps the manuscript rail when Scribe Studio is the latest active studio', async () => {
    stubRoom([
      turn(1, "Opening Scribe Studio.", SCRIBE_MOUNT),
    ]);

    renderWithClient(<AgentChatPanel roomKey="crew-scribe-test" />);

    expect(await screen.findByTestId('scribe-studio-rail')).toBeInTheDocument();
    expect(screen.getByTestId('scribe-studio-stub')).toBeInTheDocument();
    expect(screen.getByTestId('scribe-manuscripts-right-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('cycle-pipeline-right-rail')).not.toBeInTheDocument();
  });

  it('suppresses stale supporting rails while Project Studio is active', async () => {
    stubRoom([
      turn(1, "Opening Scribe Studio.", SCRIBE_MOUNT),
      turn(2, "Opening Agent Studio.", AGENT_MOUNT),
      turn(3, "Opening Media Studio.", MEDIA_MOUNT),
      turn(4, "Opening Project Studio.", PROJECT_MOUNT),
    ]);

    renderWithClient(<AgentChatPanel roomKey="crew-project-test" />);

    // Wait for the cycle fleet response so all stale supporting rails are eligible.
    expect(await screen.findByTestId('toggle-app-canvas-btn')).toBeInTheDocument();
    expect(await screen.findByTestId('project-studio-rail')).toBeInTheDocument();
    expect(screen.getByTestId('project-studio-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('scribe-manuscripts-right-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('media-configuration-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('media-configuration-rail-collapsed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cycle-pipeline-right-rail')).not.toBeInTheDocument();
  });

  it('dynamically expands the chat pane when the Cycle Pipeline side rail is collapsed', async () => {
    stubRoom([
      turn(1, "Mounting Forge Studio.", FORGE_MOUNT),
    ]);

    renderWithClient(<AgentChatPanel roomKey="crew-resize-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-pane-resize-handle')).toBeInTheDocument();
      expect(screen.getByTestId('cycle-pipeline-right-rail')).toBeInTheDocument();
    });

    const handle = screen.getByTestId('chat-pane-resize-handle');
    const initialWidth = Number(handle.getAttribute('aria-valuenow'));

    // Collapse the side rail
    const collapseBtn = screen.getByTestId('collapse-cycle-pipeline-rail-btn');
    fireEvent.click(collapseBtn);

    // The chat pane dynamically expands to absorb the 272px freed space
    await waitFor(() => {
      const expandedWidth = Number(handle.getAttribute('aria-valuenow'));
      expect(expandedWidth).toBe(initialWidth + 272);
    });

    // Expand the side rail again
    const expandBtn = screen.getByTestId('expand-cycle-pipeline-rail-btn');
    fireEvent.click(expandBtn);

    // The chat pane dynamically contracts back
    await waitFor(() => {
      const contractedWidth = Number(handle.getAttribute('aria-valuenow'));
      expect(contractedWidth).toBe(initialWidth);
    });
  });

  it('supports keyboard navigation with ArrowRight and ArrowLeft to extend and contract the chat pane', async () => {
    stubRoom([
      turn(1, "Mounting Forge Studio.", FORGE_MOUNT),
    ]);

    renderWithClient(<AgentChatPanel roomKey="crew-resize-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-pane-resize-handle')).toBeInTheDocument();
    });

    const handle = screen.getByTestId('chat-pane-resize-handle');
    const initialWidth = Number(handle.getAttribute('aria-valuenow'));

    // ArrowRight extends the chat pane
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    const widerWidth = Number(handle.getAttribute('aria-valuenow'));
    expect(widerWidth).toBeGreaterThan(initialWidth);

    // ArrowLeft contracts the chat pane
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    const narrowerWidth = Number(handle.getAttribute('aria-valuenow'));
    expect(narrowerWidth).toBe(initialWidth);
  });

  it('resets chat pane width to default on double-click', async () => {
    stubRoom([
      turn(1, "Mounting Forge Studio.", FORGE_MOUNT),
    ]);

    renderWithClient(<AgentChatPanel roomKey="crew-resize-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-pane-resize-handle')).toBeInTheDocument();
    });

    const handle = screen.getByTestId('chat-pane-resize-handle');

    // Extend chat pane with ArrowRight
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(Number(handle.getAttribute('aria-valuenow'))).toBeGreaterThan(460);

    // Double click resets to 460px
    fireEvent.doubleClick(handle);
    expect(Number(handle.getAttribute('aria-valuenow'))).toBe(460);
  });

  it('resizes chat pane when dragging the handle with mouse', async () => {
    stubRoom([
      turn(1, "Mounting Forge Studio.", FORGE_MOUNT),
    ]);

    renderWithClient(<AgentChatPanel roomKey="crew-resize-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('chat-pane-resize-handle')).toBeInTheDocument();
    });

    const handle = screen.getByTestId('chat-pane-resize-handle');
    const initialWidth = Number(handle.getAttribute('aria-valuenow'));

    // Start drag at x=500
    fireEvent.mouseDown(handle, { clientX: 500 });

    // Move mouse right by 100px to x=600
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 600 }));
    });

    const newWidth = Number(handle.getAttribute('aria-valuenow'));
    expect(newWidth).toBe(initialWidth + 100);

    // Release drag
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });
  });

  it('elevates the Close Room button to z-floating layer (zIndex 60) so it is not obscured by rails', async () => {
    stubRoom([
      turn(1, "Mounting Forge Studio.", FORGE_MOUNT),
    ]);

    renderWithClient(<AgentChatPanel roomKey="crew-resize-test" />);

    await waitFor(() => {
      expect(screen.getByTestId('bottom-right-room-actions')).toBeInTheDocument();
      expect(screen.getByTestId('conclude-meeting-btn')).toBeInTheDocument();
    });

    const roomActions = screen.getByTestId('bottom-right-room-actions');
    expect(roomActions).toHaveClass('z-floating');
    expect(roomActions.style.zIndex).toBe('60');
    expect(roomActions.style.position).toBe('fixed');
    expect(roomActions.style.bottom).toBe('16px');
    expect(roomActions.style.right).toBe('16px');
  });
});
