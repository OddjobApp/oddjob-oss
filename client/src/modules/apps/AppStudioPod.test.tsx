import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiRequest = vi.fn();
vi.mock('@/lib/queryClient', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

/*
 * The real Builder tab drags in the visual editor, the file tree and a dozen
 * queries. What these tests are about is whether the mount chain reaches it at
 * all — so it is stubbed to something identifiable, and the assertions look for
 * that stub rather than for the studio's own chrome. A pod that renders its
 * header while the body silently fails is exactly the failure this distinction
 * catches.
 */
vi.mock('@domain-ui/apps/ui/modules/apps/components/tabs/AppInteractiveBuilderTab', () => ({
  AppInteractiveBuilderTab: ({ appId, initialView, onFocusInChat }: { appId: number; initialView?: string; onFocusInChat?: (selection: any) => void }) => (
    <div data-testid="builder-tab-stub" data-initial-view={initialView}>
      builder for app {appId}
      {onFocusInChat && <button onClick={() => onFocusInChat({ appId, kind: 'file', label: 'app/page.tsx', filePath: 'app/page.tsx' })}>Discuss selected file</button>}
    </div>
  ),
}));

import AppStudioPod from './AppStudioPod';
import { ModularAssemblyPuzzleRail } from '@/components/agent-chat/ModularAssemblyPuzzleRail';

let queryClient: QueryClient;

/** A minimal EventSource stand-in whose frames the test drives by hand. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  close() {
    this.closed = true;
  }
  emit(payload: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const INSTALLED = [
  {
    deployment: { id: 9, publicSlug: 'fleet-console', status: 'running' },
    app: { id: 42, name: 'Fleet Console', slug: 'fleet-console', status: 'running' },
  },
];

function renderPod(props: Record<string, unknown>) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AppStudioPod mode="builder" {...(props as any)} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockResolvedValue({ ok: true, json: async () => INSTALLED });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  (globalThis as any).EventSource = FakeEventSource as unknown as typeof EventSource;
  FakeEventSource.last = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AppStudioPod — builder mode', () => {
  it('clears selected app context when the room switches to another app', async () => {
    const selection = vi.fn();
    const view = (appId: number) => <QueryClientProvider client={queryClient}><ModularAssemblyPuzzleRail
      turns={[{ id: appId, artifacts: [{ tool: 'mount_app_studio', payload: { appId, mode: 'builder' } }] }]}
      selectedId="app-studio:42:file:app/page.tsx" onSelectionChange={selection}
    /></QueryClientProvider>;
    const { rerender } = render(view(42));
    await screen.findByTestId('builder-tab-stub');
    rerender(view(99));
    await waitFor(() => expect(selection).toHaveBeenCalledWith(null));
  });
  it('passes the selected file with app and observed-change context', async () => {
    const focus = vi.fn();
    renderPod({ appId: 42, onFocusInChat: focus, lastChange: { status: 'applied', summary: 'Done', appliedAt: 'revision-observation' } });
    fireEvent.click(await screen.findByText('Discuss selected file'));
    expect(focus).toHaveBeenCalledWith({ appId: 42, appName: 'Fleet Console', kind: 'file', label: 'app/page.tsx', filePath: 'app/page.tsx', changeId: 'revision-observation' });
  });

  it('shows history outcomes and navigates to the originating turn without applying an undo', async () => {
    const showTurn = vi.fn();
    renderPod({ appId: 42, onShowTurn: showTurn, changes: [
      { id: '42:a', appId: 42, turnId: 17, status: 'build_failed', summary: 'Build failed', instruction: 'Add a table', filesWritten: 2, canRevert: true },
      { id: '99:b', appId: 99, turnId: 18, status: 'applied', summary: 'Other app secret' },
    ] });
    const history = await screen.findByTestId('app-studio-history');
    fireEvent.click(history.querySelector('summary')!);
    expect(history).toHaveTextContent('build failed');
    expect(history).not.toHaveTextContent('Other app secret');
    fireEvent.click(screen.getByText('Show conversation'));
    expect(showTurn).toHaveBeenCalledWith(17);
    expect(history.querySelector('button[data-action="undo"]')).toBeNull();
    expect(history.querySelector('summary')).toHaveTextContent('Change history (1)');
  });

  it('connects the studio selection to the CREW context and reveals collapsed chat', async () => {
    const selection = vi.fn();
    const expand = vi.fn();
    render(<QueryClientProvider client={queryClient}><ModularAssemblyPuzzleRail
      turns={[{ id: 1, artifacts: [{ tool: 'mount_app_studio', payload: { appId: 42, mode: 'builder' } }] }]}
      onSelectionChange={selection} isChatCollapsed onToggleChatCollapse={expand}
    /></QueryClientProvider>);
    fireEvent.click(await screen.findByText('Discuss selected file'));
    expect(selection).toHaveBeenCalledWith(expect.objectContaining({ type: 'app', appStudio: expect.objectContaining({ appId: 42, filePath: 'app/page.tsx' }) }));
    expect(expand).toHaveBeenCalledOnce();
  });
  it('mounts the interactive builder for the resolved app', async () => {
    renderPod({ mode: 'builder', appId: 42, appName: 'Fleet Console' });

    expect(await screen.findByTestId('builder-tab-stub')).toHaveTextContent('builder for app 42');
    expect(screen.getByTestId('app-studio-pod')).toHaveAttribute('data-mode', 'builder');
  });

  it('offers Open App against the deployment public slug', async () => {
    renderPod({ mode: 'builder', appId: 42 });

    // asChild merges the button's props onto the anchor, so the testid lands
    // on the <a> itself rather than on a wrapper.
    const link = await screen.findByTestId('app-studio-open');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/app/fleet-console');
  });

  /*
   * The routed view has to reach the builder, or "fix this app" lands on the
   * preview and the diagnostic routing is decorative.
   */
  it('lands the builder on the view the request routed to', async () => {
    renderPod({ mode: 'builder', appId: 42, view: 'diagnostics' });

    expect(await screen.findByTestId('builder-tab-stub')).toHaveAttribute('data-initial-view', 'diagnostics');
  });

  it('names the app it could not open rather than going blank', async () => {
    renderPod({ mode: 'builder', appId: 777, appSlug: 'ghost-app' });

    expect(await screen.findByText(/App #777 \(ghost-app\) is not installed/)).toBeInTheDocument();
    expect(screen.queryByTestId('builder-tab-stub')).not.toBeInTheDocument();
  });
});

describe('AppStudioPod — a change applied from the conversation', () => {
  const CHANGE = {
    status: 'applied' as const,
    summary: 'Applied to 3 file(s). The app is restarting.',
    filesWritten: 3,
    canRevert: true,
    appliedAt: '2026-09-03T10:00:00.000Z',
  };

  it('shows the outcome and the undo offer', async () => {
    renderPod({ mode: 'builder', appId: 42, lastChange: CHANGE });

    const banner = await screen.findByTestId('app-studio-change');
    expect(banner).toHaveAttribute('data-status', 'applied');
    expect(banner).toHaveTextContent('Applied to 3 file(s)');
    expect(banner).toHaveTextContent('undo that');
  });

  it('does not offer an undo the room cannot honour', async () => {
    renderPod({
      mode: 'builder',
      appId: 42,
      lastChange: { ...CHANGE, status: 'no_changes' as const, canRevert: false, summary: 'Nothing was changed.' },
    });

    const banner = await screen.findByTestId('app-studio-change');
    expect(banner).toHaveAttribute('data-status', 'no_changes');
    expect(banner).not.toHaveTextContent('undo that');
  });

  /*
   * The builder is keyed on the dispatch. Without that, the file tree and
   * preview keep serving the state from before the edit that just landed.
   */
  it('reloads the workspace when a new change arrives', async () => {
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AppStudioPod mode="builder" appId={42} lastChange={CHANGE} />
      </QueryClientProvider>,
    );
    const first = await screen.findByTestId('builder-tab-stub');

    rerender(
      <QueryClientProvider client={queryClient}>
        <AppStudioPod mode="builder" appId={42} lastChange={{ ...CHANGE, appliedAt: '2026-09-03T10:05:00.000Z' }} />
      </QueryClientProvider>,
    );

    // A remount, not a re-render of the same instance.
    expect(await screen.findByTestId('builder-tab-stub')).not.toBe(first);
  });

  it('keeps the same builder instance when nothing new happened', async () => {
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AppStudioPod mode="builder" appId={42} lastChange={CHANGE} />
      </QueryClientProvider>,
    );
    const first = await screen.findByTestId('builder-tab-stub');

    rerender(
      <QueryClientProvider client={queryClient}>
        <AppStudioPod mode="builder" appId={42} lastChange={{ ...CHANGE }} />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('builder-tab-stub')).toBe(first);
  });

  const APPLYING = {
    status: 'applying' as const,
    summary: 'Applying your change…',
    canRevert: false,
  };

  it('says the change is running before it has finished', async () => {
    renderPod({ mode: 'builder', appId: 42, lastChange: APPLYING });

    const banner = await screen.findByTestId('app-studio-change');
    expect(banner).toHaveAttribute('data-status', 'applying');
    expect(banner).toHaveTextContent('Applying your change');
    expect(banner).not.toHaveTextContent('undo that');
  });

  /*
   * The workspace is mid-rewrite while a change runs. Reloading the builder
   * then shows a torn state and throws away whatever view the author was on,
   * so the remount waits for the outcome.
   */
  it('does not reload the workspace while the change is still running', async () => {
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AppStudioPod mode="builder" appId={42} lastChange={APPLYING} />
      </QueryClientProvider>,
    );
    const first = await screen.findByTestId('builder-tab-stub');

    rerender(
      <QueryClientProvider client={queryClient}>
        <AppStudioPod
          mode="builder"
          appId={42}
          lastChange={{ ...APPLYING, summary: 'Applying your change… still' }}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('builder-tab-stub')).toBe(first);
  });

  it('reloads once the outcome replaces the applying state', async () => {
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AppStudioPod mode="builder" appId={42} lastChange={APPLYING} />
      </QueryClientProvider>,
    );
    const first = await screen.findByTestId('builder-tab-stub');

    rerender(
      <QueryClientProvider client={queryClient}>
        <AppStudioPod mode="builder" appId={42} lastChange={CHANGE} />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('builder-tab-stub')).not.toBe(first);
  });

  it('shows no banner when the studio simply mounted', async () => {
    renderPod({ mode: 'builder', appId: 42 });
    await screen.findByTestId('builder-tab-stub');
    expect(screen.queryByTestId('app-studio-change')).not.toBeInTheDocument();
  });
});

describe('AppStudioPod — forge mode', () => {
  it('renders a compact progress row over the seven stages the server emits', async () => {
    renderPod({ mode: 'forge', jobId: 'job-1', title: 'Ops Console' });

    FakeEventSource.last!.emit({ stage: 3, message: 'UI Assembly: mounting composition', level: 'info' });

    expect(await screen.findByTestId('forge-progress-heading')).toHaveTextContent('Step 4 of 7 — Assembly');
    expect(screen.getByTestId('forge-latest-event')).toHaveTextContent('UI Assembly: mounting composition');
  });

  /*
   * The reducer is unit-tested on its own; this proves the pod is actually
   * wired through it. A reconnect redelivers earlier frames, and the progress
   * row must not walk backwards in front of the author.
   */
  it('does not regress the step when an earlier frame is redelivered', async () => {
    renderPod({ mode: 'forge', jobId: 'job-1' });

    FakeEventSource.last!.emit({ stage: 5, message: 'Industrialization: promoting' });
    expect(await screen.findByTestId('forge-progress-heading')).toHaveTextContent('Step 6 of 7');

    FakeEventSource.last!.emit({ stage: 1, message: 'Strategy: wave plan' });
    expect(screen.getByTestId('forge-progress-heading')).toHaveTextContent('Step 6 of 7');
  });

  it('announces status changes politely rather than silently repainting', async () => {
    renderPod({ mode: 'forge', jobId: 'job-1' });
    FakeEventSource.last!.emit({ stage: 2, message: 'Architecture: proposal generated' });

    expect(await screen.findByTestId('forge-progress')).toHaveAttribute('aria-live', 'polite');
  });

  it('shows an approval gate as its own state, not as another log line', async () => {
    renderPod({ mode: 'forge', jobId: 'job-1' });

    FakeEventSource.last!.emit({
      status: 'awaiting_architecture_approval',
      message: 'Review the technical architecture',
    });

    expect(await screen.findByTestId('forge-approval-required')).toHaveTextContent('Review the technical architecture');
  });

  it('counts the artifacts the run has produced', async () => {
    renderPod({ mode: 'forge', jobId: 'job-1' });

    FakeEventSource.last!.emit({
      stage: 3,
      message: 'UI Assembly',
      liveAssembly: {
        blocks: [{ module: 'MetricGrid', componentName: 'MetricGrid', category: 'data', status: 'mounted' }],
        files: ['app/page.tsx', 'app/api/route.ts'],
        api: { openapi: '3.1.0' },
      },
    });

    const counts = await screen.findByTestId('forge-artifact-counts');
    expect(counts).toHaveTextContent('1 gallery component');
    expect(counts).toHaveTextContent('2 files');
    expect(counts).toHaveTextContent('API contract');
  });

  it('renders interactive launchpad instead of showing a fake build when no job is attached', () => {
    renderPod({ mode: 'forge', jobId: null, requirements: 'track warehouse inventory' });

    expect(screen.getByText(/Forge Studio Launchpad/)).toBeInTheDocument();
    expect(screen.getByTestId('forge-continue-to-specs')).toBeInTheDocument();
    expect(screen.getByText(/track warehouse inventory/)).toBeInTheDocument();
    expect(screen.queryByTestId('forge-progress')).not.toBeInTheDocument();
  });

  /*
   * The transition the whole pod exists for: a finished forge run becomes the
   * Builder over the same mount, with no navigation.
   */
  it('promotes itself into Builder in place when the run completes', async () => {
    renderPod({ mode: 'forge', jobId: 'job-1', title: 'Ops Console' });

    FakeEventSource.last!.emit({ stage: 6, message: 'Ignition: launching', level: 'info' });
    FakeEventSource.last!.emit({ appId: 42, status: 'completed', message: 'App is live', level: 'success' });

    expect(await screen.findByTestId('builder-tab-stub')).toHaveTextContent('builder for app 42');
    await waitFor(() =>
      expect(screen.getByTestId('app-studio-pod')).toHaveAttribute('data-mode', 'builder'),
    );
  });

  it('does not promote on an app id alone, while the container is still building', async () => {
    renderPod({ mode: 'forge', jobId: 'job-1' });

    FakeEventSource.last!.emit({ appId: 42, stage: 4, message: 'Hardening', level: 'info' });

    await waitFor(() =>
      expect(screen.getByTestId('app-studio-pod')).toHaveAttribute('data-mode', 'forge'),
    );
    expect(screen.queryByTestId('builder-tab-stub')).not.toBeInTheDocument();
  });

  it('surfaces a failed build rather than leaving the bar mid-flight', async () => {
    renderPod({ mode: 'forge', jobId: 'job-1' });

    FakeEventSource.last!.emit({ level: 'error', message: 'Assembly failed: missing block' });

    expect(await screen.findByText(/Assembly failed: missing block/)).toBeInTheDocument();
    expect(screen.getByTestId('forge-progress-heading')).toHaveTextContent('Build failed');
  });

  it('renders architecture archetype options in the Launchpad and submits selected blueprint', async () => {
    apiRequest.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jobId: 'job-new-123' }),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AppStudioPod mode="forge" jobId={null} title="Customer Bot" requirements="Handle customer queries" />
      </QueryClientProvider>
    );

    expect(await screen.findByTestId('forge-archetype-selection')).toBeInTheDocument();
    expect(screen.getByTestId('archetype-analytics-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('archetype-industrial-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('archetype-chat-assistant')).toBeInTheDocument();

    // Select Chat Assistant
    fireEvent.click(screen.getByTestId('archetype-chat-assistant'));

    // Progress through Architecture & Steps -> Specs & Requirements -> Pre-Flight & Ignition
    fireEvent.click(screen.getByTestId('forge-continue-to-specs'));
    fireEvent.click(screen.getByText(/Continue to Pre-Flight/));

    // Click Start Build (Ignite)
    fireEvent.click(screen.getByTestId('forge-start-build'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        'POST',
        '/api/apps/forge',
        expect.objectContaining({
          name: 'Customer Bot',
          blueprint: 'chat-assistant',
        })
      );
    });
  });

  it('walks through Architecture -> Specs & Requirements -> Pre-Flight Review & Ignition', async () => {
    apiRequest.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jobId: 'job-walkthrough-999' }),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AppStudioPod mode="forge" jobId={null} title="Fleet Manager" requirements="Manage vehicles" />
      </QueryClientProvider>
    );

    // Step 1: Target Architecture
    expect(screen.getByText(/Forge Studio Launchpad/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('archetype-operations-console'));
    fireEvent.click(screen.getByTestId('forge-continue-to-specs'));

    // Step 2: Specs & Requirements Walkthrough
    expect(await screen.findByText(/Phase II: Logic & Specifications Walkthrough/)).toBeInTheDocument();
    expect(screen.getByTestId('forge-input-app-name')).toHaveValue('Fleet Manager');
    expect(screen.getByTestId('forge-textarea-requirements')).toHaveValue('Manage vehicles');

    // Click Continue to Pre-Flight & Ignition
    fireEvent.click(screen.getByText(/Continue to Pre-Flight/));

    // Step 3: Review & Pre-Flight Check
    expect(await screen.findByText(/Phase III: Pre-Flight Review & Assembly Ignition/)).toBeInTheDocument();
    expect(screen.getByText(/Operations Console/)).toBeInTheDocument();

    // Ignite Forge Build
    fireEvent.click(screen.getByTestId('forge-start-build'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        'POST',
        '/api/apps/forge',
        expect.objectContaining({
          name: 'Fleet Manager',
          blueprint: 'operations-console',
        })
      );
    });
  });

  it('appends requirements and switches to specs tab when forge:add-requirement is dispatched', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AppStudioPod mode="forge" jobId={null} title="Fleet Tracker" requirements="Base requirements" />
      </QueryClientProvider>
    );

    // Initial state is on architecture tab
    expect(screen.getByText(/Forge Studio Launchpad/)).toBeInTheDocument();

    // Dispatch event from agent chat
    window.dispatchEvent(
      new CustomEvent('forge:add-requirement', {
        detail: {
          text: 'Feature: Live Telemetry Tracking\n- Endpoint: GET /api/telemetry',
          agentName: 'Systems Architect',
        },
      })
    );

    // It automatically shifts to the specs tab and updates the requirements textarea
    expect(await screen.findByText(/Phase II: Logic & Specifications Walkthrough/)).toBeInTheDocument();
    const textarea = screen.getByTestId('forge-textarea-requirements') as HTMLTextAreaElement;
    expect(textarea.value).toContain('Base requirements');
    expect(textarea.value).toContain('### [Specification from @Systems Architect]');
    expect(textarea.value).toContain('Feature: Live Telemetry Tracking');
  });
});

describe('app_studio_pod reaches a client branch', () => {
  /*
   * Adding a type to RICH_PAYLOAD_TYPES without a client branch makes the
   * artifact vanish silently, which is worse than the raw-JSON leak it was
   * meant to fix. This pins the other half: the payload the tool emits renders
   * the pod, and the pod renders its body.
   */
  it('renders the studio from a mount_app_studio artifact', async () => {
    const turns: any[] = [
      {
        id: 1,
        artifacts: [
          {
            tool: 'mount_app_studio',
            payload: {
              type: 'app_studio_pod',
              module: 'AppStudioPod',
              component: 'AppStudioPod',
              mode: 'builder',
              view: 'preview',
              appId: 42,
              appName: 'Fleet Console',
            },
          },
        ],
      },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <ModularAssemblyPuzzleRail turns={turns} />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('app-studio-rail')).toBeInTheDocument();
    expect(await screen.findByTestId('builder-tab-stub')).toBeInTheDocument();
  });

  it('gives the rail to the later mount when a manuscript is also open', async () => {
    const turns: any[] = [
      { id: 1, artifacts: [{ tool: 'mount_scribe_studio', payload: { type: 'scribe_foundry_pod', documentId: 12, title: 'Agreement' } }] },
      { id: 2, artifacts: [{ tool: 'mount_app_studio', payload: { type: 'app_studio_pod', mode: 'builder', appId: 42 } }] },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <ModularAssemblyPuzzleRail turns={turns} />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('app-studio-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('scribe-studio-rail')).not.toBeInTheDocument();
  });

  it('leaves the manuscript in place when it is the later mount', async () => {
    const turns: any[] = [
      { id: 1, artifacts: [{ tool: 'mount_app_studio', payload: { type: 'app_studio_pod', mode: 'builder', appId: 42 } }] },
      { id: 2, artifacts: [{ tool: 'mount_scribe_studio', payload: { type: 'scribe_foundry_pod', documentId: 12, title: 'Agreement' } }] },
    ];

    render(
      <QueryClientProvider client={queryClient}>
        <ModularAssemblyPuzzleRail turns={turns} />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('scribe-studio-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('app-studio-rail')).not.toBeInTheDocument();
  });
});
