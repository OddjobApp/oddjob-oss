import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FormCreateProposalCard } from './FormCreateProposalCard';

afterEach(cleanup);

const payload = {
  proposalId: 'formnew_0123456789abcdef',
  name: 'Mortgage calculator',
  instruction: 'Build a mortgage calculator that saves to a dataset',
  summary: ['Fields: Loan amount, Interest rate, Term, Monthly payment', 'Results: Monthly payment'],
  checks: [],
  definition: {},
};

describe('FormCreateProposalCard', () => {
  it('shows what the new form holds', () => {
    render(<FormCreateProposalCard payload={payload} onArtifactSubmit={vi.fn()} />);
    expect(screen.getByText('New form: Mortgage calculator')).toBeInTheDocument();
    expect(screen.getByText('Fields: Loan amount, Interest rate, Term, Monthly payment')).toBeInTheDocument();
    expect(screen.queryByText(/checks? that block publishing/)).not.toBeInTheDocument();
  });

  it('creates exactly this draft, once', () => {
    const submit = vi.fn();
    render(<FormCreateProposalCard payload={payload} onArtifactSubmit={submit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    fireEvent.click(screen.getByTestId('form-create-confirm'));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith('Create form "formnew_0123456789abcdef".');
  });
});
