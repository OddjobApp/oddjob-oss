import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CrewReviewCard } from './CrewReviewCard';

describe('CrewReviewCard', () => {
  it('shows blockers, uncertainty and evidence without approval controls', () => {
    render(<CrewReviewCard payload={{
      type: 'gate_review', template: 'project_phase_gate', title: 'Phase gate', summary: 'Review readiness',
      period: 'October 2026', methodologyVersion: 'pilot-v1',
      criteria: [{ label: 'Testing', score: null, weight: 1, evidence: 'Report not available' }],
      gates: [{ label: 'Architecture sign-off', status: 'fail', evidence: 'Sign-off missing' }],
    }} />);
    expect(screen.getByText('Score pending')).toBeTruthy();
    expect(screen.getByText('Sign-off missing')).toBeTruthy();
    expect(screen.getByText('Report not available')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
  });
  it('shows an explicit fallback for malformed persisted data', () => {
    render(<CrewReviewCard payload={{ type: 'gate_review' }} />);
    expect(screen.getByRole('alert').textContent).toContain('invalid');
  });
});
