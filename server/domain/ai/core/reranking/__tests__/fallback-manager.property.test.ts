/**
 * Property-based tests for FallbackManager
 *
 * Feature: reranking-service
 *
 * **Property 7: Fallback follows priority order on backend failure**
 * For any backend in the priority chain that fails, the service SHALL attempt
 * the next backend in the configured priority order. Walking the chain from
 * any starting point always visits subsequent entries in order.
 *
 * **Property 8: Backend selection respects preferred parameter**
 * For any rerank request specifying a preferred backend, selectBackend returns
 * that backend.
 *
 * **Validates: Requirements 2.2, 2.3, 2.4**
 *
 * Uses fast-check for property-based testing with a minimum of 100 iterations.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FallbackManager } from "../fallback-manager.js";
import type { RerankBackendType } from "../types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_BACKENDS: RerankBackendType[] = ["cohere", "local", "llm"];

// ─── Generators ───────────────────────────────────────────────────────────────

/**
 * Generate a non-empty shuffled subset of backend types.
 * This produces arbitrary priority orderings of 1-3 backends.
 */
const priorityOrderArb = fc
  .shuffledSubarray(ALL_BACKENDS, { minLength: 1 })
  .map((arr) => arr as RerankBackendType[]);

/**
 * Generate a single arbitrary backend type.
 */
const backendTypeArb = fc.constantFrom<RerankBackendType>("cohere", "local", "llm");

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("Feature: reranking-service, Property 7: Fallback follows priority order on backend failure", () => {
  /**
   * **Validates: Requirements 2.4**
   *
   * Walking the fallback chain from any starting backend in the priority order
   * always visits subsequent entries in the configured order.
   */
  it("nextBackend walks the priority chain in configured order from any starting point", () => {
    fc.assert(
      fc.property(priorityOrderArb, (priorityOrder) => {
        const manager = new FallbackManager(priorityOrder);

        // For each backend in the priority order, walking forward should
        // produce the remaining backends in exact priority order
        for (let startIdx = 0; startIdx < priorityOrder.length; startIdx++) {
          const visited: RerankBackendType[] = [];
          let current: RerankBackendType | null = priorityOrder[startIdx];

          while (current !== null) {
            const next = manager.nextBackend(current);
            if (next !== null) {
              visited.push(next);
            }
            current = next;
          }

          // The visited backends should be the remaining items after startIdx
          const expected = priorityOrder.slice(startIdx + 1);
          expect(visited).toEqual(expected);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * The last backend in any priority chain always returns null from nextBackend,
   * indicating the chain is exhausted.
   */
  it("last backend in any priority order returns null (chain exhausted)", () => {
    fc.assert(
      fc.property(priorityOrderArb, (priorityOrder) => {
        const manager = new FallbackManager(priorityOrder);
        const lastBackend = priorityOrder[priorityOrder.length - 1];
        expect(manager.nextBackend(lastBackend)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * Walking the full chain from selectBackend() (no preferred) visits every
   * backend in the priority order exactly once.
   */
  it("full chain walk from default selection visits all backends in priority order", () => {
    fc.assert(
      fc.property(priorityOrderArb, (priorityOrder) => {
        const manager = new FallbackManager(priorityOrder);
        const visited: RerankBackendType[] = [];

        let current: RerankBackendType | null = manager.selectBackend();
        visited.push(current);

        while (current !== null) {
          current = manager.nextBackend(current);
          if (current !== null) {
            visited.push(current);
          }
        }

        expect(visited).toEqual(priorityOrder);
      }),
      { numRuns: 100 }
    );
  });
});

describe("Feature: reranking-service, Property 8: Backend selection respects preferred parameter", () => {
  /**
   * **Validates: Requirements 2.2**
   *
   * For any rerank request specifying a preferred backend,
   * selectBackend returns exactly that backend regardless of priority order.
   */
  it("selectBackend always returns the preferred backend when specified", () => {
    fc.assert(
      fc.property(
        priorityOrderArb,
        backendTypeArb,
        (priorityOrder, preferred) => {
          const manager = new FallbackManager(priorityOrder);
          const selected = manager.selectBackend(preferred);
          expect(selected).toBe(preferred);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * When no preferred backend is specified, selectBackend returns the first
   * backend in the priority order (system default).
   */
  it("selectBackend returns first in priority order when no preferred is given", () => {
    fc.assert(
      fc.property(priorityOrderArb, (priorityOrder) => {
        const manager = new FallbackManager(priorityOrder);
        const selected = manager.selectBackend();
        expect(selected).toBe(priorityOrder[0]);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.2**
   *
   * The preferred parameter is respected even when the preferred backend
   * is not in the priority order (it is still returned directly).
   */
  it("selectBackend returns preferred even when not in priority order", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(ALL_BACKENDS, { minLength: 1, maxLength: 2 }),
        backendTypeArb,
        (subset, preferred) => {
          // Filter out the preferred to ensure it's NOT in the priority order
          const priorityOrder = subset.filter(
            (b) => b !== preferred
          ) as RerankBackendType[];
          // Skip if filtering leaves empty array
          fc.pre(priorityOrder.length > 0);

          const manager = new FallbackManager(priorityOrder);
          const selected = manager.selectBackend(preferred);
          expect(selected).toBe(preferred);
        }
      ),
      { numRuns: 100 }
    );
  });
});
