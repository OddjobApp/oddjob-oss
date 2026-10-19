/**
 * Unit tests for SignalFeedPanel component.
 * Requirements: 4.1, 4.2, 4.3, 4.8, 4.9
 *
 * Tests:
 * - Sort control reorders signals correctly
 * - Filter controls update visible signals
 * - Multi-select toggle and bulk action toolbar visibility
 * - Keyboard navigation (arrow keys, Enter, Escape)
 * - Empty state rendering
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { SignalFeedPanel, type SignalFeedPanelProps } from './SignalFeedPanel';
import type { IntelligenceSignal, FilterState, SortOption } from './utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<IntelligenceSignal> & { id: string }): IntelligenceSignal {
  return {
    title: `Signal ${overrides.id}`,
    subtitle: `Subtitle ${overrides.id}`,
    kind: 'threat',
    score: 50,
    age: '2h',
    impact: 'Medium',
    confidence: '80%',
    event: {
      id: `evt-${overrides.id}`,
      eventType: 'regulatory',
      targetSector: 'finance',
      jurisdiction: 'US',
      severity: 'Medium',
      confidenceScore: 0.8,
      rawText: null,
      extractionTimestamp: new Date().toISOString(),
    },
    ...overrides,
  };
}

function defaultFilter(): FilterState {
  return {
    kind: 'all',
    query: '',
    severities: new Set<string>(),
    minConfidence: 0,
    timeRange: '7d',
  };
}

function renderPanel(props: Partial<SignalFeedPanelProps> = {}) {
  const defaultProps: SignalFeedPanelProps = {
    signals: [],
    selectedId: null,
    multiSelect: new Set<string>(),
    sortBy: 'severity',
    filter: defaultFilter(),
    isLoading: false,
    onSelect: vi.fn(),
    onMultiSelectToggle: vi.fn(),
    onSortChange: vi.fn(),
    onFilterChange: vi.fn(),
    onBulkAction: vi.fn(),
    onBulkSnooze: vi.fn(),
    ...props,
  };
  return { ...render(createElement(SignalFeedPanel, defaultProps)), props: defaultProps };
}

// ─── Test Data ────────────────────────────────────────────────────────────────

const now = Date.now();

const signals: IntelligenceSignal[] = [
  makeSignal({
    id: 'sig-1',
    title: 'Critical Threat Alpha',
    kind: 'threat',
    score: 90,
    event: {
      id: 'evt-1',
      eventType: 'cyber',
      targetSector: 'tech',
      jurisdiction: 'US',
      severity: 'Critical',
      confidenceScore: 0.95,
      rawText: null,
      extractionTimestamp: new Date(now - 60_000).toISOString(), // 1 min ago
    },
  }),
  makeSignal({
    id: 'sig-2',
    title: 'Low Opportunity Beta',
    kind: 'opportunity',
    score: 30,
    event: {
      id: 'evt-2',
      eventType: 'market',
      targetSector: 'finance',
      jurisdiction: 'EU',
      severity: 'Low',
      confidenceScore: 0.5,
      rawText: null,
      extractionTimestamp: new Date(now - 3_600_000).toISOString(), // 1 hour ago
    },
  }),
  makeSignal({
    id: 'sig-3',
    title: 'High Threat Gamma',
    kind: 'threat',
    score: 70,
    event: {
      id: 'evt-3',
      eventType: 'regulatory',
      targetSector: 'healthcare',
      jurisdiction: 'UK',
      severity: 'High',
      confidenceScore: 0.85,
      rawText: null,
      extractionTimestamp: new Date(now - 120_000).toISOString(), // 2 min ago
    },
  }),
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SignalFeedPanel', () => {
  afterEach(() => cleanup());

  describe('sort control (Req 4.1, 4.2)', () => {
    it('renders sort dropdown with all sort options', () => {
      renderPanel({ signals });
      const select = screen.getByLabelText('Sort signals by') as HTMLSelectElement;
      expect(select).toBeTruthy();
      expect(select.querySelectorAll('option').length).toBe(4);
    });

    it('displays the current sort value', () => {
      renderPanel({ signals, sortBy: 'confidence' });
      const select = screen.getByLabelText('Sort signals by') as HTMLSelectElement;
      expect(select.value).toBe('confidence');
    });

    it('calls onSortChange when a new sort option is selected', () => {
      const onSortChange = vi.fn();
      renderPanel({ signals, sortBy: 'severity', onSortChange });
      const select = screen.getByLabelText('Sort signals by');
      fireEvent.change(select, { target: { value: 'recency' } });
      expect(onSortChange).toHaveBeenCalledWith('recency');
    });

    it('reorders signals by severity (descending)', () => {
      renderPanel({ signals, sortBy: 'severity' });
      const listbox = screen.getByRole('listbox');
      const items = listbox.querySelectorAll('[role="option"]');
      // Critical > High > Low
      expect(items[0].textContent).toContain('Critical Threat Alpha');
      expect(items[1].textContent).toContain('High Threat Gamma');
      expect(items[2].textContent).toContain('Low Opportunity Beta');
    });

    it('reorders signals by confidence (descending)', () => {
      renderPanel({ signals, sortBy: 'confidence' });
      const listbox = screen.getByRole('listbox');
      const items = listbox.querySelectorAll('[role="option"]');
      // 0.95 > 0.85 > 0.5
      expect(items[0].textContent).toContain('Critical Threat Alpha');
      expect(items[1].textContent).toContain('High Threat Gamma');
      expect(items[2].textContent).toContain('Low Opportunity Beta');
    });

    it('reorders signals by recency (newest first)', () => {
      renderPanel({ signals, sortBy: 'recency' });
      const listbox = screen.getByRole('listbox');
      const items = listbox.querySelectorAll('[role="option"]');
      // sig-1 (1 min ago) > sig-3 (2 min ago) > sig-2 (1 hour ago)
      expect(items[0].textContent).toContain('Critical Threat Alpha');
      expect(items[1].textContent).toContain('High Threat Gamma');
      expect(items[2].textContent).toContain('Low Opportunity Beta');
    });

    it('reorders signals by blast-radius (descending score)', () => {
      renderPanel({ signals, sortBy: 'blast-radius' });
      const listbox = screen.getByRole('listbox');
      const items = listbox.querySelectorAll('[role="option"]');
      // 90 > 70 > 30
      expect(items[0].textContent).toContain('Critical Threat Alpha');
      expect(items[1].textContent).toContain('High Threat Gamma');
      expect(items[2].textContent).toContain('Low Opportunity Beta');
    });
  });

  describe('filter controls (Req 4.9)', () => {
    it('filters signals by text query', () => {
      renderPanel({
        signals,
        filter: { ...defaultFilter(), query: 'Gamma' },
      });
      const listbox = screen.getByRole('listbox');
      const items = listbox.querySelectorAll('[role="option"]');
      expect(items.length).toBe(1);
      expect(items[0].textContent).toContain('High Threat Gamma');
    });

    it('filters signals by kind (opportunity)', () => {
      renderPanel({
        signals,
        filter: { ...defaultFilter(), kind: 'opportunity' },
      });
      const listbox = screen.getByRole('listbox');
      const items = listbox.querySelectorAll('[role="option"]');
      expect(items.length).toBe(1);
      expect(items[0].textContent).toContain('Low Opportunity Beta');
    });

    it('filters signals by kind (threat)', () => {
      renderPanel({
        signals,
        filter: { ...defaultFilter(), kind: 'threat' },
      });
      const listbox = screen.getByRole('listbox');
      const items = listbox.querySelectorAll('[role="option"]');
      expect(items.length).toBe(2);
    });

    it('filters signals by severity', () => {
      renderPanel({
        signals,
        filter: { ...defaultFilter(), severities: new Set(['Critical']) },
      });
      const listbox = screen.getByRole('listbox');
      const items = listbox.querySelectorAll('[role="option"]');
      expect(items.length).toBe(1);
      expect(items[0].textContent).toContain('Critical Threat Alpha');
    });

    it('filters signals by minConfidence threshold', () => {
      renderPanel({
        signals,
        filter: { ...defaultFilter(), minConfidence: 80 },
      });
      const listbox = screen.getByRole('listbox');
      const items = listbox.querySelectorAll('[role="option"]');
      // 0.95*100=95 >= 80, 0.85*100=85 >= 80, 0.5*100=50 < 80
      expect(items.length).toBe(2);
    });

    it('calls onFilterChange when search input changes', () => {
      const onFilterChange = vi.fn();
      renderPanel({ signals, onFilterChange });
      const input = screen.getByPlaceholderText('Search signals');
      fireEvent.change(input, { target: { value: 'test' } });
      expect(onFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'test' }),
      );
    });

    it('calls onFilterChange when kind tab is clicked', () => {
      const onFilterChange = vi.fn();
      renderPanel({ signals, onFilterChange });
      const threatTab = screen.getByRole('tab', { name: 'threat' });
      fireEvent.click(threatTab);
      expect(onFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'threat' }),
      );
    });

    it('expanded filter panel shows severity and confidence controls', () => {
      renderPanel({ signals });
      // Click the filter toggle button to expand filter panel
      const filterToggle = screen.getByLabelText('Toggle filters');
      fireEvent.click(filterToggle);
      // Severity buttons should appear
      expect(screen.getByText('Critical')).toBeTruthy();
      expect(screen.getByText('High')).toBeTruthy();
      expect(screen.getByText('Medium')).toBeTruthy();
      expect(screen.getByText('Low')).toBeTruthy();
      // Confidence slider should appear
      expect(screen.getByLabelText('Minimum confidence threshold')).toBeTruthy();
    });
  });

  describe('multi-select and bulk action toolbar (Req 4.3)', () => {
    it('does not show bulk toolbar when fewer than 2 signals are selected', () => {
      renderPanel({ signals, multiSelect: new Set(['sig-1']) });
      expect(screen.queryByTestId('bulk-action-toolbar')).toBeNull();
    });

    it('shows bulk toolbar when 2 or more signals are selected', () => {
      renderPanel({ signals, multiSelect: new Set(['sig-1', 'sig-2']) });
      expect(screen.getByTestId('bulk-action-toolbar')).toBeTruthy();
    });

    it('shows correct selected count in bulk toolbar', () => {
      renderPanel({ signals, multiSelect: new Set(['sig-1', 'sig-2', 'sig-3']) });
      expect(screen.getByText('3 selected')).toBeTruthy();
    });

    it('triggers onMultiSelectToggle on ctrl+click', () => {
      const onMultiSelectToggle = vi.fn();
      renderPanel({ signals, onMultiSelectToggle });
      const item = screen.getByTestId('signal-item-sig-1');
      fireEvent.click(item, { ctrlKey: true });
      expect(onMultiSelectToggle).toHaveBeenCalledWith('sig-1');
    });

    it('triggers onSelect on regular click (not ctrl)', () => {
      const onSelect = vi.fn();
      renderPanel({ signals, onSelect });
      const item = screen.getByTestId('signal-item-sig-2');
      fireEvent.click(item);
      expect(onSelect).toHaveBeenCalledWith('sig-2');
    });
  });

  describe('keyboard navigation (Req 4.8)', () => {
    it('moves focus down on ArrowDown', () => {
      renderPanel({ signals, sortBy: 'severity' });
      const listbox = screen.getByRole('listbox');
      // Focus the listbox first
      fireEvent.keyDown(listbox, { key: 'ArrowDown' });
      // First item should be focused (index 0)
      const firstItem = screen.getByTestId('signal-item-sig-1');
      expect(document.activeElement).toBe(firstItem);
    });

    it('moves focus up on ArrowUp (wraps to last)', () => {
      renderPanel({ signals, sortBy: 'severity' });
      const listbox = screen.getByRole('listbox');
      // When focused at -1, ArrowUp should wrap to last item
      fireEvent.keyDown(listbox, { key: 'ArrowUp' });
      // With severity sort: sig-1 (Critical), sig-3 (High), sig-2 (Low) — last is sig-2
      const lastItem = screen.getByTestId('signal-item-sig-2');
      expect(document.activeElement).toBe(lastItem);
    });

    it('calls onSelect on Enter when an item is focused', () => {
      const onSelect = vi.fn();
      renderPanel({ signals, sortBy: 'severity', onSelect });
      const listbox = screen.getByRole('listbox');
      // Navigate to first item
      fireEvent.keyDown(listbox, { key: 'ArrowDown' });
      // Press Enter to select
      fireEvent.keyDown(listbox, { key: 'Enter' });
      // With severity sort, first item is sig-1
      expect(onSelect).toHaveBeenCalledWith('sig-1');
    });

    it('resets focused index on Escape', () => {
      renderPanel({ signals, sortBy: 'severity' });
      const listbox = screen.getByRole('listbox');
      // Navigate to first item
      fireEvent.keyDown(listbox, { key: 'ArrowDown' });
      expect(listbox.getAttribute('aria-activedescendant')).toBe('signal-item-sig-1');
      // Press Escape
      fireEvent.keyDown(listbox, { key: 'Escape' });
      // aria-activedescendant should be cleared (attribute removed means null)
      expect(listbox.getAttribute('aria-activedescendant')).toBeNull();
    });

    it('wraps focus from last to first on ArrowDown', () => {
      renderPanel({ signals, sortBy: 'severity' });
      const listbox = screen.getByRole('listbox');
      // Move to first, second, third (last), then ArrowDown wraps
      fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // index 0
      fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // index 1
      fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // index 2
      fireEvent.keyDown(listbox, { key: 'ArrowDown' }); // wraps to 0
      const firstItem = screen.getByTestId('signal-item-sig-1');
      expect(document.activeElement).toBe(firstItem);
    });
  });

  describe('empty state (Req 4.9)', () => {
    it('shows empty message when no signals match filters', () => {
      renderPanel({
        signals,
        filter: { ...defaultFilter(), query: 'nonexistent-xyz' },
      });
      expect(screen.getByText('No matching signals')).toBeTruthy();
    });

    it('shows empty message when signals array is empty', () => {
      renderPanel({ signals: [] });
      expect(screen.getByText('No signals yet')).toBeTruthy();
    });

    it('shows loading state when isLoading is true', () => {
      renderPanel({ signals: [], isLoading: true });
      expect(screen.getByText('Loading signals…')).toBeTruthy();
    });
  });

  describe('accessibility', () => {
    it('has accessible label on the signal feed panel', () => {
      renderPanel({ signals });
      expect(screen.getByLabelText('Signal Feed')).toBeTruthy();
    });

    it('listbox has correct aria-label', () => {
      renderPanel({ signals });
      const listbox = screen.getByRole('listbox');
      expect(listbox.getAttribute('aria-label')).toBe('Intelligence signals');
    });

    it('selected signal has aria-selected=true', () => {
      renderPanel({ signals, selectedId: 'sig-2' });
      const item = screen.getByTestId('signal-item-sig-2');
      expect(item.getAttribute('aria-selected')).toBe('true');
    });

    it('non-selected signal has aria-selected=false', () => {
      renderPanel({ signals, selectedId: 'sig-1' });
      const item = screen.getByTestId('signal-item-sig-2');
      expect(item.getAttribute('aria-selected')).toBe('false');
    });
  });
});
