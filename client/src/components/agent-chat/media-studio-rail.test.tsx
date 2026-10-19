import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/queryClient', () => ({ apiRequest: vi.fn() }));

/* The studios are stubbed: these tests are about which one the rail mounts. */
vi.mock('@/modules/media/MediaStudio', () => ({
  MediaStudio: ({ crewSessionId, sceneId, sceneTitle, aspectRatio, onClose, onFocusInChat, onProductionChange }: any) => (
    <div data-testid="media-studio-stub" data-crew-session-id={crewSessionId} data-scene-id={sceneId} data-scene-title={sceneTitle} data-aspect-ratio={aspectRatio}>
      <button onClick={() => onClose?.()}>Close media studio</button>
      <button onClick={() => onFocusInChat?.({ productionId: 7, sceneId: 21, sceneKey: 'SCENE-01', kind: 'shot', id: 31, label: 'SCENE-01 shot 1' })}>Discuss shot</button>
      <button onClick={() => onProductionChange?.(8)}>Open production 8</button>
    </div>
  ),
}));
vi.mock('@/modules/forms/FormStudioPod', () => ({ default: () => <div data-testid="form-studio-stub" /> }));
vi.mock('@/modules/apps/AppStudioPod', () => ({ default: () => <div data-testid="app-studio-stub" /> }));
vi.mock('@/modules/scribe/ScribeStudioPod', () => ({ ScribeStudioPod: () => <div data-testid="scribe-studio-stub" /> }));

import { ModularAssemblyPuzzleRail } from './ModularAssemblyPuzzleRail';
import { StudioMountNotice, studioMountKind } from './StudioMountNotice';
import { assemblyScopePrefix, summariseBusinessLogic } from './SelectedWorkstreamContextHUD';

afterEach(cleanup);

// The payload mount_media_studio emits.
const mediaMount = (id: number, payload: Record<string, unknown> = {}) => ({
  id,
  artifacts: [{
    tool: 'mount_media_studio',
    payload: { type: 'media_studio_pod', module: 'MediaStudioPod', component: 'MediaStudioPod', title: 'Rooftop chase', sceneId: 'SCENE-03', sceneTitle: 'Rooftop chase', aspectRatio: '2.39:1', ...payload },
  }],
});
const formMount = (id: number) => ({ id, artifacts: [{ tool: 'mount_form_studio', payload: { type: 'form_studio_pod', module: 'FormStudioPod', formId: 7, revision: 3 } }] });

function renderRail(props: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ModularAssemblyPuzzleRail turns={[]} {...(props as any)} />
    </QueryClientProvider>,
  );
}

describe('Media Studio in the rail', () => {
  it('opens directly in an empty room without an agent artifact', () => {
    renderRail({ openMediaStudio: true, sessionId: 42 });
    expect(screen.getByTestId('media-studio-stub')).toHaveAttribute('data-crew-session-id', '42');
  });
  it('mounts the studio for the scene a media_studio_pod artifact names', () => {
    renderRail({ turns: [mediaMount(1)], sessionId: 42 });
    expect(screen.getByTestId('media-studio-rail')).toBeInTheDocument();
    const stub = screen.getByTestId('media-studio-stub');
    expect(stub).toHaveAttribute('data-crew-session-id', '42');
    expect(stub).toHaveAttribute('data-scene-id', 'SCENE-03');
    expect(stub).toHaveAttribute('data-scene-title', 'Rooftop chase');
    expect(stub).toHaveAttribute('data-aspect-ratio', '2.39:1');
  });

  it('uses 16:9 for an aspect ratio it does not know', () => {
    renderRail({ turns: [mediaMount(1, { aspectRatio: '21:9' })] });
    expect(screen.getByTestId('media-studio-stub')).toHaveAttribute('data-aspect-ratio', '16:9');
  });

  it('does not mount for a Dailies deck or anything without the studio payload type', () => {
    renderRail({ turns: [{ id: 1, artifacts: [{ tool: 'render_dailies_deck', payload: { module: 'MediaStudioPod', sceneId: 'SCENE-01' } }] }] });
    expect(screen.queryByTestId('media-studio-rail')).not.toBeInTheDocument();
  });

  it('gives the rail to whichever studio was mounted later', () => {
    renderRail({ turns: [formMount(1), mediaMount(2)] });
    expect(screen.getByTestId('media-studio-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('form-studio-stub')).not.toBeInTheDocument();
    cleanup();

    renderRail({ turns: [mediaMount(1), formMount(2)] });
    expect(screen.getByTestId('form-studio-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('media-studio-stub')).not.toBeInTheDocument();
  });

  it('scopes the next message to what the author picks in the studio, and opens a collapsed chat', () => {
    const onSelectionChange = vi.fn();
    const onToggleChatCollapse = vi.fn();
    renderRail({ turns: [mediaMount(1)], onSelectionChange, isChatCollapsed: true, onToggleChatCollapse });
    fireEvent.click(screen.getByText('Discuss shot'));

    const selection = { productionId: 7, sceneId: 21, sceneKey: 'SCENE-01', kind: 'shot', id: 31, label: 'SCENE-01 shot 1' };
    expect(onSelectionChange).toHaveBeenCalledWith({ id: 'media-studio:7:shot:31', label: 'SCENE-01 shot 1', sublabel: 'Media Studio', type: 'media', mediaStudio: selection });
    expect(onToggleChatCollapse).toHaveBeenCalled();

    const unit = onSelectionChange.mock.calls[0][0];
    expect(assemblyScopePrefix(unit)).toBe(`[Media Studio selection: ${JSON.stringify(selection)}]`);
    expect(summariseBusinessLogic(unit)).toBe('Discussing SCENE-01 shot 1 in Media Studio. Your next message includes this context.');
  });

  it('drops a Media Studio selection once the studio shows a different production', () => {
    const onSelectionChange = vi.fn();
    renderRail({ turns: [mediaMount(1)], selectedId: 'media-studio:7:shot:31', onSelectionChange });
    expect(onSelectionChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Open production 8'));
    expect(onSelectionChange).toHaveBeenCalledWith(null);
  });

  it('stays closed once the author closes it', () => {
    const onExitMediaStudio = vi.fn();
    renderRail({ turns: [mediaMount(1)], onExitMediaStudio });
    fireEvent.click(screen.getByText('Close media studio'));
    expect(onExitMediaStudio).toHaveBeenCalled();
    cleanup();

    renderRail({ turns: [mediaMount(1)], isMediaStudioVisible: false });
    expect(screen.queryByTestId('media-studio-rail')).not.toBeInTheDocument();
  });
});

describe('the chat turn of a Media Studio mount', () => {
  it('points to the studio instead of rendering a copy of it', () => {
    expect(studioMountKind(mediaMount(1).artifacts[0])).toBe('media');
    expect(studioMountKind({ tool: 'render_dailies_deck', payload: {} })).toBeNull();

    render(<StudioMountNotice kind="media" title="Rooftop chase" />);
    expect(screen.getByText('Media Studio is open beside the conversation')).toBeInTheDocument();
    expect(screen.getByText(/Rooftop chase\./)).toBeInTheDocument();
  });
});
