import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FormChangeProposalCard } from './FormChangeProposalCard';

afterEach(cleanup);

const payload = {
  proposalId: 'formchg_0123456789abcdef',
  formId: 7,
  formName: 'Succession review',
  baseRevision: 3,
  instruction: 'Weight flight risk at 20%',
  changes: ['Changed field: Flight risk'],
  checks: ['Page calibration is not in any stage, so nobody is asked to fill it in.'],
  definition: {},
};

describe('FormChangeProposalCard', () => {
  it('shows what changes and what it leaves blocking publish', () => {
    render(<FormChangeProposalCard payload={payload} onArtifactSubmit={vi.fn()} />);
    expect(screen.getByText('Change to Succession review')).toBeInTheDocument();
    expect(screen.getByText('Changed field: Flight risk')).toBeInTheDocument();
    expect(screen.getByText(/fails 1 check that block publishing/)).toBeInTheDocument();
  });

  it('applies exactly this card, once', () => {
    const submit = vi.fn();
    render(<FormChangeProposalCard payload={payload} onArtifactSubmit={submit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply as revision 4' }));
    fireEvent.click(screen.getByTestId('form-change-apply'));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith('Apply form change "formchg_0123456789abcdef".');
    expect(screen.getByTestId('form-change-apply')).toBeDisabled();
  });
});
