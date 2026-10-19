import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import {
  DecisionRatificationCard,
  CommitmentContractCard,
  ClaimVerificationCard,
  GovernanceBlastRadiusCard,
} from './CrewDurableStateCards';

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
}));

afterEach(cleanup);

describe('DecisionRatificationCard', () => {
  it('renders decision statement, confidence, and alternatives', () => {
    render(
      <DecisionRatificationCard
        payload={{
          id: 101,
          statement: 'Adopt BullMQ for asynchronous distributed task orchestration',
          rationale: 'Redis-backed persistent queues provide reliable retry semantics',
          confidence: 92,
          status: 'proposed',
          createdBy: '@Architect',
          alternatives: ['pg-boss', 'RabbitMQ'],
          evidenceTurnIds: [4, 8],
        }}
      />
    );

    expect(screen.getByTestId('decision-ratification-card')).toBeInTheDocument();
    expect(screen.getByText('Adopt BullMQ for asynchronous distributed task orchestration')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(screen.getByText(/@Architect/)).toBeInTheDocument();
    expect(screen.getByText(/2 alternatives considered/)).toBeInTheDocument();

    // Toggle alternatives
    fireEvent.click(screen.getByText(/2 alternatives considered/));
    expect(screen.getByText(/pg-boss/)).toBeInTheDocument();
    expect(screen.getByText(/RabbitMQ/)).toBeInTheDocument();
  });

  it('triggers onArtifactSubmit when user ratifies the decision', async () => {
    const onArtifactSubmit = vi.fn();
    render(
      <DecisionRatificationCard
        payload={{
          id: 102,
          statement: 'Implement dual-write migration',
          status: 'proposed',
        }}
        onArtifactSubmit={onArtifactSubmit}
      />
    );

    const ratifyBtn = screen.getByTestId('decision-ratify-btn');
    fireEvent.click(ratifyBtn);

    expect(onArtifactSubmit).toHaveBeenCalledWith(
      'I ratified the decision: "Implement dual-write migration"'
    );
  });
});

describe('CommitmentContractCard', () => {
  it('renders commitment contract with owner and status', () => {
    render(
      <CommitmentContractCard
        payload={{
          id: 201,
          title: 'Scaffold Drizzle migration 0086',
          detail: 'Write up the database schema for crew durable states and test backward compatibility',
          ownerType: 'agent',
          ownerId: '@DatabaseSpecialist',
          status: 'open',
        }}
      />
    );

    expect(screen.getByTestId('commitment-contract-card')).toBeInTheDocument();
    expect(screen.getByText('Scaffold Drizzle migration 0086')).toBeInTheDocument();
    expect(screen.getByText('@DatabaseSpecialist')).toBeInTheDocument();
    expect(screen.getByTestId('commitment-start-btn')).toBeInTheDocument();
    expect(screen.getByTestId('commitment-complete-btn')).toBeInTheDocument();
  });

  it('allows completing a commitment contract', () => {
    const onArtifactSubmit = vi.fn();
    render(
      <CommitmentContractCard
        payload={{
          id: 202,
          title: 'Run test suite verification',
          status: 'in_progress',
        }}
        onArtifactSubmit={onArtifactSubmit}
      />
    );

    const completeBtn = screen.getByTestId('commitment-complete-btn');
    fireEvent.click(completeBtn);

    expect(onArtifactSubmit).toHaveBeenCalledWith(
      'I completed the commitment: "Run test suite verification"'
    );
  });
});

describe('ClaimVerificationCard', () => {
  it('renders claim, room consensus, and agent stances', () => {
    render(
      <ClaimVerificationCard
        payload={{
          id: 301,
          claim: 'API p99 latency decreased by 42% after connection pooling fix',
          confidence: 88,
          agreementLevel: 75,
          createdBy: '@TelemetryBot',
          positions: [
            { agentName: 'Architect', position: 'agree' },
            { agentName: 'SRE', position: 'agree' },
            { agentName: 'Security', position: 'disagree', rationale: 'Needs auth cache audit' },
          ],
          evidence: [
            { label: 'Grafana Telemetry Snapshot #1042' },
          ],
        }}
      />
    );

    expect(screen.getByTestId('claim-verification-card')).toBeInTheDocument();
    expect(screen.getByText(/API p99 latency decreased by 42%/)).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('@Architect')).toBeInTheDocument();
    expect(screen.getByText('@Security')).toBeInTheDocument();
    expect(screen.getByText('Grafana Telemetry Snapshot #1042')).toBeInTheDocument();
  });

  it('allows verifying a claim', () => {
    const onArtifactSubmit = vi.fn();
    render(
      <ClaimVerificationCard
        payload={{
          id: 302,
          claim: 'Data retention complies with GDPR Article 17',
          status: 'unverified',
        }}
        onArtifactSubmit={onArtifactSubmit}
      />
    );

    const supportBtn = screen.getByTestId('claim-support-btn');
    fireEvent.click(supportBtn);

    expect(onArtifactSubmit).toHaveBeenCalledWith(
      'I marked the claim as verified: "Data retention complies with GDPR Article 17"'
    );
  });
});

describe('GovernanceBlastRadiusCard', () => {
  it('renders high-risk governance gate with blast radius impact metrics', () => {
    render(
      <GovernanceBlastRadiusCard
        payload={{
          actionTitle: 'Truncate Audit Archive Log Partition',
          riskTier: 'critical',
          requestedBy: '@MaintenanceWorker',
          requiresDualSignOff: true,
          blastRadius: {
            affectedServices: ['audit-service', 'reporting-api'],
            dataDestructionRisk: true,
            estimatedCostUsd: 150,
            tenantsImpactedCount: 12,
            summary: 'Permanent removal of historical log partitions older than 90 days.',
          },
        }}
      />
    );

    expect(screen.getByTestId('governance-blast-radius-card')).toBeInTheDocument();
    expect(screen.getByText('Truncate Audit Archive Log Partition')).toBeInTheDocument();
    expect(screen.getByText('Critical risk')).toBeInTheDocument();
    expect(screen.getByText('Needs two sign-offs')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('$150')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('allows authorizing or blocking governance actions', () => {
    const onArtifactSubmit = vi.fn();
    render(
      <GovernanceBlastRadiusCard
        payload={{
          actionTitle: 'Deploy production hotfix',
          riskTier: 'high',
          requestedBy: '@ReleaseBot',
          status: 'pending',
        }}
        onArtifactSubmit={onArtifactSubmit}
      />
    );

    const authorizeBtn = screen.getByTestId('governance-authorize-btn');
    fireEvent.click(authorizeBtn);

    expect(onArtifactSubmit).toHaveBeenCalledWith(
      'I authorized high-risk execution for "Deploy production hotfix" (high risk tier)'
    );
  });
});
