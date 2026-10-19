/**
 * Unit tests for BulkActionToolbar component.
 * Requirements: 4.4, 4.5, 4.6, 4.10, 4.11
 *
 * Tests:
 * - Renders toolbar with correct selected count
 * - Dismiss button triggers onDismiss callback
 * - Escalate button triggers onEscalate callback
 * - Snooze button opens duration picker
 * - Snooze duration selection triggers onSnooze with correct duration
 * - All buttons disabled when isPending is true
 * - Accessible ARIA attributes
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { BulkActionToolbar, type BulkActionToolbarProps } from './BulkActionToolbar';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderToolbar(props: Partial<BulkActionToolbarProps> = {}) {
  const defaultProps: BulkActionToolbarProps = {
    selectedCount: 3,
    onDismiss: vi.fn(),
    onEscalate: vi.fn(),
    onSnooze: vi.fn(),
    isPending: false,
    ...props,
  };
  return { ...render(createElement(BulkActionToolbar, defaultProps)), props: defaultProps };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BulkActionToolbar', () => {
  afterEach(() => cleanup());

  describe('rendering', () => {
    it('renders with correct selected count', () => {
      renderToolbar({ selectedCount: 5 });
      expect(screen.getByText('5 selected')).toBeTruthy();
    });

    it('has role="toolbar" with accessible label', () => {
      renderToolbar();
      const toolbar = screen.getByRole('toolbar');
      expect(toolbar.getAttribute('aria-label')).toBe('Bulk actions');
    });

    it('renders dismiss, escalate, and snooze buttons', () => {
      renderToolbar();
      expect(screen.getByTestId('bulk-dismiss-btn')).toBeTruthy();
      expect(screen.getByTestId('bulk-escalate-btn')).toBeTruthy();
      expect(screen.getByTestId('bulk-snooze-btn')).toBeTruthy();
    });
  });

  describe('dismiss action', () => {
    it('calls onDismiss when dismiss button is clicked', () => {
      const onDismiss = vi.fn();
      renderToolbar({ onDismiss });
      fireEvent.click(screen.getByTestId('bulk-dismiss-btn'));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('escalate action', () => {
    it('calls onEscalate when escalate button is clicked', () => {
      const onEscalate = vi.fn();
      renderToolbar({ onEscalate });
      fireEvent.click(screen.getByTestId('bulk-escalate-btn'));
      expect(onEscalate).toHaveBeenCalledTimes(1);
    });
  });

  describe('snooze action', () => {
    it('shows duration picker when snooze button is clicked', () => {
      renderToolbar();
      fireEvent.click(screen.getByTestId('bulk-snooze-btn'));
      expect(screen.getByTestId('snooze-duration-menu')).toBeTruthy();
    });

    it('calls onSnooze with 15m when 15 min option is clicked', () => {
      const onSnooze = vi.fn();
      renderToolbar({ onSnooze });
      fireEvent.click(screen.getByTestId('bulk-snooze-btn'));
      fireEvent.click(screen.getByTestId('snooze-option-15m'));
      expect(onSnooze).toHaveBeenCalledWith('15m');
    });

    it('calls onSnooze with 1h when 1 hour option is clicked', () => {
      const onSnooze = vi.fn();
      renderToolbar({ onSnooze });
      fireEvent.click(screen.getByTestId('bulk-snooze-btn'));
      fireEvent.click(screen.getByTestId('snooze-option-1h'));
      expect(onSnooze).toHaveBeenCalledWith('1h');
    });

    it('calls onSnooze with 4h when 4 hours option is clicked', () => {
      const onSnooze = vi.fn();
      renderToolbar({ onSnooze });
      fireEvent.click(screen.getByTestId('bulk-snooze-btn'));
      fireEvent.click(screen.getByTestId('snooze-option-4h'));
      expect(onSnooze).toHaveBeenCalledWith('4h');
    });

    it('calls onSnooze with 24h when 24 hours option is clicked', () => {
      const onSnooze = vi.fn();
      renderToolbar({ onSnooze });
      fireEvent.click(screen.getByTestId('bulk-snooze-btn'));
      fireEvent.click(screen.getByTestId('snooze-option-24h'));
      expect(onSnooze).toHaveBeenCalledWith('24h');
    });

    it('closes duration picker after selecting a duration', () => {
      renderToolbar();
      fireEvent.click(screen.getByTestId('bulk-snooze-btn'));
      expect(screen.getByTestId('snooze-duration-menu')).toBeTruthy();
      fireEvent.click(screen.getByTestId('snooze-option-1h'));
      expect(screen.queryByTestId('snooze-duration-menu')).toBeNull();
    });

    it('snooze button has aria-expanded and aria-haspopup', () => {
      renderToolbar();
      const btn = screen.getByTestId('bulk-snooze-btn');
      expect(btn.getAttribute('aria-haspopup')).toBe('menu');
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(btn);
      expect(btn.getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('pending state', () => {
    it('disables all action buttons when isPending is true', () => {
      renderToolbar({ isPending: true });
      expect(screen.getByTestId('bulk-dismiss-btn')).toHaveProperty('disabled', true);
      expect(screen.getByTestId('bulk-escalate-btn')).toHaveProperty('disabled', true);
      expect(screen.getByTestId('bulk-snooze-btn')).toHaveProperty('disabled', true);
    });

    it('does not call callbacks when buttons are disabled', () => {
      const onDismiss = vi.fn();
      const onEscalate = vi.fn();
      renderToolbar({ isPending: true, onDismiss, onEscalate });
      fireEvent.click(screen.getByTestId('bulk-dismiss-btn'));
      fireEvent.click(screen.getByTestId('bulk-escalate-btn'));
      expect(onDismiss).not.toHaveBeenCalled();
      expect(onEscalate).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('dismiss button has accessible label with count', () => {
      renderToolbar({ selectedCount: 7 });
      const btn = screen.getByTestId('bulk-dismiss-btn');
      expect(btn.getAttribute('aria-label')).toBe('Dismiss 7 signals');
    });

    it('escalate button has accessible label with count', () => {
      renderToolbar({ selectedCount: 2 });
      const btn = screen.getByTestId('bulk-escalate-btn');
      expect(btn.getAttribute('aria-label')).toBe('Escalate 2 signals');
    });

    it('snooze button has accessible label with count', () => {
      renderToolbar({ selectedCount: 4 });
      const btn = screen.getByTestId('bulk-snooze-btn');
      expect(btn.getAttribute('aria-label')).toBe('Snooze 4 signals');
    });

    it('snooze duration menu has role="menu"', () => {
      renderToolbar();
      fireEvent.click(screen.getByTestId('bulk-snooze-btn'));
      const menu = screen.getByTestId('snooze-duration-menu');
      expect(menu.getAttribute('role')).toBe('menu');
    });

    it('snooze duration options have role="menuitem"', () => {
      renderToolbar();
      fireEvent.click(screen.getByTestId('bulk-snooze-btn'));
      const items = screen.getAllByRole('menuitem');
      expect(items.length).toBe(4);
    });
  });
});
