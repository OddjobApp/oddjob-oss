import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { SignalsDecisionsWorkbench } from './SignalsDecisionsWorkbench';

vi.mock('@/components/signal-intelligence/spatial/ImpactVisualization', () => ({
  ImpactVisualization: ({ signalId }: { signalId: string }) => (
    <div data-testid="impact-viz-mock">Impact Viz for {signalId}</div>
  ),
}));

vi.mock('@/components/signal-intelligence/spatial/EntityDetailPanel', () => ({
  EntityDetailPanel: () => <div data-testid="entity-detail-mock">Entity Detail</div>,
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
    useQuery: ({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0]?.startsWith('/api/causal-graph/links')) {
        return {
          data: [
            {
              id: 'link-1',
              targetEntityType: 'SupplierFacility',
              targetEntityId: 'FAC-402',
              impactConfidence: 0.88,
              blastRadius: 3,
            },
          ],
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: [], isLoading: false, error: null };
    },
  };
});

describe('SignalsDecisionsWorkbench', () => {
  const mockSignals = [
    {
      id: 'sig-1',
      title: 'Strait of Malacca Congestion Surge',
      eventType: 'maritime_congestion',
      targetSector: 'Maritime Shipping',
      jurisdiction: 'APAC',
      severity: 'Critical',
      confidenceScore: 0.92,
      rawText: 'Severe vessel backup outside Singapore port corridor.',
      extractionTimestamp: new Date().toISOString(),
    },
    {
      id: 'sig-2',
      title: 'North Sea Wind Curtailment',
      eventType: 'grid_curtailment',
      targetSector: 'Renewable Power',
      jurisdiction: 'EU',
      severity: 'Low',
      confidenceScore: 0.74,
      rawText: 'Turbine curtailment due to grid transmission limits.',
      extractionTimestamp: new Date().toISOString(),
    },
  ];

  it('renders the workbench with signal list and decision brief', () => {
    render(
      <SignalsDecisionsWorkbench
        signals={mockSignals}
        selectedSignalId="sig-1"
        onSelectSignal={vi.fn()}
      />
    );

    expect(screen.getByTestId('signals-decisions-workbench')).toBeInTheDocument();
    expect(screen.getAllByText('Strait of Malacca Congestion Surge').length).toBeGreaterThan(0);
    expect(screen.getByText('North Sea Wind Curtailment')).toBeInTheDocument();
    expect(screen.getByText(/Executive Decision Plays/i)).toBeInTheDocument();
    expect(screen.getByTestId('impact-viz-mock')).toBeInTheDocument();
  });

  it('filters signals by search query', () => {
    render(
      <SignalsDecisionsWorkbench
        signals={mockSignals}
        selectedSignalId="sig-1"
        onSelectSignal={vi.fn()}
      />
    );

    const searchInput = screen.getByTestId('signal-search-input');
    fireEvent.change(searchInput, { target: { value: 'Malacca' } });

    expect(screen.getAllByText('Strait of Malacca Congestion Surge').length).toBeGreaterThan(0);
    expect(screen.queryByText('North Sea Wind Curtailment')).not.toBeInTheDocument();
  });

  it('filters signals by severity pills', () => {
    render(
      <SignalsDecisionsWorkbench
        signals={mockSignals}
        selectedSignalId="sig-1"
        onSelectSignal={vi.fn()}
      />
    );

    const criticalPill = screen.getByRole('button', { name: /^critical$/i });
    fireEvent.click(criticalPill);

    expect(screen.getAllByText('Strait of Malacca Congestion Surge').length).toBeGreaterThan(0);
    expect(screen.queryByText('North Sea Wind Curtailment')).not.toBeInTheDocument();
  });

  it('invokes onSelectSignal when a signal card is clicked', () => {
    const onSelect = vi.fn();
    render(
      <SignalsDecisionsWorkbench
        signals={mockSignals}
        selectedSignalId="sig-1"
        onSelectSignal={onSelect}
      />
    );

    const secondSignal = screen.getByTestId('signal-item-sig-2');
    fireEvent.click(secondSignal);

    expect(onSelect).toHaveBeenCalledWith('sig-2');
  });

  it('invokes onDiscussInCrew when "Discuss in CREW Room" is clicked', () => {
    const onDiscuss = vi.fn();
    render(
      <SignalsDecisionsWorkbench
        signals={mockSignals}
        selectedSignalId="sig-1"
        onSelectSignal={vi.fn()}
        onDiscussInCrew={onDiscuss}
      />
    );

    const discussBtn = screen.getByTestId('decision-discuss-crew');
    fireEvent.click(discussBtn);

    expect(onDiscuss).toHaveBeenCalledWith(
      expect.stringContaining('Strait of Malacca Congestion Surge')
    );
  });

  it('invokes onLaunchInitiative when "Launch Mitigation Initiative" is clicked', () => {
    const onLaunch = vi.fn();
    render(
      <SignalsDecisionsWorkbench
        signals={mockSignals}
        selectedSignalId="sig-1"
        onSelectSignal={vi.fn()}
        onLaunchInitiative={onLaunch}
      />
    );

    const launchBtn = screen.getByTestId('decision-launch-initiative');
    fireEvent.click(launchBtn);

    expect(onLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sig-1',
      })
    );
  });

  it('invokes onNavigateToTab when "Create Automated Rule" is clicked', () => {
    const onNavigate = vi.fn();
    render(
      <SignalsDecisionsWorkbench
        signals={mockSignals}
        selectedSignalId="sig-1"
        onSelectSignal={vi.fn()}
        onNavigateToTab={onNavigate}
      />
    );

    const ruleBtn = screen.getByTestId('decision-create-rule');
    fireEvent.click(ruleBtn);

    expect(onNavigate).toHaveBeenCalledWith('rules');
  });

  it('invokes onNavigateToTab when "Inspect on Spatial Map" is clicked', () => {
    const onNavigate = vi.fn();
    render(
      <SignalsDecisionsWorkbench
        signals={mockSignals}
        selectedSignalId="sig-1"
        onSelectSignal={vi.fn()}
        onNavigateToTab={onNavigate}
      />
    );

    const mapBtn = screen.getByTestId('decision-inspect-spatial');
    fireEvent.click(mapBtn);

    expect(onNavigate).toHaveBeenCalledWith('spatial');
  });
});
