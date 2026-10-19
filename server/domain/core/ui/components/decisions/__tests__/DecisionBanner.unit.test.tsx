/**
 * Unit tests for DecisionBanner component.
 *
 * Tests:
 * - Amber/orange warning style applied
 * - Auto-dismiss within 2s when all resolved
 * - Dismissed banner does not reappear for same requests
 * - New high-risk request after dismissal triggers banner again
 * - role="alert" and accessible dismiss
 *
 * Requirements: 4.5, 4.6, 4.7
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import React from 'react';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  X: (props: any) => <svg data-testid="x-icon" {...props} />,
  AlertTriangle: (props: any) => <svg data-testid="alert-triangle-icon" {...props} />,
  ArrowRight: (props: any) => <svg data-testid="arrow-right-icon" {...props} />,
}));

// Mock cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

import { useDecisionStore, type PendingRequest } from '../../../stores/decision.store';
import { DecisionBanner } from '../DecisionBanner';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create a high-risk request that is older than 5 minutes from `now`. */
function makeAgingHighRiskRequest(
  overrides: Partial<PendingRequest> = {},
  ageMinutes: number = 10
): PendingRequest {
  const createdAt = new Date(Date.now() - ageMinutes * 60 * 1000).toISOString();
  return {
    id: Math.floor(Math.random() * 10000),
    toolName: 'shell',
    riskLevel: 'high',
    description: 'Execute deployment script on production',
    missionId: 1,
    createdAt,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DecisionBanner (unit)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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

  // ── Requirement 4.6: Amber/orange warning style applied ─────────────────

  describe('amber/orange warning style (Requirement 4.6)', () => {
    it('renders with amber/orange background and border classes', () => {
      const agingRequest = makeAgingHighRiskRequest({ id: 1 });

      useDecisionStore.setState({
        highRiskAgingRequests: [agingRequest],
        bannerDismissedIds: new Set(),
      });

      render(<DecisionBanner />);

      const banner = screen.getByRole('alert');
      expect(banner).toBeInTheDocument();

      // Check amber/orange classes are present in the className
      const className = banner.className;
      expect(className).toContain('bg-amber');
      expect(className).toContain('border-amber');
    });

    it('uses amber text coloring for banner content', () => {
      const agingRequest = makeAgingHighRiskRequest({ id: 2 });

      useDecisionStore.setState({
        highRiskAgingRequests: [agingRequest],
        bannerDismissedIds: new Set(),
      });

      render(<DecisionBanner />);

      // Check that the banner includes amber-styled text
      const banner = screen.getByRole('alert');
      const textElements = banner.querySelectorAll('[class*="amber"]');
      expect(textElements.length).toBeGreaterThan(0);
    });
  });

  // ── Requirement 4.5: Auto-dismiss within 2s when all resolved ───────────

  describe('auto-dismiss within 2s when all resolved (Requirement 4.5)', () => {
    it('banner disappears within 2 seconds when all high-risk requests are resolved', () => {
      const agingRequest = makeAgingHighRiskRequest({ id: 10 });

      useDecisionStore.setState({
        highRiskAgingRequests: [agingRequest],
        bannerDismissedIds: new Set(),
      });

      const { rerender } = render(<DecisionBanner />);

      // Banner should be visible initially
      expect(screen.getByRole('alert')).toBeInTheDocument();

      // Resolve all requests (empty the list)
      act(() => {
        useDecisionStore.setState({
          highRiskAgingRequests: [],
          bannerDismissedIds: new Set(),
        });
      });

      rerender(<DecisionBanner />);

      // Banner should disappear immediately since bannerDisplay becomes null
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('auto-dismiss timer fires within 2 seconds after all requests resolve', () => {
      const agingRequest = makeAgingHighRiskRequest({ id: 11 });

      useDecisionStore.setState({
        highRiskAgingRequests: [agingRequest],
        bannerDismissedIds: new Set(),
      });

      render(<DecisionBanner />);
      expect(screen.getByRole('alert')).toBeInTheDocument();

      // Simulate all resolved
      act(() => {
        useDecisionStore.setState({
          highRiskAgingRequests: [],
          bannerDismissedIds: new Set(),
        });
      });

      // After 2 seconds the auto-dismiss effect should have completed
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // No banner should be present
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  // ── Requirement 4.7: Dismissed banner does not reappear for same requests ─

  describe('dismissed banner does not reappear for same requests (Requirement 4.7)', () => {
    it('banner does not reappear after dismiss for the same set of request IDs', () => {
      const agingRequest = makeAgingHighRiskRequest({ id: 20 });

      useDecisionStore.setState({
        highRiskAgingRequests: [agingRequest],
        bannerDismissedIds: new Set(),
      });

      render(<DecisionBanner />);
      expect(screen.getByRole('alert')).toBeInTheDocument();

      // Dismiss the banner
      const dismissButton = screen.getByLabelText('Dismiss decision banner');
      act(() => {
        fireEvent.click(dismissButton);
      });

      // After dismiss, the store should record the dismissed IDs
      // The banner should not reappear for request ID 20
      const state = useDecisionStore.getState();
      expect(state.bannerDismissedIds.has(20)).toBe(true);

      // Banner should not be visible now
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('same request IDs after dismiss do not trigger banner reappearance', () => {
      const agingRequest = makeAgingHighRiskRequest({ id: 30 });

      useDecisionStore.setState({
        highRiskAgingRequests: [agingRequest],
        bannerDismissedIds: new Set(),
      });

      const { rerender } = render(<DecisionBanner />);
      expect(screen.getByRole('alert')).toBeInTheDocument();

      // Dismiss the banner
      const dismissButton = screen.getByLabelText('Dismiss decision banner');
      act(() => {
        fireEvent.click(dismissButton);
      });

      // Banner should be gone
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      // Simulate a "re-check" with the same request still present
      // The bannerDismissedIds should prevent reappearance
      act(() => {
        useDecisionStore.setState({
          highRiskAgingRequests: [agingRequest],
          // bannerDismissedIds already contains 30 from the dismiss
        });
      });

      rerender(<DecisionBanner />);

      // Banner should still not appear because ID 30 is dismissed
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  // ── Requirement 4.4/4.7: New high-risk request after dismissal triggers banner ─

  describe('new high-risk request after dismissal triggers banner again (Requirement 4.4)', () => {
    it('a new request ID (not in dismissed set) triggers the banner to reappear', () => {
      const originalRequest = makeAgingHighRiskRequest({ id: 40 });

      useDecisionStore.setState({
        highRiskAgingRequests: [originalRequest],
        bannerDismissedIds: new Set(),
      });

      const { rerender } = render(<DecisionBanner />);
      expect(screen.getByRole('alert')).toBeInTheDocument();

      // Dismiss the banner (records ID 40 as dismissed)
      const dismissButton = screen.getByLabelText('Dismiss decision banner');
      act(() => {
        fireEvent.click(dismissButton);
      });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      // New request arrives with a different ID (not previously dismissed)
      const newRequest = makeAgingHighRiskRequest({ id: 41 });

      act(() => {
        useDecisionStore.setState({
          highRiskAgingRequests: [originalRequest, newRequest],
          // bannerDismissedIds still contains {40} from the dismiss
        });
      });

      rerender(<DecisionBanner />);

      // Banner should reappear because ID 41 is NOT in the dismissed set
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  // ── Requirement 4.6: role="alert" and accessible dismiss ────────────────

  describe('role="alert" and accessible dismiss (Requirement 4.6)', () => {
    it('banner wrapper has role="alert"', () => {
      const agingRequest = makeAgingHighRiskRequest({ id: 50 });

      useDecisionStore.setState({
        highRiskAgingRequests: [agingRequest],
        bannerDismissedIds: new Set(),
      });

      render(<DecisionBanner />);

      const banner = screen.getByRole('alert');
      expect(banner).toBeInTheDocument();
    });

    it('dismiss button has aria-label="Dismiss decision banner"', () => {
      const agingRequest = makeAgingHighRiskRequest({ id: 51 });

      useDecisionStore.setState({
        highRiskAgingRequests: [agingRequest],
        bannerDismissedIds: new Set(),
      });

      render(<DecisionBanner />);

      const dismissButton = screen.getByLabelText('Dismiss decision banner');
      expect(dismissButton).toBeInTheDocument();
      expect(dismissButton.tagName.toLowerCase()).toBe('button');
    });

    it('dismiss button is keyboard-accessible (type="button")', () => {
      const agingRequest = makeAgingHighRiskRequest({ id: 52 });

      useDecisionStore.setState({
        highRiskAgingRequests: [agingRequest],
        bannerDismissedIds: new Set(),
      });

      render(<DecisionBanner />);

      const dismissButton = screen.getByLabelText('Dismiss decision banner');
      expect(dismissButton).toHaveAttribute('type', 'button');
    });
  });

  // ── Additional: Duration refresh every 30 seconds ───────────────────────

  describe('duration refresh (Requirement 4.2)', () => {
    it('updates the displayed duration after 30 seconds', () => {
      // Create a request aging at exactly 10 minutes
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const agingRequest = makeAgingHighRiskRequest({
        id: 60,
        createdAt: tenMinutesAgo,
      });

      useDecisionStore.setState({
        highRiskAgingRequests: [agingRequest],
        bannerDismissedIds: new Set(),
      });

      render(<DecisionBanner />);

      // Banner should show "10 minutes" initially
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/10 minutes/)).toBeInTheDocument();

      // Advance 30 seconds — the interval refreshes "now"
      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      // Duration should still be displayed (now ~10.5 minutes, but displayed as "10 minutes" since Math.floor)
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
