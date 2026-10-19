import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FlowCreateProposalCard } from './FlowCreateProposalCard';

afterEach(cleanup);

const payload = {
  proposalId: 'flownew_0123456789abcdef',
  name: 'Lead triage',
  instruction: 'Score inbound leads and email the owner when they look hot',
  steps: [
    { jobId: 4, jobName: 'Score lead', jobType: 'ai_agent', outputName: 'score' },
    { jobId: 9, jobName: 'Email owner', jobType: 'email_send', conditionExpression: 'score > 70' },
  ],
  summary: ['1. Score lead (ai_agent)', '2. Email owner (email_send) — only if score > 70'],
  checks: [],
};

describe('FlowCreateProposalCard', () => {
  it('shows the steps in the order they run', () => {
    render(<FlowCreateProposalCard payload={payload} onArtifactSubmit={vi.fn()} />);
    expect(screen.getByText('New flow: Lead triage')).toBeInTheDocument();
    expect(screen.getByText('Score lead')).toBeInTheDocument();
    expect(screen.getByText('Email owner')).toBeInTheDocument();
    expect(screen.getByText('score > 70')).toBeInTheDocument();
  });

  it('shows checks only when the draft has them', () => {
    render(<FlowCreateProposalCard payload={payload} onArtifactSubmit={vi.fn()} />);
    expect(screen.queryByText('Worth knowing before you create it')).not.toBeInTheDocument();

    cleanup();
    render(
      <FlowCreateProposalCard
        payload={{ ...payload, checks: ['Step 2 "Reorder" is a decision job: it does not branch.'] }}
        onArtifactSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText('Worth knowing before you create it')).toBeInTheDocument();
  });

  it('creates exactly this draft, once', () => {
    const submit = vi.fn();
    render(<FlowCreateProposalCard payload={payload} onArtifactSubmit={submit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create flow' }));
    fireEvent.click(screen.getByTestId('flow-create-confirm'));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith('Create flow "flownew_0123456789abcdef".');
  });
});
