/**
 * Component-level unit tests for DecisionToastManager.
 *
 * Tests the rendered component behavior:
 * - Toast appears within 500ms of a new decision event
 * - Dismiss button removes toast immediately
 * - ARIA live region with polite politeness present
 * - Assistant approvals open on toast click
 *
 * Requirements: 3.1, 3.5, 3.7, 3.8
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import React from 'react';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  X: (props: any) => <svg data-testid="x-icon" {...props} />,
  AlertTriangle: (props: any) => <svg data-testid="alert-triangle-icon" {...props} />,
  AlertCircle: (props: any) => <svg data-testid="alert-circle-icon" {...props} />,
  Info: (props: any) => <svg data-testid="info-icon" {...props} />,
}));

// Mock cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

import { useDecisionStore, type PendingRequest } from '../../../stores/decision.store';
import { DecisionToastManager } from '../DecisionToastManager';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePendingRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    id: Math.floor(Math.random() * 10000),
    toolName: 'shell',
    riskLevel: 'medium',
    description: 'Execute deployment script on staging',
    missionId: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DecisionToastManager (component)', () => {
  const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

  beforeEach(() => {
    vi.useFakeTimers();
    dispatchEventSpy.mockClear();
    // Reset store to empty state
    useDecisionStore.setState({
      pendingCount: 0,
      pendingRequests: [],
      highRiskAgingRequests: [],
      bannerDismissedIds: new Set(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Requirement 3.1: Toast appears within 500ms of event ────────────────

  describe('toast appearance timing (Requirement 3.1)', () => {
    it('shows a toast within 500ms when a new pending request arrives', () => {
      render(<DecisionToastManager />);

      // Initially no toasts visible
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      // Simulate a new decision arriving by updating the store
      const newRequest = makePendingRequest({
        id: 42,
        toolName: 'deploy',
        description: 'Deploy to production',
      });

      act(() => {
        useDecisionStore.setState({
          pendingCount: 1,
          pendingRequests: [newRequest],
        });
      });

      // Advance by 500ms — toast should be visible
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Toast should now be rendered with tool name
      expect(screen.getByText('deploy')).toBeInTheDocument();
      expect(screen.getByText('Deploy to production')).toBeInTheDocument();
    });

    it('shows toast immediately (within same tick) since the component reacts to state changes', () => {
      render(<DecisionToastManager />);

      const newRequest = makePendingRequest({
        id: 100,
        toolName: 'npm-install',
        description: 'Install dependencies',
      });

      act(() => {
        useDecisionStore.setState({
          pendingCount: 1,
          pendingRequests: [newRequest],
        });
      });

      // The toast should appear as part of the reactive render cycle
      expect(screen.getByText('npm-install')).toBeInTheDocument();
    });
  });

  // ── Requirement 3.7: Dismiss button removes toast immediately ───────────

  describe('dismiss button (Requirement 3.7)', () => {
    it('removes the toast immediately when dismiss button is clicked', () => {
      render(<DecisionToastManager />);

      // Add a toast
      const newRequest = makePendingRequest({
        id: 55,
        toolName: 'shell',
        description: 'Run test suite',
      });

      act(() => {
        useDecisionStore.setState({
          pendingCount: 1,
          pendingRequests: [newRequest],
        });
      });

      // Verify toast is present
      expect(screen.getByText('shell')).toBeInTheDocument();

      // Find and click dismiss button (aria-label: "Dismiss notification")
      const dismissButton = screen.getByLabelText('Dismiss notification');
      act(() => {
        fireEvent.click(dismissButton);
      });

      // Toast should be removed immediately
      expect(screen.queryByText('shell')).not.toBeInTheDocument();
    });

    it('dismiss does not trigger navigation', () => {
      render(<DecisionToastManager />);

      const newRequest = makePendingRequest({
        id: 77,
        toolName: 'build',
        description: 'Compile project',
      });

      act(() => {
        useDecisionStore.setState({
          pendingCount: 1,
          pendingRequests: [newRequest],
        });
      });

      const dismissButton = screen.getByLabelText('Dismiss notification');
      act(() => {
        fireEvent.click(dismissButton);
      });

      expect(dispatchEventSpy).not.toHaveBeenCalledWith(expect.objectContaining({
        type: 'agent-assist-request',
      }));
    });
  });

  // ── Requirement 3.8: ARIA live region with polite politeness ────────────

  describe('ARIA live region (Requirement 3.8)', () => {
    it('renders a container with aria-live="polite" when no toasts are present', () => {
      const { container } = render(<DecisionToastManager />);

      const liveRegion = container.querySelector('[aria-live="polite"]');
      expect(liveRegion).toBeInTheDocument();
    });

    it('renders a container with aria-live="polite" when toasts are present', () => {
      render(<DecisionToastManager />);

      const newRequest = makePendingRequest({
        id: 88,
        toolName: 'test-tool',
        description: 'A test decision',
      });

      act(() => {
        useDecisionStore.setState({
          pendingCount: 1,
          pendingRequests: [newRequest],
        });
      });

      const liveRegion = screen.getByText('test-tool').closest('[aria-live="polite"]');
      expect(liveRegion).toBeInTheDocument();
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });

    it('has aria-atomic="false" on the live region', () => {
      const { container } = render(<DecisionToastManager />);

      const liveRegion = container.querySelector('[aria-live="polite"]');
      expect(liveRegion).toHaveAttribute('aria-atomic', 'false');
    });

    it('each toast has an aria-label with tool name and risk level', () => {
      render(<DecisionToastManager />);

      const newRequest = makePendingRequest({
        id: 101,
        toolName: 'kubectl',
        riskLevel: 'high',
        description: 'Scale deployment',
      });

      act(() => {
        useDecisionStore.setState({
          pendingCount: 1,
          pendingRequests: [newRequest],
        });
      });

      const toast = screen.getByLabelText('New decision: kubectl, high risk');
      expect(toast).toBeInTheDocument();
    });
  });

  // ── Requirement 3.5: Navigation to decisions page on click ──────────────

  describe('assistant activation on click (Requirement 3.5)', () => {
    it('opens Assistant approvals when a toast is clicked', () => {
      render(<DecisionToastManager />);

      const newRequest = makePendingRequest({
        id: 200,
        toolName: 'terraform',
        riskLevel: 'high',
        description: 'Apply infrastructure changes',
      });

      act(() => {
        useDecisionStore.setState({
          pendingCount: 1,
          pendingRequests: [newRequest],
        });
      });

      // Click the toast body (not the dismiss button)
      const toast = screen.getByLabelText('New decision: terraform, high risk');
      act(() => {
        fireEvent.click(toast);
      });

      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'agent-assist-request',
        detail: {
          context: { assistantView: 'approvals', source: 'decision-toast' },
        },
      }));
    });

    it('removes the toast after Assistant click-through', () => {
      render(<DecisionToastManager />);

      const newRequest = makePendingRequest({
        id: 201,
        toolName: 'docker',
        description: 'Build container image',
      });

      act(() => {
        useDecisionStore.setState({
          pendingCount: 1,
          pendingRequests: [newRequest],
        });
      });

      const toast = screen.getByText('docker').closest('[role="status"]')!;
      act(() => {
        fireEvent.click(toast);
      });

      // Toast should be removed after click-through activation
      expect(screen.queryByText('docker')).not.toBeInTheDocument();
    });

    it('opens Assistant approvals when summary toast is clicked', () => {
      render(<DecisionToastManager maxVisible={2} />);

      // Add 4 requests to trigger summary toast
      const requests = [
        makePendingRequest({ id: 301, toolName: 'tool-1' }),
        makePendingRequest({ id: 302, toolName: 'tool-2' }),
        makePendingRequest({ id: 303, toolName: 'tool-3' }),
        makePendingRequest({ id: 304, toolName: 'tool-4' }),
      ];

      act(() => {
        useDecisionStore.setState({
          pendingCount: 4,
          pendingRequests: requests,
        });
      });

      // Summary toast should appear showing "+2 more"
      const summaryToast = screen.getByText(/\+2 more pending decision/);
      act(() => {
        fireEvent.click(summaryToast.closest('[role="status"]')!);
      });

      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({
        type: 'agent-assist-request',
        detail: {
          context: { assistantView: 'approvals', source: 'decision-toast-summary' },
        },
      }));
    });
  });
});
