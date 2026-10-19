/**
 * Property-based tests for Decision Banner logic.
 *
 * Feature: decision-inbox-surface
 *
 * Tests validate:
 * - Property 8: Banner Aging Threshold — For any request with createdAt C,
 *   verify banner visible iff (now-C)>5min AND id not in dismissed set
 * - Property 9: Banner Count and Duration Display — For any non-empty set of
 *   aging requests, verify count = |set| and duration = longest pending formatted
 *   as relative time
 *
 * Uses fast-check for property-based testing with minimum 100 iterations.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

import {
  isAgingHighRisk,
  computeBannerDisplay,
  formatRelativeTime,
} from "../DecisionBanner.js";

import type { PendingRequest } from "../../../stores/decision.store.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default threshold for aging (5 minutes in ms). */
const DEFAULT_THRESHOLD_MS = 5 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Creates a PendingRequest with the given parameters. */
function makePendingRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    id: 1,
    toolName: "shell",
    riskLevel: "high",
    description: "Execute deployment script",
    missionId: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── fast-check Arbitraries ─────────────────────────────────────────────────

/** Arbitrary for request IDs (positive integers). */
const requestIdArb = fc.integer({ min: 1, max: 100_000 });

/** Arbitrary for risk level — high only (banner only shows high-risk). */
const highRiskArb = fc.constant("high" as const);

/** Arbitrary for non-high risk levels. */
const nonHighRiskArb = fc.oneof(
  fc.constant("low" as const),
  fc.constant("medium" as const)
);

/** Arbitrary for any risk level. */
const riskLevelArb = fc.oneof(
  fc.constant("low" as const),
  fc.constant("medium" as const),
  fc.constant("high" as const)
);

/** Arbitrary for elapsed time exceeding 5 minutes (aging). */
const agingElapsedMsArb = fc.integer({ min: DEFAULT_THRESHOLD_MS + 1, max: 24 * 60 * 60 * 1000 });

/** Arbitrary for elapsed time NOT exceeding 5 minutes (not aging). */
const notAgingElapsedMsArb = fc.integer({ min: 0, max: DEFAULT_THRESHOLD_MS });

/** Arbitrary for a "now" timestamp (reasonable recent range). */
const nowArb = fc.date({
  min: new Date("2024-01-01T00:00:00Z"),
  max: new Date("2025-12-31T23:59:59Z"),
});

/** Arbitrary for a non-empty set of aging high-risk request IDs (1 to 10). */
const agingRequestCountArb = fc.integer({ min: 1, max: 10 });

/** Arbitrary for elapsed time in ms (for formatRelativeTime). */
const durationMsArb = fc.integer({ min: 0, max: 48 * 60 * 60 * 1000 });

// ─── Property 8: Banner Aging Threshold ─────────────────────────────────────

describe("Feature: decision-inbox-surface, Property 8: Banner Aging Threshold", () => {
  /**
   * **Validates: Requirements 4.1, 4.4, 4.7**
   *
   * For any high-risk Approval_Request with createdAt timestamp C, the
   * Decision_Banner SHALL be visible if and only if (now - C) > 5 minutes
   * AND the request's ID is not in the dismissed set.
   */

  it("returns true for high-risk requests that have been pending > 5 minutes and are NOT dismissed", () => {
    fc.assert(
      fc.property(requestIdArb, nowArb, agingElapsedMsArb, (id, now, elapsedMs) => {
        const createdAt = new Date(now.getTime() - elapsedMs).toISOString();
        const request = makePendingRequest({ id, riskLevel: "high", createdAt });
        const dismissedIds = new Set<number>();

        const result = isAgingHighRisk(request, now, DEFAULT_THRESHOLD_MS, dismissedIds);
        expect(result).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("returns false for high-risk requests pending ≤ 5 minutes (not yet aging)", () => {
    fc.assert(
      fc.property(requestIdArb, nowArb, notAgingElapsedMsArb, (id, now, elapsedMs) => {
        const createdAt = new Date(now.getTime() - elapsedMs).toISOString();
        const request = makePendingRequest({ id, riskLevel: "high", createdAt });
        const dismissedIds = new Set<number>();

        const result = isAgingHighRisk(request, now, DEFAULT_THRESHOLD_MS, dismissedIds);
        expect(result).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("returns false for non-high-risk requests regardless of elapsed time", () => {
    fc.assert(
      fc.property(requestIdArb, nowArb, agingElapsedMsArb, nonHighRiskArb, (id, now, elapsedMs, riskLevel) => {
        const createdAt = new Date(now.getTime() - elapsedMs).toISOString();
        const request = makePendingRequest({ id, riskLevel, createdAt });
        const dismissedIds = new Set<number>();

        const result = isAgingHighRisk(request, now, DEFAULT_THRESHOLD_MS, dismissedIds);
        expect(result).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("returns false for high-risk aging requests whose ID is in the dismissed set", () => {
    fc.assert(
      fc.property(requestIdArb, nowArb, agingElapsedMsArb, (id, now, elapsedMs) => {
        const createdAt = new Date(now.getTime() - elapsedMs).toISOString();
        const request = makePendingRequest({ id, riskLevel: "high", createdAt });
        const dismissedIds = new Set<number>([id]);

        const result = isAgingHighRisk(request, now, DEFAULT_THRESHOLD_MS, dismissedIds);
        expect(result).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("visibility is iff (riskLevel=high AND elapsed>threshold AND NOT dismissed)", () => {
    fc.assert(
      fc.property(
        requestIdArb,
        nowArb,
        fc.integer({ min: 0, max: 24 * 60 * 60 * 1000 }),
        riskLevelArb,
        fc.boolean(),
        (id, now, elapsedMs, riskLevel, isDismissed) => {
          const createdAt = new Date(now.getTime() - elapsedMs).toISOString();
          const request = makePendingRequest({ id, riskLevel, createdAt });
          const dismissedIds = isDismissed ? new Set<number>([id]) : new Set<number>();

          const result = isAgingHighRisk(request, now, DEFAULT_THRESHOLD_MS, dismissedIds);
          const expectedVisible =
            riskLevel === "high" && elapsedMs > DEFAULT_THRESHOLD_MS && !isDismissed;

          expect(result).toBe(expectedVisible);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("a dismissed ID only suppresses that specific request, not others", () => {
    fc.assert(
      fc.property(
        requestIdArb,
        fc.integer({ min: 1, max: 100_000 }),
        nowArb,
        agingElapsedMsArb,
        (id, otherId, now, elapsedMs) => {
          // The two ids are drawn independently, so the generator will sometimes
          // pick the same number for both. The old guard excluded the literal 1,
          // which only holds if requestIdArb always yields 1 — it yields anything
          // up to 100_000. When both landed on 17 the request really was
          // dismissed, isAgingHighRisk correctly returned false, and this property
          // failed on that seed alone. Discard those draws instead: this property
          // is about a DIFFERENT id being dismissed.
          fc.pre(otherId !== id);

          const createdAt = new Date(now.getTime() - elapsedMs).toISOString();
          const request = makePendingRequest({ id, riskLevel: "high", createdAt });
          // Dismiss a different ID
          const dismissedIds = new Set<number>([otherId]);

          const result = isAgingHighRisk(request, now, DEFAULT_THRESHOLD_MS, dismissedIds);
          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 9: Banner Count and Duration Display ──────────────────────────

describe("Feature: decision-inbox-surface, Property 9: Banner Count and Duration Display", () => {
  /**
   * **Validates: Requirements 4.2**
   *
   * For any non-empty set of aging high-risk requests (pending > 5 min, not
   * dismissed), the banner SHALL display the count |set| and the longest
   * pending duration formatted as relative time.
   */

  it("count equals the number of aging high-risk requests in the set", () => {
    fc.assert(
      fc.property(agingRequestCountArb, nowArb, (count, now) => {
        // Generate `count` high-risk requests all exceeding 5 minutes
        const requests: PendingRequest[] = Array.from({ length: count }, (_, i) => {
          const elapsedMs = DEFAULT_THRESHOLD_MS + 1 + i * 60_000; // 5min+1ms, +1min each
          return makePendingRequest({
            id: i + 1,
            riskLevel: "high",
            createdAt: new Date(now.getTime() - elapsedMs).toISOString(),
          });
        });
        const dismissedIds = new Set<number>();

        const result = computeBannerDisplay(requests, now, dismissedIds);

        expect(result).not.toBeNull();
        expect(result!.count).toBe(count);
      }),
      { numRuns: 100 }
    );
  });

  it("longestDuration matches formatRelativeTime of the maximum elapsed time", () => {
    fc.assert(
      fc.property(
        agingRequestCountArb,
        nowArb,
        fc.array(agingElapsedMsArb, { minLength: 1, maxLength: 10 }),
        (_, now, elapsedArray) => {
          const requests: PendingRequest[] = elapsedArray.map((elapsedMs, i) =>
            makePendingRequest({
              id: i + 1,
              riskLevel: "high",
              createdAt: new Date(now.getTime() - elapsedMs).toISOString(),
            })
          );
          const dismissedIds = new Set<number>();

          const result = computeBannerDisplay(requests, now, dismissedIds);
          const maxElapsed = Math.max(...elapsedArray);
          const expectedDuration = formatRelativeTime(maxElapsed);

          expect(result).not.toBeNull();
          expect(result!.longestDuration).toBe(expectedDuration);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns null when all requests are non-high-risk (no aging requests)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        nowArb,
        agingElapsedMsArb,
        nonHighRiskArb,
        (count, now, elapsedMs, riskLevel) => {
          const requests: PendingRequest[] = Array.from({ length: count }, (_, i) =>
            makePendingRequest({
              id: i + 1,
              riskLevel,
              createdAt: new Date(now.getTime() - elapsedMs).toISOString(),
            })
          );
          const dismissedIds = new Set<number>();

          const result = computeBannerDisplay(requests, now, dismissedIds);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("returns null when all high-risk requests are in the dismissed set", () => {
    fc.assert(
      fc.property(agingRequestCountArb, nowArb, agingElapsedMsArb, (count, now, elapsedMs) => {
        const requests: PendingRequest[] = Array.from({ length: count }, (_, i) =>
          makePendingRequest({
            id: i + 1,
            riskLevel: "high",
            createdAt: new Date(now.getTime() - elapsedMs).toISOString(),
          })
        );
        // Dismiss all IDs
        const dismissedIds = new Set<number>(requests.map((r) => r.id));

        const result = computeBannerDisplay(requests, now, dismissedIds);
        expect(result).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("returns null when all high-risk requests are within the 5-minute threshold", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        nowArb,
        notAgingElapsedMsArb,
        (count, now, elapsedMs) => {
          const requests: PendingRequest[] = Array.from({ length: count }, (_, i) =>
            makePendingRequest({
              id: i + 1,
              riskLevel: "high",
              createdAt: new Date(now.getTime() - elapsedMs).toISOString(),
            })
          );
          const dismissedIds = new Set<number>();

          const result = computeBannerDisplay(requests, now, dismissedIds);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("count excludes dismissed requests from the total", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        nowArb,
        agingElapsedMsArb,
        (count, now, elapsedMs) => {
          const requests: PendingRequest[] = Array.from({ length: count }, (_, i) =>
            makePendingRequest({
              id: i + 1,
              riskLevel: "high",
              createdAt: new Date(now.getTime() - elapsedMs).toISOString(),
            })
          );
          // Dismiss only the first request
          const dismissedIds = new Set<number>([1]);

          const result = computeBannerDisplay(requests, now, dismissedIds);
          expect(result).not.toBeNull();
          expect(result!.count).toBe(count - 1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("visible is always true when result is not null", () => {
    fc.assert(
      fc.property(agingRequestCountArb, nowArb, agingElapsedMsArb, (count, now, elapsedMs) => {
        const requests: PendingRequest[] = Array.from({ length: count }, (_, i) =>
          makePendingRequest({
            id: i + 1,
            riskLevel: "high",
            createdAt: new Date(now.getTime() - elapsedMs).toISOString(),
          })
        );
        const dismissedIds = new Set<number>();

        const result = computeBannerDisplay(requests, now, dismissedIds);
        expect(result).not.toBeNull();
        expect(result!.visible).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("formatRelativeTime produces consistent output for any non-negative duration", () => {
    fc.assert(
      fc.property(durationMsArb, (ms) => {
        const result = formatRelativeTime(ms);
        // Result should always be a non-empty string
        expect(result.length).toBeGreaterThan(0);
        // Result should contain "minute" or "hour"
        expect(result).toMatch(/minute|hour/);
      }),
      { numRuns: 100 }
    );
  });

  it("formatRelativeTime reports correct hours and minutes breakdown", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 48 }),
        fc.integer({ min: 0, max: 59 }),
        (hours, minutes) => {
          const ms = (hours * 60 + minutes) * 60_000;
          const result = formatRelativeTime(ms);

          if (hours === 0) {
            // Should only mention minutes
            if (minutes <= 1) {
              expect(result).toBe("1 minute");
            } else {
              expect(result).toBe(`${minutes} minutes`);
            }
          } else {
            const hourStr = hours === 1 ? "1 hour" : `${hours} hours`;
            if (minutes === 0) {
              expect(result).toBe(hourStr);
            } else {
              const minStr = minutes === 1 ? "1 minute" : `${minutes} minutes`;
              expect(result).toBe(`${hourStr} ${minStr}`);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
