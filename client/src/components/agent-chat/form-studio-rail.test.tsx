import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn() }));

/*
 * The studios are stubbed: these tests are about which one the rail mounts and
 * what reaches the room from it, not about the studios' own bodies.
 */
vi.mock('@/modules/forms/FormStudioPod', () => ({
  default: ({ formId, view, onFocusInChat, onClose }: any) => (
    <div data-testid="form-studio-stub" data-form-id={formId} data-view={view}>
      <button onClick={() => onFocusInChat?.({ formId, revision: 3, kind: 'field', key: 'flight_risk', label: 'Flight risk' })}>Discuss field</button>
      <button onClick={() => onClose?.()}>Close studio</button>
    </div>
  ),
}));
vi.mock('@/modules/apps/AppStudioPod', () => ({ default: () => <div data-testid="app-studio-stub" /> }));
vi.mock('@/modules/scribe/ScribeStudioPod', () => ({ ScribeStudioPod: () => <div data-testid="scribe-studio-stub" /> }));

import { ModularAssemblyPuzzleRail } from './ModularAssemblyPuzzleRail';
import { assemblyScopePrefix } from './SelectedWorkstreamContextHUD';

afterEach(cleanup);

const formMount = (id: number, formId = 7, view = 'logic') => ({ id, artifacts: [{ tool: 'mount_form_studio', payload: { type: 'form_studio_pod', module: 'FormStudioPod', formId, formName: 'Succession review', revision: 3, view } }] });
const appMount = (id: number) => ({ id, artifacts: [{ tool: 'mount_app_studio', payload: { type: 'app_studio_pod', mode: 'builder', appId: 42 } }] });

function renderRail(props: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModularAssemblyPuzzleRail turns={[]} {...(props as any)} />
    </QueryClientProvider>,
  );
}

describe('Form Studio in the rail', () => {
  it('mounts the studio from a form_studio_pod artifact', () => {
    renderRail({ turns: [formMount(1)] });
    expect(screen.getByTestId('form-studio-rail')).toBeInTheDocument();
    expect(screen.getByTestId('form-studio-stub')).toHaveAttribute('data-form-id', '7');
    expect(screen.getByTestId('form-studio-stub')).toHaveAttribute('data-view', 'logic');
  });

  it('gives the rail to whichever studio was mounted later', () => {
    renderRail({ turns: [appMount(1), formMount(2)] });
    expect(screen.getByTestId('form-studio-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('app-studio-stub')).not.toBeInTheDocument();
    cleanup();

    renderRail({ turns: [formMount(1), appMount(2)] });
    expect(screen.getByTestId('app-studio-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('form-studio-stub')).not.toBeInTheDocument();
  });

  it('does not mount a studio for a drafted change on its own', () => {
    renderRail({ turns: [{ id: 1, artifacts: [{ tool: 'propose_form_change', payload: { type: 'form_change_proposal', formId: 7, proposalId: 'formchg_0123456789abcdef', baseRevision: 3 } }] }] });
    expect(screen.queryByTestId('form-studio-rail')).not.toBeInTheDocument();
  });

  it('stays closed once the author closes it', () => {
    const onExitFormStudio = vi.fn();
    renderRail({ turns: [formMount(1)], onExitFormStudio });
    fireEvent.click(screen.getByText('Close studio'));
    expect(onExitFormStudio).toHaveBeenCalled();
    cleanup();

    renderRail({ turns: [formMount(1)], isFormStudioVisible: false });
    expect(screen.queryByTestId('form-studio-rail')).not.toBeInTheDocument();
  });

  it('scopes the next message to a unit selected in the studio, and opens a collapsed chat', () => {
    const onSelectionChange = vi.fn();
    const onToggleChatCollapse = vi.fn();
    renderRail({ turns: [formMount(1)], onSelectionChange, isChatCollapsed: true, onToggleChatCollapse });
    fireEvent.click(screen.getByText('Discuss field'));

    const selection = onSelectionChange.mock.calls[0][0];
    expect(selection).toMatchObject({ id: 'form-studio:7:field:flight_risk', label: 'Flight risk', type: 'form' });
    expect(assemblyScopePrefix(selection)).toBe('[Form Studio selection: {"formId":7,"revision":3,"kind":"field","key":"flight_risk","label":"Flight risk"}]');
    expect(onToggleChatCollapse).toHaveBeenCalled();
  });

  it('allows docking in split view when Form Studio and App Studio are co-active', () => {
    renderRail({ turns: [appMount(1), formMount(2)] });
    expect(screen.getByTestId('co-active-workbench-banner')).toBeInTheDocument();
    expect(screen.getByText('Active workbench:')).toBeInTheDocument();

    // Toggle split view
    fireEvent.click(screen.getByTestId('dock-split-view-button'));
    expect(screen.getByTestId('split-approval-rail')).toBeInTheDocument();
    expect(screen.getByTestId('app-studio-stub')).toBeInTheDocument();
    expect(screen.getByTestId('form-studio-stub')).toBeInTheDocument();

    // Maximize back to full Form Studio
    fireEvent.click(screen.getByTestId('maximize-approval-dock-button'));
    expect(screen.queryByTestId('split-approval-rail')).not.toBeInTheDocument();
    expect(screen.getByTestId('form-studio-stub')).toBeInTheDocument();
  });

  it('renders pending approval floating banner on active workbench and opens split view', () => {
    renderRail({ turns: [formMount(1), appMount(2)] });
    expect(screen.getByTestId('app-studio-stub')).toBeInTheDocument();
    expect(screen.getByTestId('pending-approval-banner')).toBeInTheDocument();

    // Click Split & Review
    fireEvent.click(screen.getByTestId('open-approval-split-button'));
    expect(screen.getByTestId('split-approval-rail')).toBeInTheDocument();
    expect(screen.getByTestId('app-studio-stub')).toBeInTheDocument();
    expect(screen.getByTestId('form-studio-stub')).toBeInTheDocument();
  });
});
