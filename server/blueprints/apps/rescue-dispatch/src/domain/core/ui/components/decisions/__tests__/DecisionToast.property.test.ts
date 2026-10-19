/**
 * Property-based tests for Decision Toast logic.
 *
 * Feature: decision-inbox-surface
 *
 * Tests validate:
 * - Property 5: Toast Description Truncation — For any string D, verify
 *   displayed text = D if len≤80, else D.slice(0,80)+"…"
 * - Property 6: Toast Hover Pause/Resume Timer — For any hover at elapsed T
 *   (0<T<8000), verify toast dismisses at exactly (8000-T) ms after pointer leave
 * - Property 7: Toast Stacking Logic — For any burst of N events within 2s,
 *   verify min(N,3) individual toasts + 1 summary if N>3
 *
 * Uses fast-check for property-based testing with minimum 100 iterations.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  truncateDescription,
  calculateRemainingDismissTime,
  computeToastStack,
  type DecisionToast,
} from "../DecisionToastManager.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Creates a minimal DecisionToast for stacking tests */
function makeToast(id: string): DecisionToast {
  return {
    id,
    requestId: Math.floor(Math.random() * 10000),
    toolName: "shell",
    riskLevel: "medium",
    description: "Test decision",
    arrivedAt: Date.now(),
    isHovered: false,
    remainingMs: 8000,
  };
}

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Arbitrary for strings that are at or below the 80-char limit */
const shortStringArb = fc.string({ minLength: 0, maxLength: 80 });

/** Arbitrary for strings that exceed the 80-char limit */
const longStringArb = fc.string({ minLength: 81, maxLength: 500 });

/** Arbitrary for any string (full domain) */
const anyStringArb = fc.string({ minLength: 0, maxLength: 1000 });

/** Arbitrary for elapsed time within valid toast lifetime (0 < T < 8000) */
const elapsedTimeArb = fc.integer({ min: 1, max: 7999 });

/** Arbitrary for elapsed time at or beyond total (edge: dismiss immediately) */
const expiredTimeArb = fc.integer({ min: 8000, max: 20000 });

/** Arbitrary for any non-negative elapsed time */
const anyElapsedArb = fc.integer({ min: 0, max: 30000 });

/** Arbitrary for total dismiss duration (positive) */
const totalMsArb = fc.integer({ min: 1, max: 30000 });

/** Arbitrary for burst size of events (1 to 20) */
const burstSizeArb = fc.integer({ min: 1, max: 20 });

/** Arbitrary for burst size > 3 (triggers summary toast) */
const overflowBurstArb = fc.integer({ min: 4, max: 50 });

/** Arbitrary for burst size ≤ 3 (no summary toast) */
const smallBurstArb = fc.integer({ min: 1, max: 3 });

// ─── Property 5: Toast Description Truncation ───────────────────────────────

describe("Feature: decision-inbox-surface, Property 5: Toast Description Truncation", () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * For any description string D, the displayed toast text SHALL equal D if
   * length(D) ≤ 80, or D.slice(0, 80) + "…" if length(D) > 80.
   */

  it("returns the original string unchanged when length ≤ 80", () => {
    fc.assert(
      fc.property(shortStringArb, (text) => {
        const result = truncateDescription(text);
        expect(result).toBe(text);
      }),
      { numRuns: 100 }
    );
  });

  it("truncates and appends ellipsis when length > 80", () => {
    fc.assert(
      fc.property(longStringArb, (text) => {
        const result = truncateDescription(text);
        expect(result).toBe(text.slice(0, 80) + "…");
      }),
      { numRuns: 100 }
    );
  });

  it("for any string, result length ≤ 81 (80 chars + potential single ellipsis character)", () => {
    fc.assert(
      fc.property(anyStringArb, (text) => {
        const result = truncateDescription(text);
        // If truncated: 80 chars + 1 "…" = 81
        // If not truncated: ≤ 80
        expect(result.length).toBeLessThanOrEqual(81);
      }),
      { numRuns: 100 }
    );
  });

  it("the result always starts with the original text prefix", () => {
    fc.assert(
      fc.property(anyStringArb, (text) => {
        const result = truncateDescription(text);
        const prefix = text.length <= 80 ? text : text.slice(0, 80);
        expect(result.startsWith(prefix)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("ends with ellipsis character if and only if original exceeds 80 chars", () => {
    fc.assert(
      fc.property(anyStringArb, (text) => {
        const result = truncateDescription(text);
        if (text.length > 80) {
          expect(result.endsWith("…")).toBe(true);
        } else {
          // Original text ≤80 returned as-is; only ends with "…" if original itself does
          expect(result).toBe(text);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("respects a custom maxLen parameter", () => {
    const customMaxLenArb = fc.integer({ min: 1, max: 200 });
    fc.assert(
      fc.property(anyStringArb, customMaxLenArb, (text, maxLen) => {
        const result = truncateDescription(text, maxLen);
        if (text.length <= maxLen) {
          expect(result).toBe(text);
        } else {
          expect(result).toBe(text.slice(0, maxLen) + "…");
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 6: Toast Hover Pause/Resume Timer ─────────────────────────────

describe("Feature: decision-inbox-surface, Property 6: Toast Hover Pause/Resume Timer", () => {
  /**
   * **Validates: Requirements 3.4**
   *
   * For any toast with auto-dismiss duration of 8000ms, if the user hovers
   * after T milliseconds have elapsed (0 < T < 8000), the toast SHALL remain
   * visible during hover and dismiss exactly (8000 - T) milliseconds after
   * the pointer leaves.
   */

  it("remaining time equals (totalMs - elapsed) for any valid elapsed T within lifetime", () => {
    fc.assert(
      fc.property(elapsedTimeArb, (elapsed) => {
        const remaining = calculateRemainingDismissTime(elapsed, 8000);
        expect(remaining).toBe(8000 - elapsed);
      }),
      { numRuns: 100 }
    );
  });

  it("remaining time is 0 when elapsed equals or exceeds total", () => {
    fc.assert(
      fc.property(expiredTimeArb, (elapsed) => {
        const remaining = calculateRemainingDismissTime(elapsed, 8000);
        expect(remaining).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it("remaining time is never negative for any non-negative elapsed", () => {
    fc.assert(
      fc.property(anyElapsedArb, (elapsed) => {
        const remaining = calculateRemainingDismissTime(elapsed, 8000);
        expect(remaining).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });

  it("remaining time equals total when elapsed is 0 (no time passed)", () => {
    fc.assert(
      fc.property(totalMsArb, (totalMs) => {
        const remaining = calculateRemainingDismissTime(0, totalMs);
        expect(remaining).toBe(totalMs);
      }),
      { numRuns: 100 }
    );
  });

  it("remaining time decreases monotonically as elapsed increases", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 7998 }),
        fc.integer({ min: 1, max: 7999 }),
        (elapsed1, delta) => {
          const elapsed2 = elapsed1 + delta;
          const r1 = calculateRemainingDismissTime(elapsed1, 8000);
          const r2 = calculateRemainingDismissTime(elapsed2, 8000);
          expect(r1).toBeGreaterThanOrEqual(r2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("works correctly with custom totalMs values", () => {
    fc.assert(
      fc.property(totalMsArb, fc.integer({ min: 0, max: 30000 }), (totalMs, elapsed) => {
        const remaining = calculateRemainingDismissTime(elapsed, totalMs);
        const expected = Math.max(0, totalMs - elapsed);
        expect(remaining).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 7: Toast Stacking Logic ───────────────────────────────────────

describe("Feature: decision-inbox-surface, Property 7: Toast Stacking Logic", () => {
  /**
   * **Validates: Requirements 3.6**
   *
   * For any burst of N decision:new events arriving within 2 seconds (N ≥ 1),
   * the toast manager SHALL display min(N, 3) individual toasts and, if N > 3,
   * one summary toast indicating (N - 3) additional pending arrivals.
   */

  it("displays all toasts when N ≤ 3 (no summary)", () => {
    fc.assert(
      fc.property(smallBurstArb, (n) => {
        const toasts = Array.from({ length: n }, (_, i) => makeToast(`toast-${i}`));
        const { visible, summaryCount } = computeToastStack(toasts);
        expect(visible.length).toBe(n);
        expect(summaryCount).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it("limits visible toasts to 3 and provides summary count when N > 3", () => {
    fc.assert(
      fc.property(overflowBurstArb, (n) => {
        const toasts = Array.from({ length: n }, (_, i) => makeToast(`toast-${i}`));
        const { visible, summaryCount } = computeToastStack(toasts);
        expect(visible.length).toBe(3);
        expect(summaryCount).toBe(n - 3);
      }),
      { numRuns: 100 }
    );
  });

  it("visible count = min(N, 3) for any N ≥ 1", () => {
    fc.assert(
      fc.property(burstSizeArb, (n) => {
        const toasts = Array.from({ length: n }, (_, i) => makeToast(`toast-${i}`));
        const { visible } = computeToastStack(toasts);
        expect(visible.length).toBe(Math.min(n, 3));
      }),
      { numRuns: 100 }
    );
  });

  it("summaryCount = max(0, N - 3) for any N ≥ 0", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (n) => {
        const toasts = Array.from({ length: n }, (_, i) => makeToast(`toast-${i}`));
        const { summaryCount } = computeToastStack(toasts);
        expect(summaryCount).toBe(Math.max(0, n - 3));
      }),
      { numRuns: 100 }
    );
  });

  it("visible + summaryCount always equals total toast count", () => {
    fc.assert(
      fc.property(burstSizeArb, (n) => {
        const toasts = Array.from({ length: n }, (_, i) => makeToast(`toast-${i}`));
        const { visible, summaryCount } = computeToastStack(toasts);
        expect(visible.length + summaryCount).toBe(n);
      }),
      { numRuns: 100 }
    );
  });

  it("visible toasts are the first N items from the original array (order preserved)", () => {
    fc.assert(
      fc.property(burstSizeArb, (n) => {
        const toasts = Array.from({ length: n }, (_, i) => makeToast(`toast-${i}`));
        const { visible } = computeToastStack(toasts);
        for (let i = 0; i < visible.length; i++) {
          expect(visible[i].id).toBe(`toast-${i}`);
        }
      }),
      { numRuns: 100 }
    );
  });

  it("respects a custom maxVisible parameter", () => {
    const maxVisibleArb = fc.integer({ min: 1, max: 10 });
    fc.assert(
      fc.property(burstSizeArb, maxVisibleArb, (n, maxVisible) => {
        const toasts = Array.from({ length: n }, (_, i) => makeToast(`toast-${i}`));
        const { visible, summaryCount } = computeToastStack(toasts, maxVisible);
        expect(visible.length).toBe(Math.min(n, maxVisible));
        expect(summaryCount).toBe(Math.max(0, n - maxVisible));
      }),
      { numRuns: 100 }
    );
  });

  it("empty input yields empty visible and zero summary", () => {
    const { visible, summaryCount } = computeToastStack([]);
    expect(visible.length).toBe(0);
    expect(summaryCount).toBe(0);
  });
});
