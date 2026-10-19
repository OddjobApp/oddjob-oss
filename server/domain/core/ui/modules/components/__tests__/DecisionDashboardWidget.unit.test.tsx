/**
 * Unit tests for DecisionDashboardWidget component.
 *
 * Feature: decision-inbox-surface
 *
 * Tests validate:
 * - Empty state renders "No blocked work" (Requirement 5.3)
 * - Navigation to /control/decisions on item click (Requirement 5.5)
 * - "View all (N)" link appears when > 5 items (Requirement 5.6)
 * - Human-readable duration formatting via formatShortDuration (Requirement 5.2)
 */

import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom';

// Mock wouter
const mockSetLocation = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/', mockSetLocation],
}));

// Mock lucide-react icons. Spread the real module rather than listing icons:
// this widget renders BlockedSessionsWidget, which imports `Workflow`, and a
// hand-listed mock silently resolves any icon it forgot to `undefined` — which
// is what took this suite down when that sub-widget was added.
vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Scale: () => <svg data-testid="scale-icon" />,
  ArrowRight: () => <svg data-testid="arrow-right-icon" />,
}));

// Mock cn utility — just concatenate class names
vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

import { useDecisionStore, type PendingRequest } from '../../../stores/decision.store';
import { DecisionDashboardWidget, formatShortDuration } from '../DecisionDashboardWidget';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * The widget renders BlockedSessionsWidget, which fetches through react-query,
 * so every render needs a client — without one the hook throws "No QueryClient
 * set" before a single assertion runs.
 */
function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function makePendingRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    id: 1,
    toolName: 'shell',
    riskLevel: 'high',
    description: 'Execute deployment script',
    missionId: 7,
    createdAt: new Date(Date.now() - 3 * 60_000).toISOString(), // 3 minutes ago
    missionName: 'Deploy App',
    ...overrides,
  };
}

function makeMultipleRequests(count: number): PendingRequest[] {
  return Array.from({ length: count }, (_, i) =>
    makePendingRequest({
      id: i + 1,
      toolName: `tool-${i + 1}`,
      missionName: `Mission ${i + 1}`,
      createdAt: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
    })
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DecisionDashboardWidget', () => {
  beforeEach(() => {
    mockSetLocation.mockClear();
    // Reset store to empty state
    useDecisionStore.setState({ pendingRequests: [] });
  });

  // ── Empty State ───────────────────────────────────────────────────────────

  describe('empty state', () => {
    it('renders "No blocked work" when pendingRequests is empty', () => {
      useDecisionStore.setState({ pendingRequests: [] });
      render(<DecisionDashboardWidget />);

      expect(screen.getByText('No blocked work')).toBeInTheDocument();
    });

    it('renders the Scale icon in empty state', () => {
      useDecisionStore.setState({ pendingRequests: [] });
      render(<DecisionDashboardWidget />);

      expect(screen.getByTestId('scale-icon')).toBeInTheDocument();
    });

    it('does not render a list in empty state', () => {
      useDecisionStore.setState({ pendingRequests: [] });
      render(<DecisionDashboardWidget />);

      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });
  });

  // ── Navigation on Item Click ──────────────────────────────────────────────

  describe('navigation on item click', () => {
    it('navigates to /control/decisions when an item is clicked', () => {
      useDecisionStore.setState({
        pendingRequests: [makePendingRequest()],
      });
      render(<DecisionDashboardWidget />);

      const item = screen.getByRole('listitem');
      fireEvent.click(item);

      expect(mockSetLocation).toHaveBeenCalledWith('/control/decisions');
    });

    it('navigates to /control/decisions on Enter keypress', () => {
      useDecisionStore.setState({
        pendingRequests: [makePendingRequest()],
      });
      render(<DecisionDashboardWidget />);

      const item = screen.getByRole('listitem');
      fireEvent.keyDown(item, { key: 'Enter' });

      expect(mockSetLocation).toHaveBeenCalledWith('/control/decisions');
    });

    it('navigates to /control/decisions on Space keypress', () => {
      useDecisionStore.setState({
        pendingRequests: [makePendingRequest()],
      });
      render(<DecisionDashboardWidget />);

      const item = screen.getByRole('listitem');
      fireEvent.keyDown(item, { key: ' ' });

      expect(mockSetLocation).toHaveBeenCalledWith('/control/decisions');
    });
  });

  // ── View All Link ─────────────────────────────────────────────────────────

  describe('"View all" link when > 5 items', () => {
    it('does not show "View all" when there are 5 or fewer items', () => {
      useDecisionStore.setState({
        pendingRequests: makeMultipleRequests(5),
      });
      render(<DecisionDashboardWidget />);

      expect(screen.queryByText(/View all/)).not.toBeInTheDocument();
    });

    it('shows "View all (N)" button when there are more than 5 items', () => {
      useDecisionStore.setState({
        pendingRequests: makeMultipleRequests(8),
      });
      render(<DecisionDashboardWidget />);

      expect(screen.getByText('View all (8)')).toBeInTheDocument();
    });

    it('shows "View all (6)" for exactly 6 items', () => {
      useDecisionStore.setState({
        pendingRequests: makeMultipleRequests(6),
      });
      render(<DecisionDashboardWidget />);

      expect(screen.getByText('View all (6)')).toBeInTheDocument();
    });

    it('navigates to /control/decisions when "View all" is clicked', () => {
      useDecisionStore.setState({
        pendingRequests: makeMultipleRequests(7),
      });
      render(<DecisionDashboardWidget />);

      const viewAllButton = screen.getByText('View all (7)');
      fireEvent.click(viewAllButton);

      expect(mockSetLocation).toHaveBeenCalledWith('/control/decisions');
    });

    it('displays only 5 list items even when more exist', () => {
      useDecisionStore.setState({
        pendingRequests: makeMultipleRequests(10),
      });
      render(<DecisionDashboardWidget />);

      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(5);
    });
  });

  // ── Duration Formatting ───────────────────────────────────────────────────

  describe('human-readable duration formatting (formatShortDuration)', () => {
    it('formats 3 minutes as "3m"', () => {
      expect(formatShortDuration(3 * 60_000)).toBe('3m');
    });

    it('formats 1 hour 12 minutes as "1h 12m"', () => {
      expect(formatShortDuration(72 * 60_000)).toBe('1h 12m');
    });

    it('formats less than 1 minute as "< 1m"', () => {
      expect(formatShortDuration(30_000)).toBe('< 1m');
    });

    it('formats exactly 2 hours as "2h"', () => {
      expect(formatShortDuration(120 * 60_000)).toBe('2h');
    });

    it('formats 0 milliseconds as "< 1m"', () => {
      expect(formatShortDuration(0)).toBe('< 1m');
    });

    it('formats negative values as "< 1m"', () => {
      expect(formatShortDuration(-5000)).toBe('< 1m');
    });

    it('formats 59 seconds as "< 1m"', () => {
      expect(formatShortDuration(59_999)).toBe('< 1m');
    });

    it('formats exactly 1 minute as "1m"', () => {
      expect(formatShortDuration(60_000)).toBe('1m');
    });

    it('formats exactly 1 hour as "1h"', () => {
      expect(formatShortDuration(60 * 60_000)).toBe('1h');
    });
  });
});
