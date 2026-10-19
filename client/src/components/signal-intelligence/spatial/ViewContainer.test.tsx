/**
 * Unit tests for ViewContainer component.
 * Requirements: 3.2, 3.3, 3.9
 *
 * Tests:
 * - All panels are mounted simultaneously (DOM preserves inactive panel content)
 * - Inactive panels are hidden via the `hidden` attribute
 * - Active panel is visible (not hidden)
 * - Each panel has correct ARIA attributes (role, id, aria-labelledby)
 * - ErrorBoundary catches render errors and shows fallback message
 * - ErrorBoundary does not affect other panels or the container
 * - View switch renders within 500ms (verified by measuring render time)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { ViewContainer, ViewErrorBoundary } from './ViewContainer';
import type { ViewPanelConfig } from './ViewContainer';
import type { ViewId } from './utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Must match the ViewId union in ./utils. These read 'graph', 'scenarios' and
// 'event-stream' until the dashboard was reorganised around sources, backbone
// and subscriptions. Because view ids only ever appear as string literals and
// testid suffixes, the rename left the suite type-broken rather than failing —
// it went on asserting about panels that no longer existed.
const VIEW_IDS: ViewId[] = ['signals', 'sources', 'backbone', 'subscriptions'];

function makePanels(): ViewPanelConfig[] {
  return VIEW_IDS.map((id) => ({
    id,
    content: createElement('div', { 'data-testid': `content-${id}` }, `Content for ${id}`),
  }));
}

/** A component that throws on render to test ErrorBoundary. */
function ThrowingComponent(): JSX.Element {
  throw new Error('Simulated render failure');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ViewContainer', () => {
  afterEach(() => cleanup());

  describe('simultaneous mounting (state preservation)', () => {
    it('renders all 4 panels in the DOM simultaneously', () => {
      render(createElement(ViewContainer, { activeView: 'signals', panels: makePanels() }));

      for (const id of VIEW_IDS) {
        expect(screen.getByTestId(`view-panel-${id}`)).toBeTruthy();
        expect(screen.getByTestId(`content-${id}`)).toBeTruthy();
      }
    });

    it('preserves content of inactive panels in the DOM', () => {
      render(createElement(ViewContainer, { activeView: 'sources', panels: makePanels() }));

      // All content nodes are still in DOM even though only 'sources' is active
      expect(screen.getByTestId('content-signals').textContent).toBe('Content for signals');
      expect(screen.getByTestId('content-backbone').textContent).toBe('Content for backbone');
      expect(screen.getByTestId('content-subscriptions').textContent).toBe('Content for subscriptions');
    });
  });

  describe('visibility', () => {
    it('active panel is not hidden', () => {
      render(createElement(ViewContainer, { activeView: 'backbone', panels: makePanels() }));
      const activePanel = screen.getByTestId('view-panel-backbone');
      expect(activePanel.hidden).toBe(false);
    });

    it('inactive panels are hidden', () => {
      render(createElement(ViewContainer, { activeView: 'signals', panels: makePanels() }));

      expect(screen.getByTestId('view-panel-sources').hidden).toBe(true);
      expect(screen.getByTestId('view-panel-backbone').hidden).toBe(true);
      expect(screen.getByTestId('view-panel-subscriptions').hidden).toBe(true);
    });

    it('active panel has tabIndex 0, inactive panels have tabIndex -1', () => {
      render(createElement(ViewContainer, { activeView: 'sources', panels: makePanels() }));

      expect(screen.getByTestId('view-panel-sources').tabIndex).toBe(0);
      expect(screen.getByTestId('view-panel-signals').tabIndex).toBe(-1);
      expect(screen.getByTestId('view-panel-backbone').tabIndex).toBe(-1);
      expect(screen.getByTestId('view-panel-subscriptions').tabIndex).toBe(-1);
    });
  });

  describe('ARIA attributes', () => {
    it('each panel has role="tabpanel"', () => {
      render(createElement(ViewContainer, { activeView: 'signals', panels: makePanels() }));

      for (const id of VIEW_IDS) {
        const panel = screen.getByTestId(`view-panel-${id}`);
        expect(panel.getAttribute('role')).toBe('tabpanel');
      }
    });

    it('each panel has id matching panelId(viewId)', () => {
      render(createElement(ViewContainer, { activeView: 'signals', panels: makePanels() }));

      for (const id of VIEW_IDS) {
        const panel = screen.getByTestId(`view-panel-${id}`);
        expect(panel.id).toBe(`tabpanel-${id}`);
      }
    });

    it('each panel has aria-labelledby referencing the corresponding tab', () => {
      render(createElement(ViewContainer, { activeView: 'signals', panels: makePanels() }));

      for (const id of VIEW_IDS) {
        const panel = screen.getByTestId(`view-panel-${id}`);
        expect(panel.getAttribute('aria-labelledby')).toBe(`tab-${id}`);
      }
    });
  });

  describe('ErrorBoundary', () => {
    it('shows fallback message when a view throws during render', () => {
      // Suppress React error boundary console errors in test output
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const panels: ViewPanelConfig[] = [
        { id: 'signals', content: createElement('div', null, 'OK') },
        { id: 'sources', content: createElement(ThrowingComponent) },
        { id: 'backbone', content: createElement('div', null, 'OK') },
        { id: 'subscriptions', content: createElement('div', null, 'OK') },
      ];

      render(createElement(ViewContainer, { activeView: 'sources', panels }));

      // The errored panel should show the fallback message
      const errorEl = screen.getByTestId('view-error-sources');
      expect(errorEl.textContent).toBe('This view could not be loaded');
      expect(errorEl.getAttribute('role')).toBe('alert');

      // Other panels remain unaffected
      expect(screen.getByTestId('view-panel-signals')).toBeTruthy();
      expect(screen.getByTestId('view-panel-backbone')).toBeTruthy();
      expect(screen.getByTestId('view-panel-subscriptions')).toBeTruthy();

      consoleSpy.mockRestore();
    });

    it('does not affect sibling panels when one panel errors', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const panels: ViewPanelConfig[] = [
        { id: 'signals', content: createElement('div', { 'data-testid': 'signals-ok' }, 'Signals OK') },
        { id: 'sources', content: createElement(ThrowingComponent) },
        { id: 'backbone', content: createElement('div', { 'data-testid': 'backbone-ok' }, 'Backbone OK') },
        { id: 'subscriptions', content: createElement('div', { 'data-testid': 'stream-ok' }, 'Stream OK') },
      ];

      render(createElement(ViewContainer, { activeView: 'signals', panels }));

      // Siblings render normally
      expect(screen.getByTestId('signals-ok').textContent).toBe('Signals OK');
      expect(screen.getByTestId('backbone-ok').textContent).toBe('Backbone OK');
      expect(screen.getByTestId('stream-ok').textContent).toBe('Stream OK');

      consoleSpy.mockRestore();
    });
  });

  describe('performance', () => {
    it('renders within 500ms', () => {
      const start = performance.now();
      render(createElement(ViewContainer, { activeView: 'signals', panels: makePanels() }));
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(500);
    });
  });
});
