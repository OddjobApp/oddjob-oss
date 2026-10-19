/**
 * Property-based test for Entity Detail Panel ordering.
 *
 * **Property 3: Entity detail events are ordered by impactConfidence desc then blastRadius desc**
 *
 * For any array of causal link events associated with an entity node, when displayed
 * in the entity detail panel, consecutive pairs (a, b) SHALL satisfy
 * `a.impactConfidence > b.impactConfidence ||
 *  (a.impactConfidence === b.impactConfidence && a.blastRadius >= b.blastRadius)`.
 *
 * **Validates: Requirements 2.4**
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 *
 * // Feature: spatial-ux-improvements, Property 3: Entity detail events are ordered by impactConfidence desc then blastRadius desc
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sortLinksByImpact } from './EntityDetailPanel';
import type { CausalLinkDto } from './ImpactVisualization';

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

/** Generate an array of 0–30 CausalLinkDto objects */
const causalLinksArrayArb = fc.array(causalLinkArb, { minLength: 0, maxLength: 30 });

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Feature: spatial-ux-improvements, Property 3: Entity detail events are ordered by impactConfidence desc then blastRadius desc', () => {
  /**
   * **Validates: Requirements 2.4**
   *
   * For any array of causal links, the sorted output satisfies the ordering invariant:
   * consecutive pairs (a, b) have a.impactConfidence > b.impactConfidence,
   * or equal confidence with a.blastRadius >= b.blastRadius.
   */
  it('sortLinksByImpact produces descending impactConfidence then descending blastRadius ordering', () => {
    fc.assert(
      fc.property(causalLinksArrayArb, (links) => {
        const sorted = sortLinksByImpact(links);

        // Result length must equal input length (no elements lost or added)
        expect(sorted.length).toBe(links.length);

        // Check ordering invariant for all consecutive pairs
        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i];
          const b = sorted[i + 1];

          const orderingHolds =
            a.impactConfidence > b.impactConfidence ||
            (a.impactConfidence === b.impactConfidence &&
              a.blastRadius >= b.blastRadius);

          expect(orderingHolds).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * The sort function does not mutate the original array.
   */
  it('sortLinksByImpact does not mutate the input array', () => {
    fc.assert(
      fc.property(causalLinksArrayArb, (links) => {
        const originalOrder = links.map((l) => l.id);
        sortLinksByImpact(links);
        const afterOrder = links.map((l) => l.id);

        expect(afterOrder).toEqual(originalOrder);
      }),
      { numRuns: 100 },
    );
  });
});
