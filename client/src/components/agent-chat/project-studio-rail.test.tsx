import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn() }));

// Stub studios
vi.mock('@/modules/project-studio/ProjectStudio', () => ({
  default: ({ title, projectTitle, objective, waves, onClose, onFocusInChat }: any) => (
    <div data-testid="project-studio-stub" data-title={title} data-project-title={projectTitle} data-objective={objective} data-wave-count={waves?.length ?? 0}>
      <button onClick={() => onFocusInChat?.({ waveId: 'w-1', waveTitle: 'Discovery', objective: 'Index APIs' }, 'Discuss this wave')}>
        Discuss wave
      </button>
      <button onClick={() => onClose?.()}>Close studio</button>
    </div>
  ),
  ProjectStudio: ({ title, projectTitle, objective, waves, onClose, onFocusInChat }: any) => (
    <div data-testid="project-studio-stub" data-title={title} data-project-title={projectTitle} data-objective={objective} data-wave-count={waves?.length ?? 0}>
      <button onClick={() => onFocusInChat?.({ waveId: 'w-1', waveTitle: 'Discovery', objective: 'Index APIs' }, 'Discuss this wave')}>
        Discuss wave
      </button>
      <button onClick={() => onClose?.()}>Close studio</button>
    </div>
  ),
}));
vi.mock('@/modules/forms/FormStudioPod', () => ({ default: () => <div data-testid="form-studio-stub" /> }));
vi.mock('@/modules/apps/AppStudioPod', () => ({ default: () => <div data-testid="app-studio-stub" /> }));
vi.mock('@/modules/scribe/ScribeStudioPod', () => ({ ScribeStudioPod: () => <div data-testid="scribe-studio-stub" /> }));

import { ModularAssemblyPuzzleRail } from './ModularAssemblyPuzzleRail';

afterEach(cleanup);

const projectMount = (id: number, title = 'Enterprise Rollout') => ({
  id,
  artifacts: [
    {
      tool: 'mount_project_studio',
      payload: {
        type: 'project_studio_pod',
        module: 'ProjectStudioPod',
        title: 'Project Studio',
        projectTitle: title,
      },
    },
  ],
});

const builderPodMount = (id: number) => ({
  id,
  artifacts: [
    {
      tool: 'mount_builder_pod',
      payload: {
        type: 'builder_pod',
        podComponent: 'ProjectPlanningPod',
        title: 'Project Studio',
        props: {
          projectTitle: 'Incident Response Plan',
          objective: 'Restore service and close the incident review.',
          waves: [{ id: 'wave-1', name: 'Containment' }],
        },
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

describe('Project Studio in the Assembler', () => {
  it('mounts the studio from a project_studio_pod artifact', () => {
    renderRail({ turns: [projectMount(1, 'SOC2 Project')] });
    expect(screen.getByTestId('project-studio-rail')).toBeInTheDocument();
    expect(screen.getByTestId('project-studio-stub')).toHaveAttribute('data-project-title', 'SOC2 Project');
  });

  it('mounts the studio from a mount_builder_pod artifact naming ProjectPlanningPod', () => {
    renderRail({ turns: [builderPodMount(1)] });
    expect(screen.getByTestId('project-studio-rail')).toBeInTheDocument();
    expect(screen.getByTestId('project-studio-stub')).toHaveAttribute('data-project-title', 'Incident Response Plan');
    expect(screen.getByTestId('project-studio-stub')).toHaveAttribute('data-objective', 'Restore service and close the incident review.');
    expect(screen.getByTestId('project-studio-stub')).toHaveAttribute('data-wave-count', '1');
  });

  it('handles closing the studio via onClose callback and internal visibility state', () => {
    const onExitProjectStudio = vi.fn();
    renderRail({ turns: [projectMount(1)], onExitProjectStudio });
    expect(screen.getByTestId('project-studio-rail')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Close studio'));
    expect(onExitProjectStudio).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('project-studio-rail')).not.toBeInTheDocument();
  });

  it('routes wave discussion back to chat composer via onSelectionChange', () => {
    const onSelectionChange = vi.fn();
    const onExpandChat = vi.fn();
    renderRail({ turns: [projectMount(1)], onSelectionChange, onExpandChat });

    fireEvent.click(screen.getByText('Discuss wave'));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const callArg = onSelectionChange.mock.calls[0][0];
    expect(callArg.id).toBe('project-studio:w-1');
    expect(callArg.label).toBe('Discovery');
    expect(callArg.type).toBe('project');
    expect(onExpandChat).toHaveBeenCalledTimes(1);
  });

  it('wins arbitration and mounts when Project Studio is mounted after an earlier Scribe Studio', () => {
    const scribeTurn = {
      id: 1,
      artifacts: [
        {
          tool: 'mount_scribe_studio',
          payload: {
            type: 'scribe_foundry_pod',
            module: 'ScribeStudioPod',
            title: 'Product Narrative',
          },
        },
      ],
    };
    const projectTurn = projectMount(2, 'Post-Narrative Project');
    renderRail({ turns: [scribeTurn, projectTurn], isScribeVisible: true, isProjectStudioVisible: true });

    expect(screen.getByTestId('project-studio-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('scribe-studio-stub')).not.toBeInTheDocument();
  });

  it('wins arbitration and mounts when Project Studio is mounted after an earlier App Studio', () => {
    const appTurn = {
      id: 1,
      artifacts: [
        {
          tool: 'mount_app_studio',
          payload: {
            type: 'app_studio_pod',
            module: 'AppStudioPod',
            mode: 'builder',
            title: 'Metrics App',
          },
        },
      ],
    };
    const projectTurn = projectMount(2, 'Post-App Project');
    renderRail({ turns: [appTurn, projectTurn], isAppStudioVisible: true, isProjectStudioVisible: true });

    expect(screen.getByTestId('project-studio-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('app-studio-stub')).not.toBeInTheDocument();
  });

  it('yields arbitration when Scribe Studio is mounted after Project Studio', () => {
    const projectTurn = projectMount(1, 'Early Project');
    const scribeTurn = {
      id: 2,
      artifacts: [
        {
          tool: 'mount_scribe_studio',
          payload: {
            type: 'scribe_foundry_pod',
            module: 'ScribeStudioPod',
            title: 'Subsequent Manuscript',
          },
        },
      ],
    };
    renderRail({ turns: [projectTurn, scribeTurn], isScribeVisible: true, isProjectStudioVisible: true });

    expect(screen.getByTestId('scribe-studio-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('project-studio-rail')).not.toBeInTheDocument();
  });
});
