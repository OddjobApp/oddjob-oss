import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn() }));

vi.mock('@/modules/forms/FormStudioPod', () => ({
  default: ({ formId }: any) => (
    <div data-testid="form-studio-stub" data-form-id={formId}>
      Form Content
    </div>
  ),
}));

vi.mock('@/modules/flows/FlowStudioPod', () => ({
  FlowStudioPod: ({ flowId, proposal }: any) => (
    <div data-testid="flow-studio-stub" data-flow-id={flowId}>
      Flow Content {proposal?.title}
    </div>
  ),
  default: ({ flowId, proposal }: any) => (
    <div data-testid="flow-studio-stub" data-flow-id={flowId}>
      Flow Content {proposal?.title}
    </div>
  ),
}));

vi.mock('@/modules/apps/AppStudioPod', () => ({
  default: ({ appId }: any) => (
    <div data-testid="app-studio-stub" data-app-id={appId}>
      App Content
    </div>
  ),
}));

vi.mock('@/modules/scribe/ScribeStudioPod', () => ({
  ScribeStudioPod: ({ documentId, title }: any) => (
    <div data-testid="scribe-studio-stub" data-doc-id={documentId}>
      Scribe Content {title}
    </div>
  ),
}));

import { ModularAssemblyPuzzleRail } from '@/components/agent-chat/ModularAssemblyPuzzleRail';

afterEach(cleanup);

const formMount = (id: number, formId = 101) => ({
  id,
  artifacts: [
    {
      tool: 'mount_form_studio',
      payload: {
        type: 'form_studio_pod',
        module: 'FormStudioPod',
        formId,
        formName: 'Customer Intake',
        revision: 1,
        view: 'logic',
      },
    },
  ],
});

const flowMount = (id: number, flowId = 'flw-202') => ({
  id,
  artifacts: [
    {
      tool: 'mount_flow_studio',
      payload: {
        type: 'flow_studio_pod',
        module: 'FlowStudioPod',
        flowId,
        proposal: {
          id: 'prop-1',
          title: 'Review Pipeline Flow',
          description: 'Approval pipeline',
          steps: [],
        },
      },
    },
  ],
});

const scribeMount = (id: number, documentId = 303) => ({
  id,
  artifacts: [
    {
      tool: 'mount_scribe_studio',
      payload: {
        type: 'scribe_studio_pod',
        module: 'ScribeStudioPod',
        documentId,
        title: 'Executive Summary Brief',
        archetypeMode: 'brief',
      },
    },
  ],
});

function renderRail(props: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModularAssemblyPuzzleRail turns={[]} {...(props as any)} />
    </QueryClientProvider>,
  );
}

describe('Multi-Studio Persistent Workspace in ModularAssemblyPuzzleRail', () => {
  it('does not display workspace tabs when only one studio is active', () => {
    renderRail({ turns: [formMount(1)] });
    expect(screen.getByTestId('form-studio-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('multi-studio-workspace-tabs')).not.toBeInTheDocument();
  });

  it('renders workspace tabs for all co-active studios (Intake form, Review flow, Scribe)', () => {
    renderRail({
      turns: [formMount(1), flowMount(2), scribeMount(3)],
    });

    expect(screen.getByTestId('multi-studio-workspace-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-tab-scribe')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-tab-flow')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-tab-form')).toBeInTheDocument();

    // The most recently mounted studio (scribe at turn 3) is active by default
    expect(screen.getByTestId('scribe-studio-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('flow-studio-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('form-studio-stub')).not.toBeInTheDocument();
  });

  it('switches between studios on tab click without losing co-active presence', () => {
    renderRail({
      turns: [formMount(1), flowMount(2)],
    });

    expect(screen.getByTestId('multi-studio-workspace-tabs')).toBeInTheDocument();
    // Flow was mounted at turn 2, so it's initially active
    expect(screen.getByTestId('flow-studio-stub')).toBeInTheDocument();

    // Click Intake Form tab
    fireEvent.click(screen.getByTestId('workspace-tab-form'));
    expect(screen.getByTestId('form-studio-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('flow-studio-stub')).not.toBeInTheDocument();

    // Click Flow tab to switch back
    fireEvent.click(screen.getByTestId('workspace-tab-flow'));
    expect(screen.getByTestId('flow-studio-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('form-studio-stub')).not.toBeInTheDocument();
  });

  it('closes a studio tab and switches to remaining active studio', () => {
    const onExitFlowStudio = vi.fn();
    renderRail({
      turns: [formMount(1), flowMount(2)],
      onExitFlowStudio,
    });

    expect(screen.getByTestId('flow-studio-stub')).toBeInTheDocument();

    // Click close on Flow tab
    fireEvent.click(screen.getByTestId('close-tab-flow'));
    expect(onExitFlowStudio).toHaveBeenCalledTimes(1);

    // Active workbench switches to the remaining tab (form)
    expect(screen.getByTestId('form-studio-stub')).toBeInTheDocument();
  });

  it('notifies onActiveStudioChange whenever the active studio tab changes', () => {
    const onActiveStudioChange = vi.fn();
    renderRail({
      turns: [formMount(1), flowMount(2)],
      onActiveStudioChange,
    });

    // Flow was mounted at turn 2, so it's initially active
    expect(onActiveStudioChange).toHaveBeenCalledWith('flow');

    // Switch to Form tab
    fireEvent.click(screen.getByTestId('workspace-tab-form'));
    expect(onActiveStudioChange).toHaveBeenCalledWith('form');
  });
});
