/**
 * Unit tests for EmptyState component.
 * Requirements: 1.4
 *
 * Tests:
 * - Renders empty-state message when no signals exist
 * - Displays at least two actionable prompts: configure source + inject scenario
 * - Configure Source button triggers onConfigureSource callback
 * - Inject Scenario button triggers onInjectScenario callback
 * - Has proper accessibility attributes
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { createElement } from 'react';
import { EmptyState } from './EmptyState';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderEmptyState(
  props?: Partial<{ onConfigureSource: () => void; onInjectScenario: () => void }>,
) {
  const onConfigureSource = props?.onConfigureSource ?? vi.fn();
  const onInjectScenario = props?.onInjectScenario ?? vi.fn();
  return {
    onConfigureSource,
    onInjectScenario,
    ...render(createElement(EmptyState, { onConfigureSource, onInjectScenario })),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EmptyState', () => {
  afterEach(() => {
    cleanup();
  });

  describe('rendering', () => {
    it('renders the empty state container', () => {
      renderEmptyState();
      expect(screen.getByTestId('signal-empty-state')).toBeTruthy();
    });

    it('displays a heading indicating no signals', () => {
      renderEmptyState();
      expect(screen.getByText('No signals detected')).toBeTruthy();
    });

    it('displays descriptive text about next steps', () => {
      renderEmptyState();
      expect(
        screen.getByText(/connect an intelligence source or inject a scenario/i),
      ).toBeTruthy();
    });
  });

  describe('actionable prompts (Req 1.4)', () => {
    it('displays a "Configure Source" button', () => {
      renderEmptyState();
      expect(screen.getByTestId('empty-state-configure-source')).toBeTruthy();
      expect(screen.getByText('Configure Source')).toBeTruthy();
    });

    it('displays an "Inject Scenario" button', () => {
      renderEmptyState();
      expect(screen.getByTestId('empty-state-inject-scenario')).toBeTruthy();
      expect(screen.getByText('Inject Scenario')).toBeTruthy();
    });

    it('has at least two actionable prompts', () => {
      renderEmptyState();
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    it('triggers onConfigureSource when Configure Source is clicked', () => {
      const onConfigureSource = vi.fn();
      renderEmptyState({ onConfigureSource });
      fireEvent.click(screen.getByTestId('empty-state-configure-source'));
      expect(onConfigureSource).toHaveBeenCalledOnce();
    });

    it('triggers onInjectScenario when Inject Scenario is clicked', () => {
      const onInjectScenario = vi.fn();
      renderEmptyState({ onInjectScenario });
      fireEvent.click(screen.getByTestId('empty-state-inject-scenario'));
      expect(onInjectScenario).toHaveBeenCalledOnce();
    });
  });

  describe('accessibility', () => {
    it('has role="status" on the container', () => {
      renderEmptyState();
      const container = screen.getByTestId('signal-empty-state');
      expect(container.getAttribute('role')).toBe('status');
    });

    it('has an aria-label on the container', () => {
      renderEmptyState();
      const container = screen.getByTestId('signal-empty-state');
      expect(container.getAttribute('aria-label')).toBe('No signals available');
    });
  });
});
