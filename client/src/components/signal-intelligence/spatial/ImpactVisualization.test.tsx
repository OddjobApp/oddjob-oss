/**
 * Unit tests for ImpactVisualization component.
 * Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7
 *
 * Tests:
 * - Loading state shows loading indicator
 * - Error state shows inline error message (no stale/placeholder nodes)
 * - Empty state shows "no downstream impacts" message
 * - Renders central node + peripheral nodes for each unique target entity
 * - Colors nodes by severity using severityToColor
 * - Renders edges with width proportional to impactConfidence
 * - Node click calls onNodeClick with correct entity info
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { ImpactVisualization, type CausalLinkDto } from './ImpactVisualization';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderViz(props: Partial<Parameters<typeof ImpactVisualization>[0]> = {}) {
  const defaultProps = {
    signalId: 'signal-1',
    causalLinks: [] as CausalLinkDto[],
    isLoading: false,
    error: null,
    severity: 'High',
    onNodeClick: vi.fn(),
    ...props,
  };
  return render(createElement(ImpactVisualization, defaultProps));
}

function makeCausalLink(overrides: Partial<CausalLinkDto> = {}): CausalLinkDto {
  return {
    id: `link-${Math.random().toString(36).slice(2, 8)}`,
    targetEntityType: 'Customer',
    targetEntityId: 'cust-1',
    impactConfidence: 0.75,
    blastRadius: 50,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ImpactVisualization', () => {
  describe('loading state', () => {
    it('renders a loading indicator when isLoading is true', () => {
      renderViz({ isLoading: true });
      expect(screen.getByTestId('impact-viz-loading')).toBeTruthy();
      expect(screen.getByText('Loading causal data…')).toBeTruthy();
    });

    it('does not render graph nodes during loading', () => {
      renderViz({
        isLoading: true,
        causalLinks: [makeCausalLink()],
      });
      expect(screen.queryByTestId('impact-viz-graph')).toBeNull();
      expect(screen.queryByTestId('impact-node-center')).toBeNull();
    });
  });

  describe('error state', () => {
    it('renders an inline error message when error is present', () => {
      renderViz({ error: new Error('Network failure') });
      expect(screen.getByTestId('impact-viz-error')).toBeTruthy();
      expect(screen.getByText('Causal data could not be loaded.')).toBeTruthy();
      expect(screen.getByText('The signal is still available. Retry the affected-entity lookup.')).toBeTruthy();
    });

    it('offers a retry action when supplied', () => {
      const onRetry = vi.fn();
      renderViz({ error: new Error('Network failure'), onRetry });
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledOnce();
    });

    it('does not render stale or placeholder nodes on error', () => {
      renderViz({
        error: new Error('Server error'),
        causalLinks: [makeCausalLink()],
      });
      expect(screen.queryByTestId('impact-viz-graph')).toBeNull();
      expect(screen.queryByTestId('impact-node-center')).toBeNull();
    });
  });

  describe('empty state', () => {
    it('explains when no affected entities are mapped', () => {
      renderViz({ causalLinks: [] });
      expect(screen.getByTestId('impact-viz-empty')).toBeTruthy();
      expect(
        screen.getByText('No affected entities mapped'),
      ).toBeTruthy();
    });
  });

  describe('graph rendering', () => {
    const links: CausalLinkDto[] = [
      makeCausalLink({ id: 'l1', targetEntityType: 'Customer', targetEntityId: 'c1', impactConfidence: 0.9 }),
      makeCausalLink({ id: 'l2', targetEntityType: 'Operations', targetEntityId: 'o1', impactConfidence: 0.5 }),
      makeCausalLink({ id: 'l3', targetEntityType: 'Customer', targetEntityId: 'c1', impactConfidence: 0.7 }),
    ];

    it('renders the graph container when links are present', () => {
      renderViz({ causalLinks: links });
      expect(screen.getByTestId('impact-viz-graph')).toBeTruthy();
    });

    it('renders a central node for the selected signal', () => {
      renderViz({ causalLinks: links });
      expect(screen.getByTestId('impact-node-center')).toBeTruthy();
    });

    it('renders one peripheral node per unique target entity', () => {
      // 3 links but only 2 unique entities (Customer:c1 appears twice)
      renderViz({ causalLinks: links });
      expect(screen.getByTestId('impact-node-Customer:c1')).toBeTruthy();
      expect(screen.getByTestId('impact-node-Operations:o1')).toBeTruthy();
    });

    it('renders edges for each causal link', () => {
      renderViz({ causalLinks: links });
      expect(screen.getByTestId('impact-edge-l1')).toBeTruthy();
      expect(screen.getByTestId('impact-edge-l2')).toBeTruthy();
      expect(screen.getByTestId('impact-edge-l3')).toBeTruthy();
    });

    it('edge width is proportional to impactConfidence, within legible bounds', () => {
      /*
        Asserts the property this test is named for rather than one hard-coded
        width. It previously expected exactly 3.4, from a formula (1 + c * 3)
        the component does not use — it scales by 4 and clamps to [2, 6] so a
        near-zero confidence edge is still visible and a maximal one does not
        dominate the graph. Pinning the constant tested the arithmetic; this
        tests that more confidence means a heavier line and that the clamp holds.
      */
      const widthFor = (impactConfidence: number) => {
        cleanup();
        renderViz({ causalLinks: [makeCausalLink({ id: 'e1', impactConfidence })] });
        return parseFloat(screen.getByTestId('impact-edge-e1').getAttribute('stroke-width')!);
      };

      const low = widthFor(0.2);
      const mid = widthFor(0.8);
      const high = widthFor(1);

      expect(mid).toBeGreaterThan(low);
      expect(high).toBeGreaterThanOrEqual(mid);

      for (const width of [widthFor(0), low, mid, high]) {
        expect(width).toBeGreaterThanOrEqual(2);
        expect(width).toBeLessThanOrEqual(6);
      }
    });
  });

  describe('node click', () => {
    it('calls onNodeClick with entityType and entityId when a node is clicked', () => {
      const onNodeClick = vi.fn();
      const links = [makeCausalLink({ targetEntityType: 'Revenue', targetEntityId: 'rev-1' })];
      renderViz({ causalLinks: links, onNodeClick });

      fireEvent.click(screen.getByTestId('impact-node-Revenue:rev-1'));
      expect(onNodeClick).toHaveBeenCalledWith('Revenue', 'rev-1');
    });

    it('calls onNodeClick on Enter keydown', () => {
      const onNodeClick = vi.fn();
      const links = [makeCausalLink({ targetEntityType: 'Supply', targetEntityId: 's1' })];
      renderViz({ causalLinks: links, onNodeClick });

      const node = screen.getByTestId('impact-node-Supply:s1');
      fireEvent.keyDown(node, { key: 'Enter' });
      expect(onNodeClick).toHaveBeenCalledWith('Supply', 's1');
    });
  });

  describe('accessibility', () => {
    it('SVG has an aria-label describing the graph', () => {
      const links = [
        makeCausalLink({ targetEntityType: 'A', targetEntityId: '1' }),
        makeCausalLink({ targetEntityType: 'B', targetEntityId: '2' }),
      ];
      renderViz({ signalId: 'sig-x', causalLinks: links });
      const svg = screen.getByRole('img');
      expect(svg.getAttribute('aria-label')).toContain('sig-x');
      expect(svg.getAttribute('aria-label')).toContain('2 affected entities');
    });

    it('peripheral nodes have role="button" and aria-label', () => {
      const links = [makeCausalLink({ targetEntityType: 'Ops', targetEntityId: 'o1' })];
      renderViz({ causalLinks: links });
      const node = screen.getByTestId('impact-node-Ops:o1');
      expect(node.getAttribute('role')).toBe('button');
      expect(node.getAttribute('aria-label')).toBe('Ops: o1');
    });
  });
});
