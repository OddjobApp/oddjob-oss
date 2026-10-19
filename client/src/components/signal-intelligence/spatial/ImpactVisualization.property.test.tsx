/**
 * Property-based test for ImpactVisualization node count.
 *
 * **Property 1: Impact visualization node count matches causal links**
 *
 * For any array of causal links returned from the API (including empty arrays),
 * the ImpactVisualization SHALL render exactly
 * `1 + countUnique(links.map(l => l.targetEntityType + ':' + l.targetEntityId))` nodes
 * and exactly `links.length` edges.
 *
 * **Validates: Requirements 2.1**
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 *
 * // Feature: spatial-ux-improvements, Property 1: Impact visualization node count matches causal links
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { ImpactVisualization, type CausalLinkDto } from './ImpactVisualization';

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Generate a non-empty alphanumeric string for entity type/id fields */
const entityStringArb = fc.stringOf(
  fc.oneof(
    fc.char().filter((c) => /[a-zA-Z0-9]/.test(c)),
    fc.constant('-'),
    fc.constant('_'),
  ),
  { minLength: 1, maxLength: 15 },
);

/** Generate a single CausalLinkDto with random but valid values */
const causalLinkArb: fc.Arbitrary<CausalLinkDto> = fc.record({
  id: fc.uuid(),
  targetEntityType: entityStringArb,
  targetEntityId: entityStringArb,
  impactConfidence: fc.double({ min: 0, max: 1, noNaN: true }),
  blastRadius: fc.integer({ min: 0, max: 100 }),
});

/** Generate an array of 0–50 CausalLinkDto objects */
const causalLinksArrayArb = fc.array(causalLinkArb, { minLength: 0, maxLength: 50 });

// ─── Helpers ────────────────────────────────────────────────────────────────

function countUniqueEntities(links: CausalLinkDto[]): number {
  const keys = new Set(links.map((l) => `${l.targetEntityType}:${l.targetEntityId}`));
  return keys.size;
}

function renderViz(causalLinks: CausalLinkDto[]) {
  return render(
    createElement(ImpactVisualization, {
      signalId: 'test-signal',
      causalLinks,
      isLoading: false,
      error: null,
      severity: 'Medium',
      onNodeClick: vi.fn(),
    }),
  );
}

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Feature: spatial-ux-improvements, Property 1: Impact visualization node count matches causal links', () => {
  /**
   * **Validates: Requirements 2.1**
   *
   * For any array of causal links (including empty), the number of rendered nodes
   * equals 1 (center) + count of unique target entities, and edges equals links.length.
   *
   * Note: When causalLinks is empty, the component renders an empty state message
   * instead of the graph, so we verify separately that:
   * - Empty arrays show the empty state (0 nodes, 0 edges)
   * - Non-empty arrays show correct node/edge counts
   */
  it('renders correct node and edge counts for non-empty causal link arrays', () => {
    fc.assert(
      fc.property(
        fc.array(causalLinkArb, { minLength: 1, maxLength: 50 }),
        (causalLinks) => {
          const { container, unmount } = renderViz(causalLinks);

          const expectedUniqueNodes = countUniqueEntities(causalLinks);
          const expectedTotalNodes = 1 + expectedUniqueNodes; // 1 center + peripherals
          const expectedEdges = causalLinks.length;

          // Count center node
          const centerNode = container.querySelector('[data-testid="impact-node-center"]');
          expect(centerNode).not.toBeNull();

          // Count peripheral nodes (data-testid starting with "impact-node-" but not "impact-node-center")
          const allNodeElements = container.querySelectorAll('[data-testid^="impact-node-"]');
          const peripheralNodes = Array.from(allNodeElements).filter(
            (el) => el.getAttribute('data-testid') !== 'impact-node-center',
          );

          expect(peripheralNodes.length + 1).toBe(expectedTotalNodes);

          // Count edges
          const edgeElements = container.querySelectorAll('[data-testid^="impact-edge-"]');
          expect(edgeElements.length).toBe(expectedEdges);

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('renders empty state with no nodes or edges for empty causal link arrays', () => {
    fc.assert(
      fc.property(fc.constant([] as CausalLinkDto[]), (causalLinks) => {
        const { container, unmount } = renderViz(causalLinks);

        // Empty state: no graph rendered
        const graphContainer = container.querySelector('[data-testid="impact-viz-graph"]');
        expect(graphContainer).toBeNull();

        // Empty state message is shown
        const emptyState = container.querySelector('[data-testid="impact-viz-empty"]');
        expect(emptyState).not.toBeNull();

        // No nodes or edges
        const nodeElements = container.querySelectorAll('[data-testid^="impact-node-"]');
        const edgeElements = container.querySelectorAll('[data-testid^="impact-edge-"]');
        expect(nodeElements.length).toBe(0);
        expect(edgeElements.length).toBe(0);

        unmount();
      }),
      { numRuns: 1 },
    );
  });
});
