/**
 * Unit tests for ActionTimeline component.
 * Requirements: 5.1, 5.2
 *
 * Tests:
 * - Renders action list with type, timestamp, and outcome
 * - Sorts actions in reverse chronological order (50 most recent)
 * - Shows "Cycle Active" badge when a cycle_launched action is pending
 * - Hides "Cycle Active" badge when no pending cycle_launched actions
 * - Shows loading state
 * - Shows empty state when no actions
 * - Load more button triggers callback
 * - Load more button is hidden when hasMore is false
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { ActionTimeline, type ActionTimelineProps } from './ActionTimeline';
import type { SignalAction } from './utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAction(overrides: Partial<SignalAction> = {}): SignalAction {
  return {
    id: `action-${Math.random().toString(36).slice(2)}`,
    type: 'dismissed',
    timestamp: new Date().toISOString(),
    outcome: 'succeeded',
    ...overrides,
  };
}

function renderTimeline(props: Partial<ActionTimelineProps> = {}) {
  const defaultProps: ActionTimelineProps = {
    signalId: 'signal-123',
    actions: [],
    isLoading: false,
    hasMore: false,
    onLoadMore: vi.fn(),
    ...props,
  };
  return { ...render(createElement(ActionTimeline, defaultProps)), props: defaultProps };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ActionTimeline', () => {
  afterEach(() => cleanup());

  describe('rendering', () => {
    it('renders the section with accessible label', () => {
      renderTimeline({ signalId: 'sig-abc' });
      const section = screen.getByTestId('action-timeline');
      expect(section.getAttribute('aria-label')).toBe(
        'Action timeline for signal sig-abc',
      );
    });

    it('renders the heading "Action Timeline"', () => {
      renderTimeline();
      expect(screen.getByText('Action Timeline')).toBeTruthy();
    });

    it('renders action items with correct type labels', () => {
      const actions: SignalAction[] = [
        makeAction({ id: '1', type: 'cycle_launched' }),
        makeAction({ id: '2', type: 'escalated' }),
        makeAction({ id: '3', type: 'dismissed' }),
        makeAction({ id: '4', type: 'snoozed' }),
      ];
      renderTimeline({ actions });
      expect(screen.getByText('Cycle Launched')).toBeTruthy();
      expect(screen.getByText('Escalated')).toBeTruthy();
      expect(screen.getByText('Dismissed')).toBeTruthy();
      expect(screen.getByText('Snoozed')).toBeTruthy();
    });

    it('renders outcome badges for each action', () => {
      const actions: SignalAction[] = [
        makeAction({ id: '1', outcome: 'succeeded' }),
        makeAction({ id: '2', outcome: 'failed' }),
        makeAction({ id: '3', outcome: 'pending' }),
      ];
      renderTimeline({ actions });
      expect(screen.getByText('Succeeded')).toBeTruthy();
      expect(screen.getByText('Failed')).toBeTruthy();
      expect(screen.getByText('Pending')).toBeTruthy();
    });

    it('renders each action as a list item', () => {
      const actions: SignalAction[] = [
        makeAction({ id: 'a1' }),
        makeAction({ id: 'a2' }),
      ];
      renderTimeline({ actions });
      expect(screen.getByTestId('action-item-a1')).toBeTruthy();
      expect(screen.getByTestId('action-item-a2')).toBeTruthy();
    });
  });

  describe('sorting and capping', () => {
    it('displays actions sorted in reverse chronological order', () => {
      const actions: SignalAction[] = [
        makeAction({ id: 'oldest', timestamp: '2024-01-01T00:00:00Z' }),
        makeAction({ id: 'newest', timestamp: '2024-12-01T00:00:00Z' }),
        makeAction({ id: 'middle', timestamp: '2024-06-01T00:00:00Z' }),
      ];
      renderTimeline({ actions });
      const list = screen.getByTestId('action-timeline-list');
      const items = list.querySelectorAll('li');
      expect(items[0].getAttribute('data-testid')).toBe('action-item-newest');
      expect(items[1].getAttribute('data-testid')).toBe('action-item-middle');
      expect(items[2].getAttribute('data-testid')).toBe('action-item-oldest');
    });

    it('caps displayed actions at 50', () => {
      const actions: SignalAction[] = Array.from({ length: 60 }, (_, i) =>
        makeAction({
          id: `action-${i}`,
          timestamp: new Date(2024, 0, 1, 0, i).toISOString(),
        }),
      );
      renderTimeline({ actions });
      const list = screen.getByTestId('action-timeline-list');
      const items = list.querySelectorAll('li');
      expect(items.length).toBe(50);
    });
  });

  describe('Cycle Active badge (Req 5.1)', () => {
    it('shows "Cycle Active" badge when a cycle_launched action is pending', () => {
      const actions: SignalAction[] = [
        makeAction({ id: '1', type: 'cycle_launched', outcome: 'pending' }),
      ];
      renderTimeline({ actions });
      expect(screen.getByTestId('cycle-active-badge')).toBeTruthy();
      expect(screen.getByText('Cycle Active')).toBeTruthy();
    });

    it('hides "Cycle Active" badge when no pending cycle_launched actions', () => {
      const actions: SignalAction[] = [
        makeAction({ id: '1', type: 'cycle_launched', outcome: 'succeeded' }),
        makeAction({ id: '2', type: 'escalated', outcome: 'pending' }),
      ];
      renderTimeline({ actions });
      expect(screen.queryByTestId('cycle-active-badge')).toBeNull();
    });

    it('hides "Cycle Active" badge when actions are empty', () => {
      renderTimeline({ actions: [] });
      expect(screen.queryByTestId('cycle-active-badge')).toBeNull();
    });
  });

  describe('loading state', () => {
    it('shows loading indicator when isLoading and no actions', () => {
      renderTimeline({ isLoading: true, actions: [] });
      expect(screen.getByText('Loading actions…')).toBeTruthy();
    });

    it('does not show loading text when there are already actions', () => {
      renderTimeline({
        isLoading: true,
        actions: [makeAction({ id: '1' })],
      });
      expect(screen.queryByText('Loading actions…')).toBeNull();
    });
  });

  describe('empty state', () => {
    it('shows empty message when not loading and no actions', () => {
      renderTimeline({ isLoading: false, actions: [] });
      expect(screen.getByTestId('action-timeline-empty')).toBeTruthy();
      expect(
        screen.getByText('No actions recorded for this signal.'),
      ).toBeTruthy();
    });
  });

  describe('load more', () => {
    it('shows "Load older actions" button when hasMore is true', () => {
      renderTimeline({
        hasMore: true,
        actions: [makeAction({ id: '1' })],
      });
      expect(screen.getByTestId('action-timeline-load-more')).toBeTruthy();
      expect(screen.getByText('Load older actions')).toBeTruthy();
    });

    it('hides load more button when hasMore is false', () => {
      renderTimeline({
        hasMore: false,
        actions: [makeAction({ id: '1' })],
      });
      expect(screen.queryByTestId('action-timeline-load-more')).toBeNull();
    });

    it('calls onLoadMore when button is clicked', () => {
      const onLoadMore = vi.fn();
      renderTimeline({
        hasMore: true,
        actions: [makeAction({ id: '1' })],
        onLoadMore,
      });
      fireEvent.click(screen.getByTestId('action-timeline-load-more'));
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('disables load more button when isLoading', () => {
      renderTimeline({
        hasMore: true,
        isLoading: true,
        actions: [makeAction({ id: '1' })],
      });
      const btn = screen.getByTestId('action-timeline-load-more');
      expect(btn).toHaveProperty('disabled', true);
    });

    it('shows loading text in button when isLoading with hasMore', () => {
      renderTimeline({
        hasMore: true,
        isLoading: true,
        actions: [makeAction({ id: '1' })],
      });
      expect(screen.getByText('Loading…')).toBeTruthy();
    });
  });
});
