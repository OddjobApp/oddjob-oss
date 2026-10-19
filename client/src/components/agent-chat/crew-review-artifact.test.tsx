import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TurnRow } from './TurnRow';
import { REVIEW_TOOLS } from '../../../../server/domain/tools/v1/capabilities/review-tools';

describe('CREW review artifact round trip', () => {
  it.each(['render_performance_scorecard', 'render_gate_review'])('renders persisted %s output in the actual turn path', async tool => {
    const output = await REVIEW_TOOLS[tool].execute({
      template: 'custom', title: 'Recorded review', summary: 'Awaiting decision', period: 'October 2026',
      methodologyVersion: 'v1', criteria: [{ label: 'Quality', score: 90, weight: 1, evidence: 'Recorded QA result' }],
      gates: [{ label: 'Required review', status: 'unknown', evidence: 'No sign-off recorded' }],
    }, {} as any);
    const artifact = JSON.parse(JSON.stringify({ tool, payload: JSON.parse(output) }));
    render(<TurnRow turn={{ id: 41, speakerType: 'agent', speakerName: 'Reviewer', content: 'Review prepared.', artifacts: [artifact], toolsUsed: [] } as any} onArtifactSubmit={vi.fn()} currentUserId={null} />);
    expect(screen.getByRole('region', { name: 'Recorded review' })).toBeTruthy();
    expect(screen.getByText('Needs evidence')).toBeTruthy();
    expect(screen.getByText('90.0 / 100')).toBeTruthy();
  });
});
