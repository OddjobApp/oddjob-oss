/**
 * Property-based tests for the shared event stream's reconnect backoff (it
 * reconnects the decision stream, among others).
 *
 * Feature: decision-inbox-surface
 *
 * Tests validate:
 * - Property 3: Exponential Backoff Calculation — For any N consecutive failures
 *   (N ≥ 1), verify delay = min(2^(N-1) × 1000, 30000) ms
 *
 * Uses fast-check for property-based testing with minimum 100 iterations.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { calculateBackoff } from "../shared-event-source.js";

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Attempt number N ≥ 1 (consecutive failures) */
const attemptNumberArb = fc.integer({ min: 1, max: 1000 });

/** Max backoff cap in milliseconds (positive integer) */
const maxMsArb = fc.integer({ min: 1000, max: 120000 });

/** Pair of attempt numbers where a < b (for monotonicity checks) */
const orderedAttemptsArb = fc
  .tuple(attemptNumberArb, attemptNumberArb)
  .filter(([a, b]) => a < b);

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("Shared stream reconnect backoff property tests", () => {
  /**
   * Feature: decision-inbox-surface, Property 3: Exponential Backoff Calculation
   *
   * For any sequence of N consecutive SSE reconnection failures (N ≥ 1),
   * the delay before the Nth retry SHALL equal min(2^(N-1) × 1000, 30000)
   * milliseconds.
   *
   * **Validates: Requirements 2.6**
   */
  describe("Property 3: Exponential Backoff Calculation", () => {
    it("delay equals min(2^(N-1) * 1000, 30000) for any attempt number N ≥ 1", () => {
      fc.assert(
        fc.property(attemptNumberArb, (N) => {
          const result = calculateBackoff(N);
          const expected = Math.min(Math.pow(2, N - 1) * 1000, 30000);
          expect(result).toBe(expected);
        }),
        { numRuns: 100 }
      );
    });

    it("delay equals min(2^(N-1) * 1000, maxMs) for any custom cap", () => {
      fc.assert(
        fc.property(attemptNumberArb, maxMsArb, (N, maxMs) => {
          const result = calculateBackoff(N, maxMs);
          const expected = Math.min(Math.pow(2, N - 1) * 1000, maxMs);
          expect(result).toBe(expected);
        }),
        { numRuns: 100 }
      );
    });

    it("result is always >= 1000 (minimum backoff at N=1)", () => {
      fc.assert(
        fc.property(attemptNumberArb, (N) => {
          const result = calculateBackoff(N);
          expect(result).toBeGreaterThanOrEqual(1000);
        }),
        { numRuns: 100 }
      );
    });

    it("result is always <= 30000 (default cap)", () => {
      fc.assert(
        fc.property(attemptNumberArb, (N) => {
          const result = calculateBackoff(N);
          expect(result).toBeLessThanOrEqual(30000);
        }),
        { numRuns: 100 }
      );
    });

    it("result is monotonically non-decreasing as N increases", () => {
      fc.assert(
        fc.property(orderedAttemptsArb, ([a, b]) => {
          const resultA = calculateBackoff(a);
          const resultB = calculateBackoff(b);
          expect(resultB).toBeGreaterThanOrEqual(resultA);
        }),
        { numRuns: 100 }
      );
    });

    it("result respects custom maxMs cap — always <= maxMs", () => {
      fc.assert(
        fc.property(attemptNumberArb, maxMsArb, (N, maxMs) => {
          const result = calculateBackoff(N, maxMs);
          expect(result).toBeLessThanOrEqual(maxMs);
        }),
        { numRuns: 100 }
      );
    });
  });
});
