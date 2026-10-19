import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';

// Mock wouter
const mockSetLocation = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/', mockSetLocation],
}));

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Scale: () => <svg data-testid="scale-icon" />,
}));

// Mock cn utility — just concatenate class names
vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

import { useDecisionStore } from '../../../stores/decision.store';
import { DecisionIndicator } from '../DecisionIndicator';

describe('DecisionIndicator', () => {
  beforeEach(() => {
    mockSetLocation.mockClear();
    // Reset store to default state
    useDecisionStore.setState({ pendingCount: 0 });
  });

  // ── Rendering states ────────────────────────────────────────────────────

  describe('badge rendering', () => {
    it('renders without badge when count is 0', () => {
      useDecisionStore.setState({ pendingCount: 0 });
      render(<DecisionIndicator />);

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
      // No badge span should be present — badge only renders when badgeText is truthy
      expect(button.querySelector('span')).toBeNull();
      expect(screen.queryByText('9+')).not.toBeInTheDocument();
    });

    it('renders badge with "5" when count is 5', () => {
      useDecisionStore.setState({ pendingCount: 5 });
      render(<DecisionIndicator />);

      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('renders badge with "9+" when count exceeds 9', () => {
      useDecisionStore.setState({ pendingCount: 15 });
      render(<DecisionIndicator />);

      expect(screen.getByText('9+')).toBeInTheDocument();
    });
  });

  // ── Aria-label ──────────────────────────────────────────────────────────

  describe('aria-label', () => {
    it('has aria-label "No pending decisions" when count is 0', () => {
      useDecisionStore.setState({ pendingCount: 0 });
      render(<DecisionIndicator />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'No pending decisions');
    });

    it('has aria-label "3 pending decisions" when count is 3', () => {
      useDecisionStore.setState({ pendingCount: 3 });
      render(<DecisionIndicator />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', '3 pending decisions');
    });

    it('has aria-label "1 pending decision" when count is 1 (singular)', () => {
      useDecisionStore.setState({ pendingCount: 1 });
      render(<DecisionIndicator />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', '1 pending decision');
    });
  });

  // ── Navigation on click ─────────────────────────────────────────────────

  describe('navigation', () => {
    it('navigates to /control/decisions on click', () => {
      useDecisionStore.setState({ pendingCount: 2 });
      render(<DecisionIndicator />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(mockSetLocation).toHaveBeenCalledWith('/control/decisions');
    });
  });

  // ── Keyboard activation ─────────────────────────────────────────────────

  describe('keyboard activation', () => {
    it('navigates on Enter key press', () => {
      useDecisionStore.setState({ pendingCount: 1 });
      render(<DecisionIndicator />);

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: 'Enter' });

      expect(mockSetLocation).toHaveBeenCalledWith('/control/decisions');
    });

    it('navigates on Space key press', () => {
      useDecisionStore.setState({ pendingCount: 1 });
      render(<DecisionIndicator />);

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: ' ' });

      expect(mockSetLocation).toHaveBeenCalledWith('/control/decisions');
    });

    it('does not navigate on other key presses', () => {
      useDecisionStore.setState({ pendingCount: 1 });
      render(<DecisionIndicator />);

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: 'Tab' });

      expect(mockSetLocation).not.toHaveBeenCalled();
    });
  });
});
