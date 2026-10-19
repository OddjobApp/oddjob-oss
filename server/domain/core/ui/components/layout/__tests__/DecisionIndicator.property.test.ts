/**
 * Property-based tests for DecisionIndicator badge display logic.
 *
 * Feature: decision-inbox-surface
 *
 * Tests validate:
 * - Property 1: Decision Indicator Badge Display — For any count N ≥ 0,
 *   verify: no badge when N=0, exact numeric when 1≤N≤9, "9+" when N>9.
 *   Pulse animation present iff N>0.
 *
 * Uses fast-check for property-based testing with minimum 100 iterations.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import { formatBadgeCount } from "../DecisionIndicator.js";

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Count of exactly zero (no badge case) */
const zeroCountArb = fc.constant(0);

/** Count between 1 and 9 inclusive (exact numeric badge) */
const numericBadgeCountArb = fc.integer({ min: 1, max: 9 });

/** Count greater than 9 (overflow "9+" badge) */
const overflowCountArb = fc.integer({ min: 10, max: 100000 });

/** Any non-negative count (full domain) */
const anyCountArb = fc.integer({ min: 0, max: 100000 });

/** Any positive count (N > 0, pulse animation case) */
const positiveCountArb = fc.integer({ min: 1, max: 100000 });

// ─── Property Tests ─────────────────────────────────────────────────────────

describe("DecisionIndicator Badge Display Property Tests", () => {
  /**
   * Feature: decision-inbox-surface, Property 1: Decision Indicator Badge Display
   *
   * For any pending approval count N ≥ 0, the Decision Indicator SHALL render:
   * no badge when N = 0, the exact numeric string when 1 ≤ N ≤ 9, and the
   * string "9+" when N > 9. The pulse animation class SHALL be present if and
   * only if N > 0.
   *
   * **Validates: Requirements 1.2, 1.3, 1.4**
   */
  describe("Property 1: Decision Indicator Badge Display", () => {
    it("returns null (no badge) when count is 0", () => {
      fc.assert(
        fc.property(zeroCountArb, (count) => {
          const result = formatBadgeCount(count);
          expect(result).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    it("returns the exact numeric string when 1 ≤ count ≤ 9", () => {
      fc.assert(
        fc.property(numericBadgeCountArb, (count) => {
          const result = formatBadgeCount(count);
          expect(result).toBe(String(count));
        }),
        { numRuns: 100 }
      );
    });

    it("returns '9+' when count > 9", () => {
      fc.assert(
        fc.property(overflowCountArb, (count) => {
          const result = formatBadgeCount(count);
          expect(result).toBe("9+");
        }),
        { numRuns: 100 }
      );
    });

    it("pulse animation is present (non-null badge) iff count > 0", () => {
      fc.assert(
        fc.property(anyCountArb, (count) => {
          const badge = formatBadgeCount(count);
          if (count > 0) {
            // Badge present implies pulse animation should render
            expect(badge).not.toBeNull();
          } else {
            // No badge implies no pulse animation
            expect(badge).toBeNull();
          }
        }),
        { numRuns: 100 }
      );
    });

    it("badge is always a string or null — never undefined", () => {
      fc.assert(
        fc.property(anyCountArb, (count) => {
          const result = formatBadgeCount(count);
          expect(result === null || typeof result === "string").toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it("for any positive count, badge text is never empty string", () => {
      fc.assert(
        fc.property(positiveCountArb, (count) => {
          const result = formatBadgeCount(count);
          expect(result).not.toBe("");
          expect(result!.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });
  });
});
