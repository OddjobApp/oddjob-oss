import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TurnRow } from './TurnRow';
import { MediaChangeProposalCard } from './MediaChangeProposalCard';

const proposal = {
  proposalId: 'mediachg_0123456789abcdef',
  productionId: 7,
  productionTitle: 'Rooftop chase',
  sceneId: 21,
  sceneKey: 'SCENE-01',
  sceneTitle: 'Arrival',
  target: { kind: 'scene' as const, id: 21, label: 'SCENE-01: Arrival' },
  instruction: 'Make it colder and add a beat where the drone spots her',
  baseDigest: 'abc',
  edits: [],
  changes: ['Scene mood: "tense" → "cold, watchful"', 'New plot point after plot point 1 ("She reaches the roof"): "The drone spots her"'],
  skipped: ['There is no shot 999 in SCENE-01, so it was left out.'],
};

describe('MediaChangeProposalCard', () => {
  it('says what changes, and sends only its own approval, once', () => {
    const onArtifactSubmit = vi.fn();
    render(<MediaChangeProposalCard payload={proposal} onArtifactSubmit={onArtifactSubmit} />);

    expect(screen.getByText('Change to SCENE-01 · Arrival')).toBeInTheDocument();
    expect(screen.getByText('In Rooftop chase. Nothing is saved until you apply it.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'What changes' })).toHaveTextContent('Scene mood: "tense" → "cold, watchful"');
    expect(screen.getByText('One part of the request was left out.')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('media-change-apply'));
    fireEvent.click(screen.getByTestId('media-change-apply'));
    expect(onArtifactSubmit).toHaveBeenCalledTimes(1);
    expect(onArtifactSubmit).toHaveBeenCalledWith('Apply media change "mediachg_0123456789abcdef".');
    expect(screen.getByTestId('media-change-apply')).toHaveTextContent('Applying…');
  });
});

describe('a studio marker in the transcript', () => {
  it('shows the marked item as a chip, not the selection JSON', () => {
    const content = `[Media Studio selection: ${JSON.stringify({ productionId: 7, sceneId: 21, sceneKey: 'SCENE-01', kind: 'scene', id: 21, label: 'SCENE-01: Arrival' })}] Make the mood colder`;
    render(<TurnRow turn={{ id: 1, speakerType: 'user', userId: 'u1', speakerName: 'Ana', content, artifacts: [] } as any} names={[]} onArtifactSubmit={vi.fn()} currentUserId="u1" />);

    const row = screen.getByTestId('crew-turn-user');
    expect(screen.getByTestId('turn-scope-chip')).toHaveTextContent('Media Studio · SCENE-01: Arrival');
    expect(row).toHaveTextContent('Make the mood colder');
    expect(row).not.toHaveTextContent('productionId');
  });

  it('renders the change card an agent turn carries', () => {
    const onArtifactSubmit = vi.fn();
    const turn = { id: 2, speakerType: 'agent', speakerName: 'Director', content: 'Here is the change.', artifacts: [{ tool: 'propose_media_change', payload: { type: 'media_change_proposal', ...proposal } }] };
    render(<TurnRow turn={turn as any} names={['Director']} onArtifactSubmit={onArtifactSubmit} currentUserId="u1" />);
    fireEvent.click(screen.getByTestId('media-change-apply'));
    expect(onArtifactSubmit).toHaveBeenCalledWith('Apply media change "mediachg_0123456789abcdef".');
  });

  it('renders the MediaConfigPod instant app surface when turn carries media_config_surface', async () => {
    const onArtifactSubmit = vi.fn();
    const turn = {
      id: 3,
      speakerType: 'agent',
      speakerName: 'Director',
      content: 'Here is the shot configuration.',
      artifacts: [{
        tool: 'configure_media_shot',
        payload: {
          type: 'media_config_surface',
          sceneTitle: 'Cyberpunk Rooftop',
          shotNumber: 2,
        },
      }],
    };
    render(<TurnRow turn={turn as any} names={['Director']} onArtifactSubmit={onArtifactSubmit} currentUserId="u1" />);

    expect(await screen.findByTestId('media-config-pod')).toBeInTheDocument();
    expect(screen.getByText('Cyberpunk Rooftop Configuration')).toBeInTheDocument();
    expect(screen.getByText('Shot #2')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mount-media-rail-btn'));
    expect(onArtifactSubmit).toHaveBeenCalledWith('Please open Media Studio in the workspace rail');
  });
});
