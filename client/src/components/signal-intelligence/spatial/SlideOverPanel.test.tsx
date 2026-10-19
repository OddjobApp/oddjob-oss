/**
 * Unit tests for SlideOverPanel component.
 * Requirements: 6.6, 6.7, 6.8
 *
 * Tests:
 * - Renders when open, hidden when closed
 * - Max-width constraints (480px / 90vw)
 * - Focus trap within panel
 * - Escape key closes panel
 * - Focus returns to trigger element on close
 * - Semantic HTML / ARIA attributes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createRef, useState, createElement } from 'react';
import { SlideOverPanel } from './SlideOverPanel';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderPanel(props: Partial<Parameters<typeof SlideOverPanel>[0]> = {}) {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    title: 'Test Panel',
    children: createElement('button', { 'data-testid': 'child-btn' }, 'Action'),
    ...props,
  };
  return render(createElement(SlideOverPanel, defaultProps));
}

/** Wrapper component that toggles the panel open/closed for focus restoration tests. */
function ToggleWrapper() {
  const [open, setOpen] = useState(false);
  const triggerRef = createRef<HTMLButtonElement>();

  return createElement('div', null,
    createElement('button', {
      ref: triggerRef,
      'data-testid': 'trigger-btn',
      onClick: () => setOpen(true),
    }, 'Open'),
    createElement(SlideOverPanel, {
      open,
      onClose: () => setOpen(false),
      title: 'Focus Test',
      triggerRef: triggerRef as React.RefObject<HTMLElement>,
      children: createElement('button', { 'data-testid': 'inside-btn' }, 'Inside'),
    }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SlideOverPanel', () => {
  afterEach(() => cleanup());

  describe('visibility', () => {
    it('renders nothing when open is false', () => {
      renderPanel({ open: false });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('renders a dialog when open is true', () => {
      renderPanel({ open: true });
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });

  describe('ARIA attributes', () => {
    it('has role="dialog" and aria-modal="true"', () => {
      renderPanel();
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
    });

    it('labels the dialog with the title via aria-labelledby', () => {
      renderPanel({ title: 'Settings' });
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-labelledby')).toBe('slide-over-title');
      expect(screen.getByText('Settings').id).toBe('slide-over-title');
    });

    it('links aria-describedby to the description when provided', () => {
      renderPanel({ title: 'X', description: 'Some description' });
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-describedby')).toBe('slide-over-description');
      expect(screen.getByText('Some description').id).toBe('slide-over-description');
    });

    it('omits aria-describedby when no description is provided', () => {
      renderPanel({ title: 'X', description: undefined });
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-describedby')).toBeNull();
    });
  });

  describe('max-width constraint', () => {
    it('applies max-w-[480px] and w-[90vw] classes', () => {
      renderPanel();
      const panel = screen.getByTestId('slide-over-panel');
      expect(panel.className).toContain('max-w-[480px]');
      expect(panel.className).toContain('w-[90vw]');
    });
  });

  describe('Escape key closes panel', () => {
    it('calls onClose when Escape is pressed', () => {
      const onClose = vi.fn();
      renderPanel({ onClose });
      const dialog = screen.getByRole('dialog');
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('backdrop click closes panel', () => {
    it('calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn();
      renderPanel({ onClose });
      fireEvent.click(screen.getByTestId('slide-over-backdrop'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('close button', () => {
    it('renders a close button with accessible label', () => {
      renderPanel();
      const closeBtn = screen.getByTestId('slide-over-close');
      expect(closeBtn.getAttribute('aria-label')).toBe('Close panel');
    });

    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      renderPanel({ onClose });
      fireEvent.click(screen.getByTestId('slide-over-close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('focus trap', () => {
    it('wraps focus from last to first element on Tab', () => {
      render(createElement(SlideOverPanel, {
        open: true,
        onClose: vi.fn(),
        title: 'Trap Test',
        children: createElement('div', null,
          createElement('button', { 'data-testid': 'btn-a' }, 'A'),
          createElement('button', { 'data-testid': 'btn-b' }, 'B'),
        ),
      }));

      const dialog = screen.getByRole('dialog');
      const btnB = screen.getByTestId('btn-b');

      // Focus the last focusable element
      btnB.focus();
      expect(document.activeElement).toBe(btnB);

      // Tab should wrap to first focusable element
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: false });
      // The close button is the first focusable element in the panel
      expect(document.activeElement).toBe(screen.getByTestId('slide-over-close'));
    });

    it('wraps focus from first to last element on Shift+Tab', () => {
      render(createElement(SlideOverPanel, {
        open: true,
        onClose: vi.fn(),
        title: 'Trap Test',
        children: createElement('div', null,
          createElement('button', { 'data-testid': 'btn-a' }, 'A'),
          createElement('button', { 'data-testid': 'btn-b' }, 'B'),
        ),
      }));

      const dialog = screen.getByRole('dialog');
      const closeBtn = screen.getByTestId('slide-over-close');

      // Focus the first focusable element (close button)
      closeBtn.focus();
      expect(document.activeElement).toBe(closeBtn);

      // Shift+Tab should wrap to last focusable element
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(screen.getByTestId('btn-b'));
    });
  });

  describe('focus restoration', () => {
    it('returns focus to the trigger element on close', async () => {
      render(createElement(ToggleWrapper));

      const triggerBtn = screen.getByTestId('trigger-btn');

      // Open the panel
      triggerBtn.focus();
      fireEvent.click(triggerBtn);

      // Panel should be open
      expect(screen.getByRole('dialog')).toBeTruthy();

      // Close via Escape
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

      // Panel should be closed
      expect(screen.queryByRole('dialog')).toBeNull();

      // Focus should return to the trigger button
      expect(document.activeElement).toBe(triggerBtn);
    });
  });

  describe('content rendering', () => {
    it('renders children content inside the panel body', () => {
      renderPanel({
        children: createElement('p', { 'data-testid': 'content' }, 'Panel content'),
      });
      expect(screen.getByTestId('content').textContent).toBe('Panel content');
    });

    it('renders the title in an h2 element', () => {
      renderPanel({ title: 'My Title' });
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading.textContent).toBe('My Title');
    });
  });
});
