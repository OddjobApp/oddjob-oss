import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { RuleBuilder } from './RuleBuilder';
import * as queryClientModule from '@/lib/queryClient';

vi.mock('@/hooks/use-org-timezone', () => ({
  useOrgTimezone: () => 'America/New_York',
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: string[] }) => {
      const key = queryKey[0];
      if (typeof key === 'string' && key.includes('/audits')) {
        return {
          data: [
            {
              id: 'audit-1',
              executedAt: '2026-09-25T10:00:00Z',
              ruleId: 'rule-test-1',
              outcome: 'matched',
              payload: {
                masterPriorityScore: 94,
                disposition: 'TRIGGER',
              },
            },
          ],
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      if (typeof key === 'string' && key.includes('/api/event-primitives')) {
        return {
          data: [
            {
              id: 'sig-test-1',
              title: 'Strait of Malacca Congestion',
              eventType: 'SPATIAL_DRIFT_ALERT',
              targetSector: 'Maritime Security',
              jurisdiction: 'Pacific',
              severity: 'CRITICAL',
              confidenceScore: 0.95,
            },
          ],
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: [], isLoading: false, error: null, refetch: vi.fn() };
    },
  };
});

describe('RuleBuilder Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders primary authoring surface with default tabs', () => {
    render(<RuleBuilder />);

    expect(screen.getByRole('button', { name: /Triage & Semantic/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Test Simulation/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Policy Definitions/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Evaluation Logs/i })).toBeDefined();
  });

  it('switches to Test Simulation tab and renders simulation controls', () => {
    render(<RuleBuilder />);

    const simTab = screen.getByRole('button', { name: /Test Simulation/i });
    fireEvent.click(simTab);

    expect(screen.getByText(/Counterfactual Rule Simulation/i)).toBeDefined();
    expect(screen.getByTestId('btn-run-simulation')).toBeDefined();
    expect(screen.getByTestId('btn-run-backtest')).toBeDefined();
  });

  it('triggers single simulation API and displays outcome results', async () => {
    const apiSpy = vi.spyOn(queryClientModule, 'apiRequest').mockResolvedValueOnce({
      json: async () => ({
        matched: true,
        masterPriorityScore: 96,
        ruleId: 'rule-test-sim',
        disposition: 'TRIGGER',
        matchedBranch: 'rule_condition_1',
        spatialScore: 0.88,
        fuzzyScores: {
          confidenceFloor: 0.92,
        },
      }),
    } as any);

    render(<RuleBuilder />);

    // Generate conditions via Quick Rule Parser so hasConditions is true
    const parserInput = screen.getByPlaceholderText(/Route all defense signals/i);
    fireEvent.change(parserInput, { target: { value: 'defense signals high severity' } });
    const generateBtn = screen.getByRole('button', { name: /Generate Rule/i });
    fireEvent.click(generateBtn);

    // Switch to simulation tab
    const simTab = screen.getByRole('button', { name: /Test Simulation/i });
    fireEvent.click(simTab);

    const runBtn = screen.getByTestId('btn-run-simulation');
    expect(runBtn).not.toBeDisabled();
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(apiSpy).toHaveBeenCalledWith(
        'POST',
        '/api/rule-suites/simulate',
        expect.objectContaining({
          specification: expect.any(Object),
          sampleEvent: expect.any(Object),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('simulation-result-card')).toBeDefined();
      expect(screen.getByText(/MATCHED \(RULE WOULD FIRE\)/i)).toBeDefined();
      expect(screen.getByText('96')).toBeDefined();
    });
  });

  it('switches to Policy Definitions tab and renders active governance matrix', () => {
    render(<RuleBuilder />);

    const policyTab = screen.getByRole('button', { name: /Policy Definitions/i });
    fireEvent.click(policyTab);

    expect(screen.getByText(/Active Governance Matrix/i)).toBeDefined();
    expect(screen.getByText(/HIGHEST_PRIORITY_MAUF/i)).toBeDefined();
    expect(screen.getByText(/Tenant Isolation Boundary/i)).toBeDefined();
    expect(screen.getByText(/Epistemic Confidence Floor/i)).toBeDefined();
  });

  it('switches to Evaluation Logs tab and renders audit trail items', () => {
    render(<RuleBuilder />);

    const logsTab = screen.getByRole('button', { name: /Evaluation Logs/i });
    fireEvent.click(logsTab);

    expect(screen.getByText(/Real-time Rule Evaluation Stream/i)).toBeDefined();
    expect(screen.getByTestId('btn-refresh-audits')).toBeDefined();
    expect(screen.getByText(/rule-test-1/i)).toBeDefined();
    expect(screen.getByText(/Score: 94/i)).toBeDefined();
  });
});
