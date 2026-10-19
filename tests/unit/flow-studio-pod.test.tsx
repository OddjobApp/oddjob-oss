import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FlowStudioPod } from '@/modules/flows/FlowStudioPod';
import type { FlowCreateProposal } from '@shared/flow-studio-crew';

afterEach(cleanup);

const mockProposal: FlowCreateProposal = {
  proposalId: 'flownew_test12345678',
  name: 'Customer Support Triage Flow',
  instruction: 'Triage customer inquiries, classify priority, and escalate hot tickets',
  steps: [
    {
      jobId: 101,
      jobName: 'Intake Inquiries',
      jobType: 'transformer',
      outputName: 'inquiry_payload',
      status: 'ready',
    },
    {
      jobId: 102,
      jobName: 'Sentiment Classifier',
      jobType: 'ai_agent',
      outputName: 'sentiment_score',
      conditionExpression: 'inquiry_payload != null',
      status: 'ready',
    },
    {
      jobId: 103,
      jobName: 'Manager Escalation Gate',
      jobType: 'human_approval',
      conditionExpression: 'sentiment_score < 30',
      onError: 'continue',
      status: 'ready',
    },
  ],
  summary: ['1. Intake Inquiries', '2. Sentiment Classifier', '3. Manager Escalation Gate'],
  checks: [],
  readinessScore: 95,
  proofStatus: 'VERIFIED',
  bounds: {
    durationP50: 34.7,
    durationP95: 62.4,
    costP50: 0.016,
    costP95: 0.024,
  },
  reviewPerspectives: [
    {
      lens: 'security',
      title: 'Security & Governance',
      status: 'optimal',
      summary: 'Authentication and authorization bounds verified.',
      notes: ['All jobs scoped to tenant'],
    },
    {
      lens: 'sre',
      title: 'SRE & Resilience',
      status: 'optimal',
      summary: 'Escalation step configured with continue-on-error strategy.',
      notes: ['Fallback enabled on step 3'],
    },
  ],
  dataEdges: [
    {
      id: 'edge_0_1_inquiry_payload',
      sourceStepIndex: 0,
      targetStepIndex: 1,
      portKey: 'inquiry_payload',
    },
  ],
};

describe('FlowStudioPod', () => {
  it('renders flow title, steps, readiness badge, and bounds metrics', () => {
    render(
      <FlowStudioPod
        proposal={mockProposal}
        organizationId={7}
      />
    );

    expect(screen.getByText('Customer Support Triage Flow')).toBeInTheDocument();
    expect(screen.getByText('95% VERIFIED')).toBeInTheDocument();
    expect(screen.getByText('Intake Inquiries')).toBeInTheDocument();
    expect(screen.getByText('Sentiment Classifier')).toBeInTheDocument();
    expect(screen.getByText('Manager Escalation Gate')).toBeInTheDocument();
  });

  it('toggles between Canvas DAG and List view modes', () => {
    render(
      <FlowStudioPod
        proposal={mockProposal}
        organizationId={7}
      />
    );

    // Initial default is Canvas
    expect(screen.getByText(/Visual Flow DAG/i)).toBeInTheDocument();

    // Toggle to List mode
    const listBtn = screen.getByRole('button', { name: 'List' });
    fireEvent.click(listBtn);
    expect(screen.queryByText(/Visual Flow DAG/i)).not.toBeInTheDocument();

    // Toggle back to Canvas mode
    const canvasBtn = screen.getByRole('button', { name: 'Canvas' });
    fireEvent.click(canvasBtn);
    expect(screen.getByText(/Visual Flow DAG/i)).toBeInTheDocument();
  });

  it('allows stepping through simulation with playback buttons', () => {
    render(
      <FlowStudioPod
        proposal={mockProposal}
        organizationId={7}
      />
    );

    const stepForwardBtn = screen.getByTitle('Step Forward');
    fireEvent.click(stepForwardBtn);

    // First step should show simulated execution inspector
    expect(screen.getByText('Simulated Step Execution:')).toBeInTheDocument();
  });

  it('renders review lenses and reveals details on lens click', () => {
    render(
      <FlowStudioPod
        proposal={mockProposal}
        organizationId={7}
      />
    );

    const securityBtn = screen.getByRole('button', { name: /security/i });
    fireEvent.click(securityBtn);

    expect(
      screen.getByText('Authentication and authorization bounds verified.')
    ).toBeInTheDocument();
  });

  it('triggers onFocusInChat when a contextual transformation chip is clicked', () => {
    const focusInChat = vi.fn();
    render(
      <FlowStudioPod
        proposal={mockProposal}
        organizationId={7}
        onFocusInChat={focusInChat}
      />
    );

    // Click step 1 to select it
    fireEvent.click(screen.getByTestId('flow-step-1'));

    // Quick action chip: Fallback
    const fallbackChip = screen.getByRole('button', { name: /fallback/i });
    fireEvent.click(fallbackChip);

    expect(focusInChat).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Intake Inquiries', type: 'step' }),
      expect.stringContaining('fallback')
    );
  });

  it('submits exact create flow message when user clicks Create Flow', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render(
      <FlowStudioPod
        proposal={mockProposal}
        organizationId={7}
        onArtifactSubmit={submit}
      />
    );

    const createBtn = screen.getByTestId('flow-studio-create-btn');
    fireEvent.click(createBtn);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith('Create flow "flownew_test12345678".');
    expect(await screen.findByText('Flow Saved')).toBeInTheDocument();
    expect(screen.getByText('Open in Cycle')).toBeInTheDocument();
  });

  it('handles save errors with retry capability', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(undefined);

    render(
      <FlowStudioPod
        proposal={mockProposal}
        organizationId={7}
        onArtifactSubmit={submit}
      />
    );

    const createBtn = screen.getByTestId('flow-studio-create-btn');
    fireEvent.click(createBtn);

    expect(await screen.findByText(/Network error/i)).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Flow Saved')).toBeInTheDocument();
  });

  it('renders walkthrough dry-run indicator in playback controls', () => {
    render(
      <FlowStudioPod
        proposal={mockProposal}
        organizationId={7}
      />
    );

    expect(screen.getByText(/Walkthrough dry-run/i)).toBeInTheDocument();
  });

  it('renders contract edges and inspects step ports and contracts', () => {
    render(
      <FlowStudioPod
        proposal={mockProposal}
        organizationId={7}
      />
    );

    // Contract edges between steps
    expect(screen.getByTestId('flow-contract-edge-1')).toBeInTheDocument();
    expect(screen.getByText('$inquiry_payload')).toBeInTheDocument();
    expect(screen.getByTestId('flow-contract-edge-2')).toBeInTheDocument();
    expect(screen.getByText('$sentiment_score')).toBeInTheDocument();

    // Select step 2
    fireEvent.click(screen.getByTestId('flow-step-2'));
    expect(screen.getByText('Step Contracts & Ports:')).toBeInTheDocument();
    expect(screen.getByText(/Inbound:/)).toBeInTheDocument();
    expect(screen.getByText(/Outbound:/)).toBeInTheDocument();
  });
});
